import * as vscode from "vscode";
import * as path from "node:path";

/** Details of a discovered MkDocs project. */
export interface MkdocsProject {
  /** Project root — the directory that contains mkdocs.yml. */
  readonly root: vscode.Uri;
  /** Configuration file (mkdocs.yml or mkdocs.yaml). */
  readonly configFile: vscode.Uri;
  /** Directory with the Markdown page sources (<root>/docs by default). */
  readonly docsDir: vscode.Uri;
}

const CONFIG_NAMES = ["mkdocs.yml", "mkdocs.yaml"];

/** Directories where looking for the config is pointless: dependencies and build output. */
const SEARCH_EXCLUDE = "**/{node_modules,site,dist,build,out,vendor,.venv,venv,__pycache__}/**";

/** Ceiling on the number of projects in one workspace — protection against huge monorepos. */
const MAX_PROJECTS = 50;

/** How many levels to walk up from the file when there is no workspace at all. */
const MAX_WALK_UP = 12;

/**
 * Discovers MkDocs projects in the open workspace folders.
 *
 * The config is looked for not only in the root: in monorepos the site lives in
 * a nested directory (`docs/mkdocs.yml`, `packages/site/mkdocs.yml`), and such a
 * project used to not be found at all — the preview silently worked without the
 * palette, the styles and the navigation. The result is cached, and the cache is
 * invalidated by the mkdocs.yml watcher.
 */
export class ProjectService {
  private cache: MkdocsProject[] | undefined;

  /** Returns the list of discovered projects, caching the result. */
  async getProjects(): Promise<MkdocsProject[]> {
    if (this.cache) {
      return this.cache;
    }
    const found = await vscode.workspace.findFiles(
      `**/mkdocs.{yml,yaml}`,
      SEARCH_EXCLUDE,
      MAX_PROJECTS,
    );
    const projects = found.map((configFile) => this.projectAt(configFile));
    // The closer to the root, the earlier in the list: where there is a single
    // project it will be the first one (the navigation tree shows exactly the
    // first one).
    projects.sort((a, b) => a.root.fsPath.length - b.root.fsPath.length);
    this.cache = projects;
    return projects;
  }

  /** Returns the project the given file belongs to, if there is one. */
  async findProjectFor(resource: vscode.Uri): Promise<MkdocsProject | undefined> {
    const projects = await this.getProjects();
    // The nearest config up the tree: a file in a monorepo can have several
    // candidates (the root site and a nested one) — the deepest one wins.
    let best: MkdocsProject | undefined;
    for (const project of projects) {
      if (isInside(resource.fsPath, project.root.fsPath)) {
        if (!best || project.root.fsPath.length > best.root.fsPath.length) {
          best = project;
        }
      }
    }
    return best ?? (await this.walkUpFrom(resource));
  }

  /** Invalidates the cache (for example, when workspace folders or mkdocs.yml change). */
  invalidate(): void {
    this.cache = undefined;
  }

  /**
   * Walking up the directories from the file itself. Needed when findFiles is
   * powerless: the file is open outside the workspace folder, or the config sits
   * in a directory excluded from the search.
   */
  private async walkUpFrom(resource: vscode.Uri): Promise<MkdocsProject | undefined> {
    let dir = path.dirname(resource.fsPath);
    for (let i = 0; i < MAX_WALK_UP; i++) {
      const configFile = await this.findConfigIn(vscode.Uri.file(dir));
      if (configFile) {
        const project = this.projectAt(configFile);
        this.cache = [...(this.cache ?? []), project];
        return project;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return undefined; // reached the root of the file system
      }
      dir = parent;
    }
    return undefined;
  }

  private projectAt(configFile: vscode.Uri): MkdocsProject {
    const root = vscode.Uri.joinPath(configFile, "..");
    return { root, configFile, docsDir: vscode.Uri.joinPath(root, "docs") };
  }

  private async findConfigIn(folder: vscode.Uri): Promise<vscode.Uri | undefined> {
    for (const name of CONFIG_NAMES) {
      const candidate = vscode.Uri.joinPath(folder, name);
      try {
        await vscode.workspace.fs.stat(candidate);
        return candidate;
      } catch {
        // no such file — try the next name
      }
    }
    return undefined;
  }
}

/** Is the file inside the directory (compared on a separator boundary). */
function isInside(file: string, dir: string): boolean {
  return file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}
