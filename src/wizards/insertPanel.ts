import * as vscode from "vscode";
import { componentMetas, getComponent, type FieldValues } from "./components";
import { getLogger } from "../util/logger";
import { contentSecurityPolicy, embedJson, esc, makeNonce } from "../util/webviewHtml";
import { currentLanguage, t, translations } from "../core/i18n";

const VIEW_TYPE = "mkdocsStudio.insert";

/** Target range to replace when a block is edited by click (M6). */
export interface EditTarget {
  uri: vscode.Uri;
  startLine: number;
  endLine: number; // exclusive end (0-based), like token.map[1]
}

/** Target position for inserting a new block (for the visual editor, M8). */
export interface InsertTarget {
  uri: vscode.Uri;
  line: number; // the line BEFORE which the block is inserted (0-based)
}

/**
 * Panel for visually inserting Material components. Shows the component
 * palette and the forms; on confirmation it inserts the generated Markdown at
 * the cursor position in the last active Markdown editor.
 *
 * In edit mode (openForEdit) the form is prefilled with the block's values, and
 * confirming replaces the original range through a WorkspaceEdit (the undo
 * history is preserved).
 */
export class InsertPanel {
  private panel: vscode.WebviewPanel | undefined;
  private lastEditor: vscode.TextEditor | undefined;
  private editTarget: EditTarget | undefined;
  private insertTarget: InsertTarget | undefined;
  private pendingEdit: { id: string; values: FieldValues } | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.captureEditor(vscode.window.activeTextEditor);
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((e) => this.captureEditor(e)),
    );
  }

  private captureEditor(editor: vscode.TextEditor | undefined): void {
    if (editor?.document.languageId === "markdown") {
      this.lastEditor = editor;
    }
  }

  /** Creates the panel if there is none, then shows it. */
  private ensurePanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      t("Insert component"),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );
    this.panel.webview.html = this.shellHtml(this.panel.webview);
    // Nothing above this catch: a handler that throws would otherwise become an
    // unhandled rejection, and the form would go quiet with no trace of why.
    this.panel.webview.onDidReceiveMessage(
      (m) => {
        this.onMessage(m).catch((err: unknown) => {
          const type = (m as { type?: unknown })?.type;
          getLogger().error(`Insert form: message "${String(type)}" failed — ${String(err)}`);
        });
      },
      null,
      this.context.subscriptions,
    );
    this.panel.onDidDispose(() => (this.panel = undefined), null, this.context.subscriptions);
  }

  /** The standard insertion at the active editor's cursor (the command palette entry). */
  open(): void {
    this.captureEditor(vscode.window.activeTextEditor);
    this.editTarget = undefined;
    this.insertTarget = undefined;
    const existed = this.panel !== undefined;
    this.ensurePanel();
    if (existed) {
      this.post({ type: "reset" });
    }
  }

  /**
   * Opens the form prefilled with the block's values, to replace its original
   * text in the target range. Called by the preview's block-click handler.
   */
  openForEdit(id: string, values: FieldValues, target: EditTarget): void {
    this.editTarget = target;
    this.insertTarget = undefined;
    this.pendingEdit = { id, values };
    const existed = this.panel !== undefined;
    this.ensurePanel();
    // If the panel was already open, the webview is initialized — send right away.
    // Otherwise the edit goes out after the "ready" message (see flushPendingEdit).
    if (existed) {
      this.flushPendingEdit();
    }
  }

  /**
   * Opens the palette to insert a new block at the target position (before the
   * target.line line). Used by the visual editor (M8).
   */
  openInsertAt(target: InsertTarget): void {
    this.insertTarget = target;
    this.editTarget = undefined;
    this.pendingEdit = undefined;
    const existed = this.panel !== undefined;
    this.ensurePanel();
    if (existed) {
      this.post({ type: "reset" });
    }
  }

  private flushPendingEdit(): void {
    if (this.pendingEdit) {
      this.post({ type: "edit", id: this.pendingEdit.id, values: this.pendingEdit.values });
      this.pendingEdit = undefined;
    }
  }

  private async onMessage(msg: unknown): Promise<void> {
    const m = msg as { type?: string; [k: string]: unknown };
    switch (m.type) {
      case "ready":
        this.post({ type: "init", components: componentMetas() });
        this.flushPendingEdit();
        break;
      case "loadIcons":
        await this.sendIcons();
        break;
      case "insert":
        await this.doInsert(String(m.id), (m.values ?? {}) as FieldValues, m.edit === true);
        break;
    }
  }

  private async sendIcons(): Promise<void> {
    try {
      const indexUri = vscode.Uri.joinPath(
        this.context.extensionUri,
        "assets",
        "icons",
        "index.json",
      );
      const bytes = await vscode.workspace.fs.readFile(indexUri);
      const names = JSON.parse(Buffer.from(bytes).toString("utf8")) as string[];
      this.post({ type: "icons", names });
    } catch (err) {
      getLogger().warn(`Failed to load the icon index: ${String(err)}`);
      this.post({ type: "icons", names: [] });
    }
  }

  private async doInsert(id: string, values: FieldValues, isEdit: boolean): Promise<void> {
    const component = getComponent(id);
    if (!component) {
      return;
    }
    const snippet = component.generate(values);

    if (isEdit && this.editTarget) {
      await this.replaceBlock(id, snippet, this.editTarget);
      this.editTarget = undefined;
      return;
    }

    if (this.insertTarget) {
      await this.insertBlockAt(id, snippet, this.insertTarget);
      this.insertTarget = undefined;
      return;
    }

    const editor = this.resolveTargetEditor();
    if (!editor) {
      void vscode.window.showWarningMessage(t("Open a Markdown file to insert a component."));
      return;
    }
    await editor.insertSnippet(new vscode.SnippetString(snippet), editor.selection.active);
    this.post({ type: "inserted", id });
  }

  /** Inserts the generated block at a position (for the visual editor). */
  private async insertBlockAt(id: string, snippet: string, target: InsertTarget): Promise<void> {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(target.uri);
    } catch (err) {
      getLogger().warn(`Failed to open the document to insert the block: ${String(err)}`);
      return;
    }
    let text = stripTabstops(snippet);
    if (!text.endsWith("\n")) {
      text += "\n";
    }
    // Set off with a blank line above when inserting somewhere other than the
    // start and the previous line is not empty — so the block is properly
    // separated from the preceding one.
    const line = Math.min(Math.max(0, target.line), doc.lineCount);
    if (
      line > 0 &&
      line <= doc.lineCount &&
      doc.lineAt(Math.min(line - 1, doc.lineCount - 1)).text.trim() !== ""
    ) {
      text = "\n" + text;
    }
    const position = new vscode.Position(line, 0);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(target.uri, position, text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      this.post({ type: "inserted", id });
    } else {
      getLogger().warn("Block insertion rejected (applyEdit returned false)");
    }
  }

  /** Replaces the block's range with the generated text (tab stops are stripped). */
  private async replaceBlock(id: string, snippet: string, target: EditTarget): Promise<void> {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(target.uri);
    } catch (err) {
      getLogger().warn(`Failed to open the document to replace the block: ${String(err)}`);
      return;
    }
    let replacement = stripTabstops(snippet);
    let range: vscode.Range;
    if (target.endLine >= doc.lineCount) {
      // The block reaches the end of the file: replace up to the end of the last
      // line and do not add a superfluous trailing newline.
      const lastLine = Math.max(0, doc.lineCount - 1);
      range = new vscode.Range(target.startLine, 0, lastLine, doc.lineAt(lastLine).text.length);
      replacement = replacement.replace(/\n$/, "");
    } else {
      range = new vscode.Range(target.startLine, 0, target.endLine, 0);
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(target.uri, range, replacement);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok) {
      this.post({ type: "saved", id });
    } else {
      getLogger().warn("Block replacement rejected (applyEdit returned false)");
    }
  }

  private resolveTargetEditor(): vscode.TextEditor | undefined {
    if (this.lastEditor && !this.lastEditor.document.isClosed) {
      return this.lastEditor;
    }
    return vscode.window.visibleTextEditors.find((e) => e.document.languageId === "markdown");
  }

  private post(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private asset(webview: vscode.Webview, ...segments: string[]): string {
    return webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...segments))
      .toString();
  }

  private shellHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const scriptUri = this.asset(webview, "dist", "webview", "wizard.js");
    const iconBase = this.asset(webview, "assets", "icons", "svg");
    const codiconCss = this.asset(webview, "assets", "vendor", "codicons", "codicon.css");
    const csp = contentSecurityPolicy(webview.cspSource, nonce);

    return /* html */ `<!DOCTYPE html>
<html lang="${currentLanguage()}" dir="ltr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${codiconCss}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: .75rem; }
  h2 { font-size: .95rem; margin: .3rem 0 .6rem; }
  .cat { font-size: .7rem; text-transform: uppercase; opacity: .6; margin: .8rem 0 .3rem; letter-spacing: .05em; }
  .palette { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: .4rem; }
  .card {
    display: flex; align-items: center; gap: .4rem; cursor: pointer;
    padding: .5rem .6rem; border-radius: 5px; font-size: .8rem;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, transparent);
  }
  .card:hover { background: var(--vscode-list-hoverBackground); }
  .card .codicon { font-size: 15px; }
  form { display: flex; flex-direction: column; gap: .6rem; }
  label { display: flex; flex-direction: column; gap: .2rem; font-size: .78rem; }
  input[type=text], input[type=number], textarea, select {
    font: inherit; padding: .3rem .4rem; border-radius: 4px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #8884));
  }
  textarea { min-height: 4rem; resize: vertical; font-family: var(--vscode-editor-font-family); }
  .row { display: flex; align-items: center; gap: .4rem; }
  .actions { display: flex; gap: .5rem; margin-top: .5rem; }
  button {
    font: inherit; cursor: pointer; padding: .35rem .8rem; border: none; border-radius: 4px;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button:hover { opacity: .9; }
  .help { font-size: .7rem; opacity: .6; }
  .toast { position: fixed; bottom: 10px; right: 10px; padding: .4rem .7rem; border-radius: 4px;
    background: var(--vscode-notifications-background); border: 1px solid var(--vscode-notifications-border);
    opacity: 0; transition: opacity .2s; font-size: .78rem; }
  .toast.show { opacity: 1; }
  /* Icon picker */
  .picker { position: fixed; inset: 0; background: var(--vscode-editor-background); display: none; flex-direction: column; padding: .75rem; }
  .picker.show { display: flex; }
  .picker input { margin-bottom: .5rem; }
  .grid-icons { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 4px; align-content: start; }
  .grid-icons .ic { display: flex; align-items: center; justify-content: center; padding: 6px; border-radius: 4px; cursor: pointer; }
  .grid-icons .ic:hover { background: var(--vscode-list-hoverBackground); }
  .grid-icons .ic img { width: 20px; height: 20px; }
  .iconField { display: flex; align-items: center; gap: .5rem; }
  .iconField img { width: 20px; height: 20px; }
</style>
</head>
<body>
<div id="app"></div>
<div id="toast" class="toast"></div>
<div id="picker" class="picker">
  <input id="pickerSearch" type="text" placeholder="${esc(t("Search for an icon (for example, github, arrow)…"))}" />
  <div id="pickerGrid" class="grid-icons"></div>
</div>
<script nonce="${nonce}">
window.__wizard = { iconBase: "${iconBase}", nonce: "${nonce}" };
window.__i18n = ${embedJson({ lang: currentLanguage(), strings: translations() })};
</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** Strips a snippet's tab stops ($0, $1, ${1:...}) — a replacement does not need them. */
function stripTabstops(s: string): string {
  return s.replace(/\$\{?\d+(:[^}]*)?\}?/g, "");
}
