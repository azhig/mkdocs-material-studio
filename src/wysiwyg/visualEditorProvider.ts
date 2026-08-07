import * as vscode from "vscode";
import * as path from "node:path";
import type { ProjectService } from "../core/projectService";
import { affectsPalette, pageBackground, type FallbackRenderFn } from "../preview/fallbackRenderer";
import type { InsertPanel } from "../wizards/insertPanel";
import { parseBlock } from "../wizards/blockParsers";
import { loadExtraCss, watchExtraCss, workspaceRoots } from "../core/extraCss";
import {
  activePagePath,
  affectsChromeVisibility,
  buildSiteChrome,
  chromeScope,
  chromeVisibility,
  pageUri,
  saveChromeVisibility,
  watchSiteChrome,
} from "../core/siteChrome";
import { externalTarget, findLinkTarget, isMarkdownPath, parseDocLink } from "../core/docLinks";
import { parseSyncEdits } from "./syncEdits";
import { lineRange, planEditOps, type DocPosition, type LineDoc } from "./editPlan";
import { imageBaseName, imageCandidate, imageExt } from "./imageNames";
import { affectsLanguage, currentLanguage, t, translations } from "../core/i18n";
import { fileExists } from "../util/files";
import { getLogger } from "../util/logger";
import { debounce } from "../util/debounce";
import { contentSecurityPolicy, embedJson, esc, makeNonce } from "../util/webviewHtml";

/**
 * “Insert” components pinned to the toolbar by default (table, image, code
 * block, horizontal rule). Must match the value of "mkdocsStudio.toolbarButtons"
 * in package.json.
 */
const DEFAULT_TOOLBAR_BUTTONS = ["table", "image", "code", "hr"];

/**
 * How the panel tells its own edits apart from everyone else's. `applying`
 * covers the window while applyEdit is in flight, `versions` the changes that
 * are reported after it has returned; VS Code does not promise which comes
 * first, so both are needed.
 */
interface OwnEdits {
  versions: Set<number>;
  applying: number;
}

/**
 * The visual editor (M10) — a CustomTextEditorProvider.
 *
 * The webview holds a contenteditable document; edits arrive as batches of
 * targeted range replacements (only the changed block is serialized). After a
 * batch is applied the provider answers with a fresh render (the “catch-up”
 * patch); for external edits it answers with a full render.
 *
 * Registered with priority: option — it is opened via “Open With…” or by
 * command, and does not take over as the default text editor.
 */
export class VisualEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "mkdocsStudio.visualEditor";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectService,
    private readonly render: FallbackRenderFn,
    private readonly insertPanel: InsertPanel,
  ) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    panel.webview.options = {
      enableScripts: true,
      // Workspace folders are needed for the resources extra_css references
      // (fonts, background images): without them asWebviewUri returns a blocked
      // address. The document's own folder joins them for the sake of a file
      // opened outside the workspace — its images live next to it.
      localResourceRoots: [
        this.context.extensionUri,
        ...workspaceRoots(),
        ...(document.uri.scheme === "file"
          ? [vscode.Uri.file(path.dirname(document.uri.fsPath))]
          : []),
      ],
    };
    panel.webview.html = this.shellHtml(panel.webview);

    // Our own edits must not trigger a full re-render — the caret in the webview
    // has a life of its own, and redrawing the document under it loses the place.
    //
    // Recognising them by version alone is a race: onDidChangeTextDocument may
    // arrive before applyEdit has returned, and the version cannot be recorded
    // until it has. The counter covers exactly that window; the set covers the
    // other order. A foreign edit landing inside the window is not lost — the
    // “synced” that follows carries the current text either way.
    const own: OwnEdits = { versions: new Set<number>(), applying: 0 };

    const fullRender = debounce(() => void this.postRender(panel, document, "render"), 250);
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      if (own.applying > 0 || own.versions.delete(e.document.version)) {
        return; // our own edit — the webview gets a targeted "synced" instead
      }
      fullRender();
    });
    // The inline formatting placement setting is applied on the fly.
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("mkdocsStudio.inlineFormatting") ||
        e.affectsConfiguration("mkdocsStudio.toolbarButtons") ||
        e.affectsConfiguration("mkdocsStudio.keybindings")
      ) {
        this.postUiConfig(panel);
      }
      // The header/navigation may have been toggled in another panel — the state is shared.
      if (affectsChromeVisibility(e)) {
        this.postChromeState(panel);
      }
      // The toolbar is part of the shell HTML, so a new language means a rebuild.
      if (affectsLanguage(e)) {
        panel.webview.html = this.shellHtml(panel.webview);
      }
      // The palette travels with the render message — a new color needs a redraw.
      if (affectsPalette(e)) {
        fullRender();
      }
    });
    // Project styles (extra_css) and the site layout are applied on the fly:
    // save a file and the look updates, add a page and it shows up in the
    // navigation.
    const watchers: vscode.Disposable[] = [];
    let disposed = false;
    void this.projects.findProjectFor(document.uri).then(async (project) => {
      // With no MkDocs project we watch the workspace folder: that is where the
      // Markdown registry lives.
      const scope = await chromeScope(document.uri, project);
      const watch = [
        ...(project ? [watchExtraCss(project, () => void this.postExtraCss(panel, document))] : []),
        watchSiteChrome(scope.root, () => void this.postSiteChrome(panel, document)),
      ];
      // The panel may have been closed while we were looking for the project —
      // then release the watchers right away.
      if (disposed) {
        watch.forEach((w) => w.dispose());
      } else {
        watchers.push(...watch);
      }
    });
    panel.onDidDispose(() => {
      disposed = true;
      changeSub.dispose();
      cfgSub.dispose();
      watchers.forEach((w) => w.dispose());
    });

    // Nothing above this catch: a message handler that throws would otherwise
    // become an unhandled rejection, and the editor would go quiet with no
    // trace of why.
    panel.webview.onDidReceiveMessage((msg) => {
      this.onMessage(msg, document, panel, own).catch((err: unknown) => {
        const type = (msg as { type?: unknown })?.type;
        getLogger().error(`Visual editor: message "${String(type)}" failed — ${String(err)}`);
      });
    });
  }

  private async postRender(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    type: "render" | "synced",
  ): Promise<void> {
    try {
      const project = await this.projects.findProjectFor(document.uri);
      const { html, palette } = await this.render(document, project, undefined, (uri) =>
        panel.webview.asWebviewUri(uri).toString(),
      );
      void panel.webview.postMessage({
        type,
        html,
        palette,
        background: pageBackground(document.uri),
        text: document.getText(),
        version: document.version,
      });
    } catch (err) {
      getLogger().error(`Visual editor: render failed — ${String(err)}`);
    }
  }

  private async onMessage(
    msg: unknown,
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    own: OwnEdits,
  ): Promise<void> {
    const m = msg as { type?: string; [k: string]: unknown };
    switch (m.type) {
      case "ready":
        await this.postRender(panel, document, "render");
        await this.postExtraCss(panel, document);
        this.postUiConfig(panel);
        this.postChromeState(panel);
        await this.postSiteChrome(panel, document);
        break;
      case "setChrome":
        await saveChromeVisibility(m.header, m.nav);
        this.postChromeState(panel);
        break;
      case "openPage":
        await this.openPage(document, String(m.path ?? ""));
        break;
      case "saveImage":
        await this.saveImage(document, panel, m);
        break;
      case "pickFile":
        await this.pickFile(document, panel, Number(m.token), String(m.kind ?? "image"));
        break;
      case "setConfig":
        await this.setConfig(m);
        break;
      case "renderSub":
        await this.renderSub(document, panel, Number(m.id), String(m.text ?? ""));
        break;
      case "sync":
        await this.applySync(document, panel, Number(m.baseVersion), m.edits, own);
        break;
      case "insertAt":
        this.insertPanel.openInsertAt({ uri: document.uri, line: Number(m.line) });
        break;
      case "editBlock":
        this.editBlock(
          document,
          panel,
          Number(m.startLine),
          Number(m.endLine),
          m.blockType as string | undefined,
        );
        break;
      case "openAsText":
        await vscode.commands.executeCommand("vscode.openWith", document.uri, "default");
        break;
      case "openConfig":
        // The document's own uri, not the workspace root: in a monorepo every
        // page belongs to the nearest mkdocs.yml up the tree.
        await vscode.commands.executeCommand("mkdocsStudio.openConfigEditor", document.uri);
        break;
      case "openLink":
        await this.openLink(document, String(m.href ?? ""));
        break;
    }
  }

  /**
   * Renders a fragment for the annotation editor: the note's body is a little
   * document of its own in the webview, and only the result comes back — the
   * file is not touched until the editor's “Done”.
   */
  private async renderSub(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    id: number,
    text: string,
  ): Promise<void> {
    try {
      const project = await this.projects.findProjectFor(document.uri);
      const { html } = await this.render(document, project, text, (uri) =>
        panel.webview.asWebviewUri(uri).toString(),
      );
      void panel.webview.postMessage({ type: "subRendered", id, html });
    } catch (err) {
      getLogger().error(`Visual editor: fragment render failed — ${String(err)}`);
    }
  }

  /** Applies a batch of targeted edits and answers with a “catch-up” render. */
  private async applySync(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    baseVersion: number,
    rawEdits: unknown,
    own: OwnEdits,
  ): Promise<void> {
    const edits = parseSyncEdits(rawEdits ?? []);
    if (!edits) {
      getLogger().error("Visual editor: a malformed batch of edits was refused");
    }
    if (!edits || baseVersion !== document.version) {
      // The batch was built against stale text — reject it and send a full render.
      void panel.webview.postMessage({ type: "rejected", version: document.version });
      await this.postRender(panel, document, "render");
      return;
    }
    if (edits.length > 0) {
      const edit = new vscode.WorkspaceEdit();
      for (const op of planEditOps(lineDoc(document), edits)) {
        if (op.kind === "insert") {
          edit.insert(document.uri, position(op.at), op.text);
        } else if (op.kind === "delete") {
          edit.delete(document.uri, range(op.start, op.end));
        } else {
          edit.replace(document.uri, range(op.start, op.end), op.text);
        }
      }
      // The change event can arrive while this is still awaiting; from here to
      // the version being recorded, every change to this document is ours.
      own.applying += 1;
      let ok: boolean;
      try {
        ok = await vscode.workspace.applyEdit(edit);
      } finally {
        own.applying -= 1;
      }
      if (!ok) {
        getLogger().warn("Visual editor: applyEdit returned false");
        void panel.webview.postMessage({ type: "rejected", version: document.version });
        await this.postRender(panel, document, "render");
        return;
      }
      own.versions.add(document.version);
      if (own.versions.size > 64) {
        own.versions.clear();
      }
    }
    await this.postRender(panel, document, "synced");
  }

  /** The “Form” button on a code block: open the structured form. */
  private editBlock(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    startLine: number,
    endLine: number,
    blockType: string | undefined,
  ): void {
    const text = document.getText(docRange(document, startLine, endLine));
    const parsed = parseBlock(text.endsWith("\n") ? text : text + "\n", blockType);
    if (parsed) {
      this.insertPanel.openForEdit(parsed.id, parsed.values, {
        uri: document.uri,
        startLine,
        endLine,
      });
    } else {
      void panel.webview.postMessage({
        type: "editText",
        startLine,
        endLine,
        text: text.replace(/\n$/, ""),
      });
    }
  }

  /**
   * Cmd+click on a link. An address with a scheme goes to the browser; a page of
   * the project opens in this same visual editor — following a link should not
   * throw the author into raw Markdown. The href is written the way MkDocs wants
   * it (`setup.md`, `setup/`, `../setup`), so the file is looked for the same way.
   */
  private async openLink(document: vscode.TextDocument, href: string): Promise<void> {
    const link = parseDocLink(href);
    if (!link || link.kind === "anchor") {
      return; // an anchor within the page
    }
    if (link.kind === "external") {
      const external = externalTarget(link.target);
      if (!external) {
        getLogger().warn(`Visual editor: refused to open an address of this kind — ${href}`);
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(external));
      return;
    }
    const docDir = path.dirname(document.uri.fsPath);
    const project = await this.projects.findProjectFor(document.uri);
    const scope = await chromeScope(document.uri, project);
    const file = await findLinkTarget(link, docDir, scope.pagesRoot.fsPath, fileExists);
    if (!file) {
      getLogger().warn(`Visual editor: link leads nowhere — ${href}`);
      void vscode.window.showWarningMessage(t("Page not found: {0}", href));
      return;
    }
    const target = vscode.Uri.file(file);
    try {
      if (isMarkdownPath(file)) {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          target,
          VisualEditorProvider.viewType,
        );
      } else {
        await vscode.commands.executeCommand("vscode.open", target);
      }
    } catch (err) {
      getLogger().warn(`Visual editor: failed to open link ${href} — ${String(err)}`);
    }
  }

  /** Sends the webview the UI settings (formatting placement + toolbar buttons). */
  private postUiConfig(panel: vscode.WebviewPanel): void {
    const cfg = vscode.workspace.getConfiguration("mkdocsStudio");
    void panel.webview.postMessage({
      type: "uiConfig",
      inlineFormatting: cfg.get<string>("inlineFormatting", "both"),
      toolbarButtons: cfg.get<string[]>("toolbarButtons", DEFAULT_TOOLBAR_BUTTONS),
      keybindings: cfg.get<Record<string, string>>("keybindings", {}),
    });
  }

  /** Saves the UI settings from the editor popup into the VS Code configuration. */
  private async setConfig(m: { [k: string]: unknown }): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("mkdocsStudio");
    try {
      if (typeof m.inlineFormatting === "string") {
        await cfg.update("inlineFormatting", m.inlineFormatting, vscode.ConfigurationTarget.Global);
      }
      if (Array.isArray(m.toolbarButtons)) {
        const list = m.toolbarButtons.filter((x): x is string => typeof x === "string");
        await cfg.update("toolbarButtons", list, vscode.ConfigurationTarget.Global);
      }
      if (m.keybindings && typeof m.keybindings === "object") {
        // Only the differences from the defaults arrive (an empty string = disabled).
        const keys: Record<string, string> = {};
        for (const [id, value] of Object.entries(m.keybindings as Record<string, unknown>)) {
          if (typeof value === "string") {
            keys[id] = value;
          }
        }
        await cfg.update("keybindings", keys, vscode.ConfigurationTarget.Global);
      }
    } catch (err) {
      getLogger().warn(`Visual editor: failed to save a setting — ${String(err)}`);
    }
  }

  /** Site header and page tree + marking of the current page. */
  private async postSiteChrome(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
  ): Promise<void> {
    try {
      const project = await this.projects.findProjectFor(document.uri);
      const scope = await chromeScope(document.uri, project);
      const data = await buildSiteChrome(
        scope,
        (uri) => panel.webview.asWebviewUri(uri).toString(),
        this.context.extensionUri,
      );
      void panel.webview.postMessage({ type: "siteChrome", data });
      void panel.webview.postMessage({
        type: "siteActive",
        active: activePagePath(scope, document.uri),
      });
    } catch (err) {
      getLogger().warn(`Visual editor: failed to build the navigation — ${String(err)}`);
    }
  }

  /** State of the “Header” and “Navigation” buttons (shared with the preview). */
  private postChromeState(panel: vscode.WebviewPanel): void {
    void panel.webview.postMessage({ type: "chromeState", ...chromeVisibility() });
  }

  /** Clicking a page in the left panel: open it in the same visual editor. */
  private async openPage(document: vscode.TextDocument, rel: string): Promise<void> {
    if (rel === "") {
      return;
    }
    const project = await this.projects.findProjectFor(document.uri);
    const target = pageUri(await chromeScope(document.uri, project), rel);
    if (target.toString() === document.uri.toString()) {
      return;
    }
    try {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        target,
        VisualEditorProvider.viewType,
      );
    } catch (err) {
      getLogger().warn(`Visual editor: failed to open page ${rel} — ${String(err)}`);
    }
  }

  /** Loads the project's custom CSS (extra_css from mkdocs.yml) into the webview. */
  private async postExtraCss(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
  ): Promise<void> {
    const project = await this.projects.findProjectFor(document.uri);
    if (!project) {
      return;
    }
    const { css } = await loadExtraCss(project, (uri) =>
      panel.webview.asWebviewUri(uri).toString(),
    );
    // We send an empty string too: the file may have been removed from
    // extra_css — then the style is dropped.
    void panel.webview.postMessage({ type: "extraCss", css });
  }

  /**
   * Saves a pasted/dropped image: writes the file into a configurable folder
   * (relative to the current document) and returns to the webview a relative
   * link for inserting the Markdown markup.
   */
  private async saveImage(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    m: { [k: string]: unknown },
  ): Promise<void> {
    const token = Number(m.token);
    try {
      const data = String(m.data ?? "");
      const bytes = Buffer.from(data, "base64");
      if (bytes.length === 0) {
        throw new Error("empty image data");
      }
      const ext = imageExt(String(m.mime ?? ""), String(m.name ?? ""));
      const folder = vscode.workspace
        .getConfiguration("mkdocsStudio")
        .get<string>("imagePasteFolder", "assets");
      const docDir = path.dirname(document.uri.fsPath);
      const dirFs = path.resolve(docDir, folder);
      const dirUri = vscode.Uri.file(dirFs);
      await vscode.workspace.fs.createDirectory(dirUri);
      const fileUri = await this.uniqueImageUri(dirUri, String(m.name ?? ""), ext);
      await vscode.workspace.fs.writeFile(fileUri, bytes);
      const rel = path.relative(docDir, fileUri.fsPath).split(path.sep).join("/");
      void panel.webview.postMessage({ type: "imageSaved", token, relPath: rel });
    } catch (err) {
      getLogger().error(`Visual editor: failed to save the image — ${String(err)}`);
      void panel.webview.postMessage({ type: "imageSaveFailed", token, error: String(err) });
    }
  }

  /**
   * The “Choose file…” buttons of the forms: the standard VS Code open dialog,
   * answered with a path relative to the document — that is what goes into the
   * Markdown. A file outside the document's tree keeps its `../` path:
   * rewriting it silently, or copying the file, would be a surprise.
   */
  private async pickFile(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    token: number,
    kind: string,
  ): Promise<void> {
    const docDir = path.dirname(document.uri.fsPath);
    const filters: Record<string, string[]> =
      kind === "image"
        ? { [t("Images")]: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] }
        : { Markdown: ["md", "markdown"], [t("All files")]: ["*"] };
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: vscode.Uri.file(docDir),
      openLabel: t("Insert"),
      filters,
    });
    const file = picked?.[0];
    const rel = file ? path.relative(docDir, file.fsPath).split(path.sep).join("/") : "";
    void panel.webview.postMessage({ type: "filePicked", token, relPath: rel });
  }

  /** Unique name: image.png, image-1.png, … (we never overwrite existing files). */
  private async uniqueImageUri(dir: vscode.Uri, name: string, ext: string): Promise<vscode.Uri> {
    const base = imageBaseName(name);
    for (let i = 0; i < 1000; i++) {
      const uri = vscode.Uri.joinPath(dir, imageCandidate(base, ext, i));
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        return uri; // does not exist — the name is free
      }
    }
    return vscode.Uri.joinPath(dir, `${base}-${Date.now()}.${ext}`);
  }

  private asset(webview: vscode.Webview, ...segments: string[]): string {
    return webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...segments))
      .toString();
  }

  private shellHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const mainCss = this.asset(webview, "assets", "material-css", "main.css");
    const paletteCss = this.asset(webview, "assets", "material-css", "palette.css");
    const fallbackCss = this.asset(webview, "assets", "fallback.css");
    const chromeCss = this.asset(webview, "assets", "site-chrome.css");
    const visualCss = this.asset(webview, "assets", "visual.css");
    const katexCss = this.asset(webview, "assets", "vendor", "katex", "katex.min.css");
    const codiconCss = this.asset(webview, "assets", "vendor", "codicons", "codicon.css");
    const visualJs = this.asset(webview, "dist", "webview", "visual.js");
    const mermaidJs = this.asset(webview, "dist", "webview", "mermaid.js");
    const katexJs = this.asset(webview, "dist", "webview", "katex.js");
    const iconsBase = this.asset(webview, "assets", "icons", "svg");

    const csp = contentSecurityPolicy(webview.cspSource, nonce, {
      img: ["https:", "data:"],
      font: ["https:", "data:"],
      connect: true,
    });

    // The inline formatting placement class is set right away (before the
    // uiConfig message) — otherwise the toolbar would flash its buttons in the
    // “selection only” mode.
    const inlineFormatting = vscode.workspace
      .getConfiguration("mkdocsStudio")
      .get<string>("inlineFormatting", "both");
    const bodyClass = inlineFormatting === "selection" ? "md-typeset vfmt-selection" : "md-typeset";

    return /* html */ `<!DOCTYPE html>
<html lang="${currentLanguage()}" dir="ltr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${mainCss}" />
<link rel="stylesheet" href="${paletteCss}" />
<link rel="stylesheet" href="${katexCss}" />
<link rel="stylesheet" href="${codiconCss}" />
<link rel="stylesheet" href="${fallbackCss}" />
<link rel="stylesheet" href="${chromeCss}" />
<link rel="stylesheet" href="${visualCss}" />
</head>
<body class="${bodyClass}">
<div id="vt">
  <button id="tbStyle" class="vt-style" title="${esc(t("Paragraph style"))}">
    <span class="vt-style-ico">${esc(t("T"))}</span><span class="vt-style-name">${esc(t("Normal text"))}</span><span class="codicon codicon-chevron-down"></span>
  </button>
  <span class="vt-inline">
    <div class="sep"></div>
    <button id="tbBold" data-tip="${esc(t("Bold"))}"><b>${esc(t("B"))}</b></button>
    <button id="tbItalic" data-tip="${esc(t("Italic"))}"><i>${esc(t("I"))}</i></button>
    <button id="tbUnder" data-tip="${esc(t("Underline"))}"><u>${esc(t("U"))}</u></button>
    <button id="tbStrike" data-tip="${esc(t("Strikethrough"))}"><s>${esc(t("S"))}</s></button>
    <button id="tbCode" data-tip="${esc(t("Code"))}"><span class="codicon codicon-code"></span></button>
    <button id="tbMark" data-tip="${esc(t("Highlight"))}">==</button>
    <button id="tbLink" data-tip="${esc(t("Link"))}"><span class="codicon codicon-link"></span></button>
    <button id="tbClear" data-tip="${esc(t("Clear formatting"))}"><span class="codicon codicon-clear-all"></span></button>
  </span>
  <div class="sep"></div>
  <span class="vt-split" id="vtList">
    <button id="tbList" title="${esc(t("Bulleted list"))}"><span class="codicon codicon-list-unordered"></span></button>
    <button id="tbListMenu" class="vt-split-caret" title="${esc(t("List type"))}"><span class="codicon codicon-chevron-down"></span></button>
  </span>
  <div class="sep"></div>
  <span id="vtPinned" class="vt-pinned"></span>
  <button id="tbComponent" title="${t("Insert a Material component (block or inline)")}"><span class="codicon codicon-add"></span> ${esc(t("Insert"))}</button>
  <div class="sep"></div>
  <button id="tbUndo" title="${t("Undo (Cmd/Ctrl+Z)")}"><span class="codicon codicon-discard"></span></button>
  <button id="tbRedo" title="${esc(t("Redo"))}"><span class="codicon codicon-redo"></span></button>
  <div class="grow"></div>
  <span id="vstatus">${esc(t("Loading…"))}</span>
  <button id="tbSettings" title="${esc(t("Editor settings"))}"><span class="codicon codicon-settings-gear"></span></button>
  <button id="tbTheme" title="${esc(t("Theme: light / dark"))}"><span class="codicon codicon-color-mode"></span></button>
  <button id="tbWidth" title="${esc(t("Page width: normal / full width"))}"><span class="codicon codicon-screen-full"></span></button>
  <button id="tbSiteHead" title="${t("Site header (show/hide)")}"><span class="codicon codicon-layout-menubar"></span></button>
  <button id="tbSiteNav" title="${t("Site pages on the left (show/hide)")}"><span class="codicon codicon-layout-sidebar-left"></span></button>
  <button id="tbToc" title="${t("Table of contents (show/hide)")}"><span class="codicon codicon-list-tree"></span></button>
  <button id="tbAsText" title="${esc(t("Open as text"))}"><span class="codicon codicon-go-to-file"></span></button>
</div>
<header id="vhead" class="mv-head"></header>
<div id="vbody">
  <aside id="vnav" class="mv-nav" aria-label="${esc(t("Site navigation"))}"></aside>
  <div id="doc" contenteditable="true" spellcheck="false"></div>
  <aside id="vtoc" aria-label="${esc(t("Table of contents"))}"></aside>
</div>
<script nonce="${nonce}">
window.__visual = { mermaidUri: "${mermaidJs}", katexUri: "${katexJs}", nonce: "${nonce}", iconsBase: "${iconsBase}" };
window.__i18n = ${embedJson({ lang: currentLanguage(), strings: translations() })};
</script>
<script nonce="${nonce}" src="${visualJs}"></script>
</body>
</html>`;
  }
}

/** The document as the edit planner sees it: a count of lines and their lengths. */
function lineDoc(document: vscode.TextDocument): LineDoc {
  return {
    lineCount: document.lineCount,
    lineLength: (line) => document.lineAt(line).text.length,
  };
}

function position(p: DocPosition): vscode.Position {
  return new vscode.Position(p.line, p.ch);
}

function range(start: DocPosition, end: DocPosition): vscode.Range {
  return new vscode.Range(position(start), position(end));
}

/** The file range of the lines [startLine, endLine) — for reading a block's source. */
function docRange(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  const { start, end } = lineRange(lineDoc(document), startLine, endLine);
  return range(start, end);
}
