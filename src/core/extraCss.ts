import * as vscode from "vscode";
import * as path from "node:path";
import { readMkdocsConfig } from "./mkdocsConfig";
import { rewriteCssUrls } from "./cssUrls";
import { collectSections, resolveSectionPath } from "./monorepo";
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
    // In a monorepo a stylesheet is addressed through the section it belongs to:
    // `lib/stylesheets/extra.css` lives in `lib/docs/stylesheets/`, not in
    // `docs/lib/stylesheets/`. Without sections this is the plain docs_dir join.
    const sections = [...(await collectSections(project, config)).values()];
    const chunks: string[] = [];
    const files: vscode.Uri[] = [];
    for (const rel of config.extraCss) {
      if (/^(https?:)?\/\//i.test(rel)) {
        continue;
      }
      const uri = vscode.Uri.joinPath(
        project.root,
        resolveSectionPath(rel, config.docsDir, sections),
      );
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
    // In a monorepo the list of stylesheets can change in an included config too —
    // it is the one that says where the section's docs_dir is.
    vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(project.root, "**/mkdocs.{yml,yaml}"),
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
