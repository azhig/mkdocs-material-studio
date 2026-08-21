import * as vscode from "vscode";
import { ProjectService } from "./core/projectService";
import { PreviewPanelManager, PREVIEW_VIEW_TYPE } from "./preview/previewPanel";
import { createFallbackRenderer } from "./preview/fallbackRenderer";
import { TreeController } from "./tree/treeController";
import { InsertPanel } from "./wizards/insertPanel";
import { parseBlock } from "./wizards/blockParsers";
import { ConfigPanel } from "./configEditor/configPanel";
import { VisualEditorProvider } from "./wysiwyg/visualEditorProvider";
import { affectsLanguage, loadTranslations } from "./core/i18n";
import { initLogger, getLogger } from "./util/logger";
import { debounce } from "./util/debounce";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = initLogger();
  context.subscriptions.push(log);
  const language = loadTranslations(context);
  log.info(`MkDocs Material Studio is activating (language: ${language})`);

  const projects = new ProjectService();
  const fallbackRender = createFallbackRenderer(context);
  const preview = new PreviewPanelManager(context, projects);
  preview.setFallbackRenderer(fallbackRender);
  context.subscriptions.push({ dispose: () => preview.dispose() });

  const tree = new TreeController(context, projects);
  const insertPanel = new InsertPanel(context);
  const configPanel = new ConfigPanel(context, projects);

  // Block-based visual editor (CustomTextEditor, opened on demand).
  const visualEditor = new VisualEditorProvider(context, projects, fallbackRender, insertPanel);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VisualEditorProvider.viewType, visualEditor, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    // Ctrl/Cmd+S in the visual editor. The page is a draft until it is saved,
    // so the document is not dirty and the built-in save has nothing to write —
    // this command is what puts the page into the file.
    vscode.commands.registerCommand("mkdocsStudio.saveVisual", () => visualEditor.saveFocused()),
  );

  // Clicking a block in the lightweight preview: admonition/code open in the
  // edit form (range replacement), anything else jumps to the source line.
  preview.setBlockClickHandler((doc, range, blockType) => {
    const text = doc.getText(new vscode.Range(range.startLine, 0, range.endLine, 0));
    const parsed = parseBlock(text, blockType);
    if (parsed) {
      insertPanel.openForEdit(parsed.id, parsed.values, {
        uri: doc.uri,
        startLine: range.startLine,
        endLine: range.endLine,
      });
    } else {
      revealSourceLine(doc.uri, range.startLine);
    }
  });

  const detected = (await projects.getProjects()).length > 0;
  await vscode.commands.executeCommand("setContext", "mkdocsStudio.isProject", detected);

  context.subscriptions.push(
    vscode.commands.registerCommand("mkdocsStudio.openPreview", () => preview.open()),
    vscode.commands.registerCommand("mkdocsStudio.openPreviewToSide", () =>
      preview.open(undefined, { beside: true }),
    ),
    vscode.commands.registerCommand("mkdocsStudio.showLogs", () => getLogger().show()),
    vscode.commands.registerCommand("mkdocsStudio.insertComponent", () => insertPanel.open()),
    vscode.commands.registerCommand("mkdocsStudio.openConfigEditor", (uri?: vscode.Uri) =>
      configPanel.open(uri),
    ),
    vscode.commands.registerCommand("mkdocsStudio.openVisualEditor", (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) {
        void vscode.commands.executeCommand(
          "vscode.openWith",
          target,
          VisualEditorProvider.viewType,
        );
      }
    }),
    // Button in the visual editor title bar: go back to plain Markdown.
    vscode.commands.registerCommand("mkdocsStudio.openAsText", (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) {
        void vscode.commands.executeCommand("vscode.openWith", target, "default");
      }
    }),
  );

  // Restores the preview panel after a window reload.
  if (vscode.window.registerWebviewPanelSerializer) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(PREVIEW_VIEW_TYPE, {
        async deserializeWebviewPanel(panel) {
          await preview.restore(panel);
        },
      }),
    );
  }

  // The preview follows the active Markdown editor.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const follow = vscode.workspace
        .getConfiguration("mkdocsStudio")
        .get<boolean>("followActiveEditor", true);
      if (follow && editor?.document.languageId === "markdown") {
        void preview.update(editor.document.uri);
      }
    }),
  );

  // Live update of the lightweight preview while typing (debounced).
  const liveUpdate = debounce((uri: vscode.Uri) => void preview.update(uri), 250);
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === "markdown") {
        liveUpdate(e.document.uri);
      }
    }),
  );

  // Scroll synchronization: editor → preview.
  const syncScroll = debounce((uri: vscode.Uri, line: number) => preview.syncScroll(uri, line), 50);
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.languageId === "markdown" && e.visibleRanges.length > 0) {
        syncScroll(e.textEditor.document.uri, e.visibleRanges[0].start.line);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Switching the language reloads the bundle and rebuilds every open
      // webview: their toolbars are part of the page shell, not of a message.
      if (affectsLanguage(e)) {
        loadTranslations();
        preview.reloadUi();
        tree.refresh();
      }
    }),
  );

  // Drops the project cache when mkdocs.yml or the set of workspace folders changes.
  const configWatcher = vscode.workspace.createFileSystemWatcher("**/mkdocs.{yml,yaml}");
  const invalidate = async () => {
    projects.invalidate();
    const has = (await projects.getProjects()).length > 0;
    await vscode.commands.executeCommand("setContext", "mkdocsStudio.isProject", has);
    tree.refresh();
  };
  // When the configuration changes (e.g. the palette is switched in the
  // mkdocs.yml editor), also refresh the lightweight preview of the current
  // document.
  const onConfigChanged = debounce(() => {
    void invalidate().then(() => preview.update(vscode.window.activeTextEditor?.document.uri));
  }, 200);
  configWatcher.onDidCreate(invalidate);
  configWatcher.onDidDelete(invalidate);
  configWatcher.onDidChange(() => onConfigChanged());
  context.subscriptions.push(
    configWatcher,
    vscode.workspace.onDidChangeWorkspaceFolders(() => void invalidate()),
  );

  log.info(`MkDocs Material Studio activated (project found: ${detected ? "yes" : "no"})`);
}

/** Moves the cursor to the source line of a block that cannot be edited in place. */
function revealSourceLine(uri: vscode.Uri, line: number): void {
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  if (editor) {
    const range = new vscode.Range(line, 0, line, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(range.start, range.start);
  }
}

/**
 * Called by VS Code when the extension shuts down. Nothing in this repository
 * references it — the platform looks it up by name in the module's exports — so
 * a search for unused exports will always name it. It is not one.
 */
export function deactivate(): void {
  getLogger().info("MkDocs Material Studio is deactivating");
}
