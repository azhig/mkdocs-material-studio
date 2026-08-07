import * as vscode from "vscode";
import * as path from "node:path";
import type { ProjectService, MkdocsProject } from "../core/projectService";
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
  type ChromeScope,
} from "../core/siteChrome";
import { externalTarget, findLinkTarget, isMarkdownPath, parseDocLink } from "../core/docLinks";
import { currentLanguage, t, translations } from "../core/i18n";
import { affectsPalette, pageBackground, type FallbackRenderFn } from "./fallbackRenderer";
import { fileExists } from "../util/files";
import { getLogger } from "../util/logger";
import { contentSecurityPolicy, embedJson, esc, makeNonce } from "../util/webviewHtml";

export const PREVIEW_VIEW_TYPE = "mkdocsStudio.preview";

/** How long after a preview scroll we ignore the sync coming back from the editor. */
const ECHO_WINDOW_MS = 400;

/** Source block range: [startLine, endLine), same as token.map. */
export interface BlockSourceRange {
  startLine: number;
  endLine: number;
}

/** Click handler for a block in the lightweight preview (M6, click-to-edit). */
export type BlockClickHandler = (
  doc: vscode.TextDocument,
  range: BlockSourceRange,
  blockType: string | undefined,
) => void;

/**
 * Manages the preview panel: the active document, the page shell and the
 * messages of the webview. The page is always drawn by the built-in renderer —
 * running a site of one's own is the reader's business, not the editor's.
 */
export class PreviewPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private currentDoc: vscode.Uri | undefined;
  private currentProject: MkdocsProject | undefined;
  private cssWatch: vscode.Disposable | undefined;
  private chromeWatch: vscode.Disposable | undefined;
  /** Navigation scope: the MkDocs project or the workspace folder of the open file. */
  private scope: ChromeScope | undefined;
  /** Time of the last scroll of the preview itself — used to damp the echo. */
  private lastPreviewScroll = 0;
  private fallbackRender: FallbackRenderFn | undefined;
  private blockClickHandler: BlockClickHandler | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectService,
  ) {}

  setFallbackRenderer(fn: FallbackRenderFn): void {
    this.fallbackRender = fn;
  }

  setBlockClickHandler(fn: BlockClickHandler): void {
    this.blockClickHandler = fn;
  }

  /**
   * Opens the preview. By default it becomes a full tab in the current group —
   * the same as the visual editor; `beside` keeps the classic split view where
   * the text stays on one side and the rendered page on the other.
   */
  async open(source?: vscode.Uri, options?: { beside?: boolean }): Promise<void> {
    const target = source ?? vscode.window.activeTextEditor?.document.uri;
    const beside = options?.beside === true;
    const column = beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
    if (this.panel) {
      // Keep the focus in the editor only for the split view: with a full tab
      // the reader expects to land in the page they have just opened.
      this.panel.reveal(column, beside);
    } else {
      const panel = vscode.window.createWebviewPanel(
        PREVIEW_VIEW_TYPE,
        t("MkDocs Preview"),
        { viewColumn: column, preserveFocus: beside },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.context.extensionUri, ...workspaceRoots()],
        },
      );
      this.adoptPanel(panel);
      getLogger().info(`Preview panel created (${beside ? "beside" : "active group"})`);
    }
    await this.setActiveDoc(target);
  }

  /**
   * Restores the panel after a window reload (WebviewPanelSerializer):
   * reattaches it to the manager and shows the active document.
   */
  async restore(panel: vscode.WebviewPanel): Promise<void> {
    this.adoptPanel(panel);
    await this.setActiveDoc(vscode.window.activeTextEditor?.document.uri);
  }

  /** Attaches the panel to the manager: HTML, message and dispose handlers. */
  private adoptPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel;
    panel.webview.options = {
      enableScripts: true,
      // Workspace folders — for the assets referenced by extra_css.
      localResourceRoots: [this.context.extensionUri, ...workspaceRoots()],
    };
    panel.webview.html = this.shellHtml(panel.webview);
    // Nothing above this catch: a handler that throws would otherwise become an
    // unhandled rejection, and the preview would go quiet with no trace of why.
    panel.webview.onDidReceiveMessage(
      (msg) => {
        this.onMessage(msg).catch((err: unknown) => {
          const type = (msg as { type?: unknown })?.type;
          getLogger().error(`Preview: message "${String(type)}" failed — ${String(err)}`);
        });
      },
      null,
      this.context.subscriptions,
    );
    // The header/navigation button may have been pressed in the visual editor — the state is shared.
    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (affectsChromeVisibility(e)) {
        this.postChromeState();
      }
      // The palette lives in the render message — a new color needs a redraw.
      if (affectsPalette(e)) {
        void this.refresh();
      }
    });
    panel.onDidDispose(
      () => {
        cfgSub.dispose();
        this.onPanelDisposed();
      },
      null,
      this.context.subscriptions,
    );
  }

  async update(doc: vscode.Uri | undefined): Promise<void> {
    if (!this.panel || !doc) {
      return;
    }
    if (doc.toString() === this.currentDoc?.toString()) {
      await this.refresh();
      return;
    }
    await this.setActiveDoc(doc);
  }

  /** Scroll sync: reveal line `line` in the preview. */
  syncScroll(uri: vscode.Uri, line: number): void {
    if (uri.toString() !== this.currentDoc?.toString()) {
      return;
    }
    // Damp the echo: scrolling the preview moves the editor, which then reports
    // its new visible lines — without this check the preview would jump back to
    // the start of the block (visually it “twitches and drifts upwards”).
    if (Date.now() - this.lastPreviewScroll < ECHO_WINDOW_MS) {
      return;
    }
    const enabled = vscode.workspace
      .getConfiguration("mkdocsStudio")
      .get<boolean>("scrollSync", true);
    if (enabled) {
      this.post({ type: "scrollTo", line });
    }
  }

  /**
   * Rebuilds the page shell — used when the interface language changes.
   * The toolbar lives in the shell HTML, so a message would not be enough.
   */
  reloadUi(): void {
    if (this.panel) {
      this.panel.webview.html = this.shellHtml(this.panel.webview);
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async setActiveDoc(doc: vscode.Uri | undefined): Promise<void> {
    this.currentDoc = doc;
    const prevProject = this.currentProject;
    this.currentProject = doc ? await this.projects.findProjectFor(doc) : undefined;
    const projectChanged = prevProject?.root.toString() !== this.currentProject?.root.toString();
    // The navigation scope changes even without a project change: a file outside
    // MkDocs takes its own workspace folder as the root — there we list Markdown
    // files instead of nav.
    const prevRoot = this.scope?.root.toString();
    this.scope = doc ? await chromeScope(doc, this.currentProject) : undefined;
    const rootChanged = prevRoot !== this.scope?.root.toString();
    if (projectChanged) {
      this.watchCss();
    }
    if (rootChanged) {
      this.watchChrome();
    }
    this.ensureResourceAccess(doc);
    await this.refresh();
    if (projectChanged) {
      await this.postExtraCss();
    }
    if (rootChanged) {
      await this.postSiteChrome();
    }
    this.postSiteActive();
  }

  /**
   * A webview may only load files from the roots it was granted. Those are the
   * workspace folders — a document opened outside of them (a lone README) would
   * have every one of its images blocked, so its own folder is added on demand.
   */
  private ensureResourceAccess(doc: vscode.Uri | undefined): void {
    if (!this.panel || !doc || doc.scheme !== "file") {
      return;
    }
    const dir = vscode.Uri.file(path.dirname(doc.fsPath));
    const extra = this.currentProject ? [this.currentProject.root, dir] : [dir];
    const roots = this.panel.webview.options.localResourceRoots ?? [];
    const covered = (uri: vscode.Uri): boolean =>
      roots.some(
        (root) => uri.fsPath === root.fsPath || uri.fsPath.startsWith(root.fsPath + path.sep),
      );
    const missing = extra.filter((uri) => !covered(uri));
    if (missing.length === 0) {
      return;
    }
    this.panel.webview.options = {
      ...this.panel.webview.options,
      localResourceRoots: [...roots, ...missing],
    };
  }

  private async refresh(): Promise<void> {
    if (!this.panel) {
      return;
    }
    await this.refreshFallback();
  }

  private async refreshFallback(): Promise<void> {
    if (!this.panel) {
      return;
    }
    if (!this.currentDoc) {
      this.post({ type: "overlay", kind: "info", text: t("Open a Markdown file to preview it.") });
      return;
    }
    if (!this.fallbackRender) {
      this.post({ type: "overlay", kind: "info", text: t("The renderer is not available.") });
      return;
    }
    const doc = await vscode.workspace.openTextDocument(this.currentDoc);
    const webview = this.panel?.webview;
    const { html, palette } = await this.fallbackRender(
      doc,
      this.currentProject,
      undefined,
      (uri) => (webview ? webview.asWebviewUri(uri).toString() : uri.toString()),
    );
    this.post({ type: "overlay", kind: "none" });
    // The webview needs docId to tell a re-render of the same page (the scroll
    // position must be kept) from a switch to another one (start at the top).
    this.post({
      type: "render",
      html,
      palette,
      background: pageBackground(this.currentDoc),
      docId: this.currentDoc.toString(),
    });
  }

  /**
   * The project's custom styles (extra_css) — the same ones as in the visual editor:
   * the page in the preview must look exactly like it does on the site.
   *
   * Called on an event (panel opened, project changed, styles edited) and not
   * from refreshFallback: that one runs on every keystroke, and reading files
   * from disk there would be wasted work. In serve mode the styles are not
   * needed — MkDocs links them itself.
   */
  private async postExtraCss(): Promise<void> {
    const panel = this.panel;
    if (!panel || !this.currentProject) {
      return;
    }
    const { css } = await loadExtraCss(this.currentProject, (uri) =>
      panel.webview.asWebviewUri(uri).toString(),
    );
    this.post({ type: "extraCss", css });
  }

  /**
   * The site header and the page tree for the left panel. Like the styles, they
   * are sent on an event: the site structure changes far less often than the
   * text of the open page.
   */
  private async postSiteChrome(): Promise<void> {
    const panel = this.panel;
    const scope = this.scope;
    if (!panel || !scope) {
      return;
    }
    try {
      const data = await buildSiteChrome(
        scope,
        (uri) => panel.webview.asWebviewUri(uri).toString(),
        this.context.extensionUri,
      );
      this.post({ type: "siteChrome", data });
    } catch (err) {
      getLogger().warn(`Preview: failed to build the navigation — ${String(err)}`);
    }
  }

  /** Current state of the “Header” and “Navigation” buttons. */
  private postChromeState(): void {
    this.post({ type: "chromeState", ...chromeVisibility() });
  }

  private async setChromeVisibility(header: unknown, nav: unknown, toc: unknown): Promise<void> {
    await saveChromeVisibility(header, nav, toc);
    this.postChromeState();
  }

  /** Which page is open right now — the panel highlights it. */
  private postSiteActive(): void {
    if (!this.panel || !this.scope || !this.currentDoc) {
      return;
    }
    this.post({ type: "siteActive", active: activePagePath(this.scope, this.currentDoc) });
  }

  /** Watches the project styles: an edit to extra.css shows up immediately. */
  private watchCss(): void {
    this.cssWatch?.dispose();
    this.cssWatch = this.currentProject
      ? watchExtraCss(this.currentProject, () => void this.postExtraCss())
      : undefined;
  }

  /** Watches the page set of the scope (mkdocs.yml or the workspace folder files). */
  private watchChrome(): void {
    this.chromeWatch?.dispose();
    this.chromeWatch = this.scope
      ? watchSiteChrome(this.scope.root, () => void this.postSiteChrome())
      : undefined;
  }

  /**
   * Click on a page in the left panel: show it in the preview itself, the way
   * navigating a real site works. We deliberately do not open the source — the
   * preview is usually a full tab, and opening an editor would split the screen
   * and throw the reader out of reading. Editing still starts from a click on a
   * block.
   */
  private async openPage(rel: string): Promise<void> {
    if (!this.scope || rel === "") {
      return;
    }
    const target = pageUri(this.scope, rel);
    try {
      await vscode.workspace.fs.stat(target);
    } catch {
      // A stale entry in nav: the file is listed but missing on disk.
      void vscode.window.showWarningMessage(t("Page not found: {0}", rel));
      return;
    }
    await this.setActiveDoc(target);
  }

  /**
   * A link inside the page. On the published site the reader would simply move
   * to the next page, so that is what a click does here as well: a Markdown
   * target replaces the page in the preview itself. Anything else — an image, a
   * PDF, a file of another kind — is handed to VS Code, and an address with a
   * scheme of its own goes to the browser.
   */
  private async openDocLink(href: string): Promise<void> {
    const link = parseDocLink(href);
    if (!link || link.kind === "anchor" || !this.currentDoc) {
      return; // an anchor is scrolled to by the webview itself
    }
    if (link.kind === "external") {
      await this.openExternal(link.target);
      return;
    }
    const docDir = path.dirname(this.currentDoc.fsPath);
    const file = await findLinkTarget(
      link,
      docDir,
      this.scope?.pagesRoot.fsPath ?? docDir,
      fileExists,
    );
    if (!file) {
      void vscode.window.showWarningMessage(t("Page not found: {0}", href));
      return;
    }
    if (!isMarkdownPath(file)) {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
      return;
    }
    await this.setActiveDoc(vscode.Uri.file(file));
    if (link.hash !== "") {
      this.post({ type: "revealAnchor", hash: link.hash });
    }
  }

  /**
   * Hands an address to the system, but only one of the schemes a reader
   * expects — the page is text somebody else wrote (see docLinks).
   */
  private async openExternal(href: string): Promise<void> {
    const external = externalTarget(href);
    if (!external) {
      getLogger().warn(`Preview: refused to open an address of this kind — ${href}`);
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(external));
  }

  private async onMessage(msg: unknown): Promise<void> {
    const m = msg as { type?: string; [k: string]: unknown };
    switch (m.type) {
      case "ready":
        // The webview may have reloaded (after a VS Code theme change, say) —
        // along with the render we send back the project styles, the header
        // and the navigation.
        this.postChromeState();
        await this.refresh();
        await this.postExtraCss();
        await this.postSiteChrome();
        this.postSiteActive();
        break;
      case "setChrome":
        await this.setChromeVisibility(m.header, m.nav, m.toc);
        break;
      case "openPage":
        await this.openPage(String(m.path ?? ""));
        break;
      case "openConfig":
        // The document's own uri, not the workspace root: in a monorepo every
        // page belongs to the nearest mkdocs.yml up the tree.
        await vscode.commands.executeCommand("mkdocsStudio.openConfigEditor", this.currentDoc);
        break;
      case "openLink":
        await this.openExternal(String(m.href ?? ""));
        break;
      case "openDocLink":
        await this.openDocLink(String(m.href ?? ""));
        break;
      case "reveal":
        this.lastPreviewScroll = Date.now();
        this.revealSourceLine(Number(m.line));
        break;
      case "blockClick":
        this.onBlockClick(Number(m.line), Number(m.endLine), m.blockType as string | undefined);
        break;
    }
  }

  private onBlockClick(line: number, endLine: number, blockType: string | undefined): void {
    if (Number.isNaN(line) || !this.currentDoc) {
      return;
    }
    if (this.blockClickHandler) {
      const range = { startLine: line, endLine: Number.isNaN(endLine) ? line + 1 : endLine };
      void vscode.workspace
        .openTextDocument(this.currentDoc)
        .then((doc) => this.blockClickHandler?.(doc, range, blockType));
    } else {
      this.revealSourceLine(line);
    }
  }

  private revealSourceLine(line: number): void {
    if (Number.isNaN(line) || !this.currentDoc) {
      return;
    }
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.currentDoc?.toString(),
    );
    if (editor) {
      const range = new vscode.Range(line, 0, line, 0);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  private post(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private onPanelDisposed(): void {
    this.panel = undefined;
    this.cssWatch?.dispose();
    this.cssWatch = undefined;
    this.chromeWatch?.dispose();
    this.chromeWatch = undefined;
  }

  private assetUri(webview: vscode.Webview, ...segments: string[]): string {
    return webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...segments))
      .toString();
  }

  private shellHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const mainCss = this.assetUri(webview, "assets", "material-css", "main.css");
    const paletteCss = this.assetUri(webview, "assets", "material-css", "palette.css");
    const fallbackCss = this.assetUri(webview, "assets", "fallback.css");
    const chromeCss = this.assetUri(webview, "assets", "site-chrome.css");
    const codiconCss = this.assetUri(webview, "assets", "vendor", "codicons", "codicon.css");
    const katexCss = this.assetUri(webview, "assets", "vendor", "katex", "katex.min.css");
    const previewJs = this.assetUri(webview, "dist", "webview", "preview.js");
    const mermaidJs = this.assetUri(webview, "dist", "webview", "mermaid.js");

    const csp = contentSecurityPolicy(webview.cspSource, nonce, {
      img: ["https:", "data:"],
      font: ["https:", "data:"],
    });

    return /* html */ `<!DOCTYPE html>
<html lang="${currentLanguage()}" dir="ltr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${mainCss}" />
<link rel="stylesheet" href="${paletteCss}" />
<link rel="stylesheet" href="${katexCss}" />
<link rel="stylesheet" href="${fallbackCss}" />
<link rel="stylesheet" href="${chromeCss}" />
<link rel="stylesheet" href="${codiconCss}" />
<style>
  #toolbar {
    display: flex; align-items: center; gap: .5rem;
    padding: .25rem .5rem; font-size: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background); color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
  }
  #toolbar .grow { flex: 1; opacity: .7; }
  #toolbar button {
    display: inline-flex; align-items: center; justify-content: center;
    font: inherit; cursor: pointer;
    color: var(--vscode-foreground); background: transparent;
    border: none; padding: .2rem .35rem; border-radius: 4px;
  }
  #toolbar button .codicon { font-size: 16px; }
  #toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground)); }
  #toolbar button.on {
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  #toolbar button:disabled { opacity: .4; cursor: default; background: transparent; }
  /* Column: toolbar, site header, canvas. The canvas height is computed by flex
     and not by calc(100vh - …) — otherwise the header would push the content
     past the bottom edge. */
  body { display: flex; flex-direction: column; height: 100vh; }
  #stage { position: relative; flex: 1; min-height: 0; }
  #siteHead { display: none; flex: 0 0 auto; }
  body.mv-show-head #siteHead { display: block; }
  #pane { display: flex; height: 100%; }
  #siteNav { display: none; flex: 0 0 15rem; height: 100%; overflow: auto; }
  body.mv-show-nav #siteNav { display: block; }
  #pageToc { display: none; flex: 0 0 14rem; height: 100%; overflow: auto; }
  body.mv-show-toc #pageToc { display: block; }
  #content { flex: 1; min-width: 0; height: 100%; overflow: auto; }
  #overlay {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center; text-align: center;
    padding: 2rem; background: var(--vscode-editor-background); color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
  }
  #overlay.show { display: flex; }
  #overlay .box { max-width: 640px; }
  #overlay.error .box { color: var(--vscode-errorForeground); }
  #overlay pre {
    text-align: left; white-space: pre-wrap; margin-top: 1rem;
    font-family: var(--vscode-editor-font-family); font-size: 12px;
    background: var(--vscode-textCodeBlock-background); padding: .75rem; border-radius: 4px;
  }
  .spinner {
    width: 18px; height: 18px; border: 2px solid currentColor;
    border-top-color: transparent; border-radius: 50%; display: inline-block;
    animation: spin 1s linear infinite; vertical-align: middle; margin-right: .5rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="toolbar">
  <span id="modeLabel" class="grow">MkDocs</span>
  <button id="btnConfig" title="${esc(t("Site settings — mkdocs.yml"))}"><span class="codicon codicon-settings-gear"></span></button>
  <button id="btnHead" title="${esc(t("Site header, as on the MkDocs site"))}"><span class="codicon codicon-layout-menubar"></span></button>
  <button id="btnNav" title="${esc(t("List of site pages"))}"><span class="codicon codicon-layout-sidebar-left"></span></button>
  <button id="btnToc" title="${esc(t("Headings of this page"))}"><span class="codicon codicon-list-tree"></span></button>
  <button id="btnTheme" title="${esc(t("Theme: light / dark"))}"><span class="codicon codicon-color-mode"></span></button>
</div>
<header id="siteHead" class="mv-head"></header>
<div id="stage">
  <div id="pane" style="display:none">
    <aside id="siteNav" class="mv-nav" aria-label="${esc(t("Site navigation"))}"></aside>
    <div id="content" class="md-typeset"></div>
    <aside id="pageToc" class="mv-toc" aria-label="${esc(t("On this page"))}"></aside>
  </div>
  <div id="overlay" class="show"><div class="box"><span class="spinner"></span>${esc(t("Initializing…"))}</div></div>
</div>
<script nonce="${nonce}">
  window.__mkdocsPreview = { mermaidUri: "${mermaidJs}", nonce: "${nonce}" };
  window.__i18n = ${embedJson({ lang: currentLanguage(), strings: translations() })};
</script>
<script nonce="${nonce}" src="${previewJs}"></script>
</body>
</html>`;
  }
}
