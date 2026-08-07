import * as vscode from "vscode";
import * as path from "node:path";
import { readMkdocsConfig } from "./mkdocsConfig";
import { rewriteCssUrls } from "./cssUrls";
import type { MkdocsProject } from "./projectService";
import { getLogger } from "../util/logger";

/**
 * The project's custom styles (`extra_css` from mkdocs.yml) for both webviews.
 *
 * The files are read as text and handed over as a single chunk for an inline
 * <style>: linking them via <link> would require keeping the project directory
 * in localResourceRoots, whereas inlining always works. External `https://`
 * entries are skipped — the CSP would block them anyway.
 */

/** Workspace roots for localResourceRoots — they let the webview reach project files. */
export function workspaceRoots(): vscode.Uri[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri);
}

export interface ExtraCssResult {
  /** The CSS of all files joined together (an empty string when there are no styles). */
  css: string;
  /** The files that were actually read — the watcher keeps an eye on them. */
  files: vscode.Uri[];
}

export async function loadExtraCss(
  project: MkdocsProject,
  toWebviewUri: (uri: vscode.Uri) => string,
): Promise<ExtraCssResult> {
  const empty: ExtraCssResult = { css: "", files: [] };
  try {
    const { config } = await readMkdocsConfig(project.configFile);
    if (config.extraCss.length === 0) {
      return empty;
    }
    const docsDir = vscode.Uri.joinPath(project.root, config.docsDir);
    const chunks: string[] = [];
    const files: vscode.Uri[] = [];
    for (const rel of config.extraCss) {
      if (/^(https?:)?\/\//i.test(rel)) {
        continue;
      }
      const uri = vscode.Uri.joinPath(docsDir, rel);
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const css = Buffer.from(bytes).toString("utf8");
        // Paths inside CSS are resolved against the stylesheet itself, not the document.
        const base = vscode.Uri.joinPath(uri, "..");
        chunks.push(
          `/* extra_css: ${rel} */\n` +
            rewriteCssUrls(css, (target) => toWebviewUri(vscode.Uri.joinPath(base, target))),
        );
        files.push(uri);
      } catch {
        getLogger().warn(`extra_css not found — ${rel}`);
      }
    }
    return { css: chunks.join("\n\n"), files };
  } catch (err) {
    getLogger().warn(`Failed to load extra_css — ${String(err)}`);
    return empty;
  }
}

/**
 * Watches the stylesheets and mkdocs.yml itself: an edit to `extra.css` must
 * change the appearance right away, without reopening the tab. Individual files
 * are not watched by name — the list can change together with the config, so we
 * watch every CSS file in docs_dir.
 */
export function watchExtraCss(project: MkdocsProject, reload: () => void): vscode.Disposable {
  const watchers = [
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(project.root, "**/*.css")),
    vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(project.configFile, ".."),
        path.basename(project.configFile.fsPath),
      ),
    ),
  ];
  for (const w of watchers) {
    w.onDidChange(reload);
    w.onDidCreate(reload);
    w.onDidDelete(reload);
  }
  return new vscode.Disposable(() => {
    for (const w of watchers) {
      w.dispose();
    }
  });
}
