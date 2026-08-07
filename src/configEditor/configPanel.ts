import * as vscode from "vscode";
import type { ProjectService, MkdocsProject } from "../core/projectService";
import { readMkdocsConfig } from "../core/mkdocsConfig";
import { applyConfigDoc } from "../core/configWriter";
import {
  buildConfigModel,
  applyConfigChange,
  generalFields,
  type ConfigChange,
} from "./configModel";
import { getLogger } from "../util/logger";
import { contentSecurityPolicy, embedJson, esc, makeNonce } from "../util/webviewHtml";
import { currentLanguage, t, translations } from "../core/i18n";

const VIEW_TYPE = "mkdocsStudio.configEditor";

/**
 * Visual editor for mkdocs.yml. Shows tabs (General/Theme/Features/Plugins/
 * Extensions); every change is a surgical YAML patch applied through
 * WorkspaceEdit (undo is preserved), after which the file is saved and
 * mkdocs serve re-reads the configuration.
 */
export class ConfigPanel {
  private panel: vscode.WebviewPanel | undefined;
  private project: MkdocsProject | undefined;
  private applying = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly projects: ProjectService,
  ) {}

  async open(target?: vscode.Uri): Promise<void> {
    this.project = await this.resolveProject(target);
    if (!this.project) {
      void vscode.window.showWarningMessage(t("No MkDocs project found (mkdocs.yml)."));
      return;
    }
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      await this.sendModel();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      t("MkDocs settings"),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );
    this.panel.webview.html = this.shellHtml(this.panel.webview);
    // Nothing above this catch: a handler that throws would otherwise become an
    // unhandled rejection, and the panel would go quiet with no trace of why.
    this.panel.webview.onDidReceiveMessage(
      (m) => {
        this.onMessage(m).catch((err: unknown) => {
          const type = (m as { type?: unknown })?.type;
          getLogger().error(`Settings: message "${String(type)}" failed — ${String(err)}`);
        });
      },
      null,
      this.context.subscriptions,
    );
    this.panel.onDidDispose(() => (this.panel = undefined), null, this.context.subscriptions);
  }

  private async resolveProject(target?: vscode.Uri): Promise<MkdocsProject | undefined> {
    const projects = await this.projects.getProjects();
    if (projects.length === 0) {
      return undefined;
    }
    const hint = target ?? vscode.window.activeTextEditor?.document.uri;
    if (hint) {
      const found = await this.projects.findProjectFor(hint);
      if (found) {
        return found;
      }
    }
    return this.project ?? projects[0];
  }

  private async onMessage(msg: unknown): Promise<void> {
    const m = msg as { type?: string; [k: string]: unknown };
    switch (m.type) {
      case "ready":
        await this.sendModel();
        break;
      case "change":
        await this.applyChange(m.change as ConfigChange);
        break;
      case "openFile":
        await this.openRawFile();
        break;
    }
  }

  private async sendModel(): Promise<void> {
    if (!this.project) {
      return;
    }
    try {
      const { doc } = await readMkdocsConfig(this.project.configFile);
      this.post({ type: "model", model: buildConfigModel(doc), fields: generalFields() });
    } catch (err) {
      getLogger().error(`Failed to read mkdocs.yml: ${String(err)}`);
      this.post({ type: "error", text: t("Failed to read mkdocs.yml.") });
    }
  }

  private async applyChange(change: ConfigChange | undefined): Promise<void> {
    if (!change || !this.project || this.applying) {
      return;
    }
    this.applying = true;
    try {
      // Re-read the file before every edit — an up-to-date AST even if the file
      // was changed from the outside — and apply exactly one surgical patch.
      const { doc } = await readMkdocsConfig(this.project.configFile);
      applyConfigChange(doc, change);
      await applyConfigDoc(this.project.configFile, doc);
      this.post({ type: "model", model: buildConfigModel(doc), fields: generalFields() });
    } catch (err) {
      getLogger().error(`Failed to apply the configuration change: ${String(err)}`);
      this.post({ type: "error", text: t("Failed to save the change.") });
    } finally {
      this.applying = false;
    }
  }

  private async openRawFile(): Promise<void> {
    if (this.project) {
      await vscode.window.showTextDocument(this.project.configFile);
    }
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
    const scriptUri = this.asset(webview, "dist", "webview", "config.js");
    const codiconCss = this.asset(webview, "assets", "vendor", "codicons", "codicon.css");
    const csp = contentSecurityPolicy(webview.cspSource, nonce);

    return /* html */ `<!DOCTYPE html>
<html lang="${currentLanguage()}" dir="ltr">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${codiconCss}" />
<style>
  :root { --gap: .6rem; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0; margin: 0; }
  .tabs { display: flex; gap: .25rem; padding: .5rem .75rem 0; position: sticky; top: 0;
    background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); z-index: 2; }
  .tab { padding: .4rem .8rem; cursor: pointer; font-size: .82rem; border: 1px solid transparent;
    border-bottom: none; border-radius: 5px 5px 0 0; opacity: .7; }
  .tab:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
  .tab.active { opacity: 1; background: var(--vscode-editorWidget-background);
    border-color: var(--vscode-widget-border, transparent); }
  main { padding: 1rem 1.25rem; max-width: 780px; }
  h2 { font-size: .95rem; margin: .2rem 0 1rem; }
  .page { display: none; }
  .page.active { display: block; }
  label.field { display: flex; flex-direction: column; gap: .25rem; font-size: .8rem; margin-bottom: var(--gap); }
  input[type=text], select {
    font: inherit; padding: .35rem .45rem; border-radius: 4px;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #8884));
  }
  .row { display: flex; gap: var(--gap); flex-wrap: wrap; }
  .row > label.field { flex: 1; min-width: 200px; }
  .toggles { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: .3rem .8rem; }
  .toggle { display: flex; align-items: center; gap: .5rem; font-size: .8rem; padding: .2rem 0; }
  .toggle input { margin: 0; }
  .swatches { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .3rem; }
  .swatch { width: 22px; height: 22px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
  .swatch.active { border-color: var(--vscode-focusBorder); }
  .hint { font-size: .72rem; opacity: .6; margin: .2rem 0 1rem; }
  .banner { font-size: .74rem; opacity: .75; padding: .4rem .6rem; margin-bottom: 1rem; border-radius: 4px;
    background: var(--vscode-editorWidget-background); }
  .toolbar { display: flex; justify-content: flex-end; padding: .4rem .75rem; }
  button.link { font: inherit; background: none; border: none; color: var(--vscode-textLink-foreground);
    cursor: pointer; font-size: .76rem; }
  .toast { position: fixed; bottom: 10px; right: 10px; padding: .4rem .7rem; border-radius: 4px;
    background: var(--vscode-notifications-background); border: 1px solid var(--vscode-notifications-border);
    opacity: 0; transition: opacity .2s; font-size: .78rem; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="tabs" id="tabs"></div>
<div class="toolbar"><button class="link" id="openRaw">${esc(t("Open mkdocs.yml as text"))}</button></div>
<main id="main"></main>
<div id="toast" class="toast"></div>
<script nonce="${nonce}">
  window.__config = { nonce: "${nonce}" };
  window.__i18n = ${embedJson({ lang: currentLanguage(), strings: translations() })};
</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
