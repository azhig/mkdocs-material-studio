import * as vscode from "vscode";
import * as path from "node:path";
import { parseMkdocsConfig, type NavItem } from "./mkdocsConfigParse";
import { includeTargetOf, rootIncludeConfig } from "./monorepoParse";
import { getLogger } from "../util/logger";

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

/** What one discovery pass produced: the projects and how they include one another. */
interface Discovered {
  projects: MkdocsProject[];
  /** Config path → the config whose nav includes it (`!include`), both as fsPath. */
  includedBy: Map<string, string>;
}

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
  private cache: Discovered | undefined;

  /** Returns the list of discovered projects, caching the result. */
  async getProjects(): Promise<MkdocsProject[]> {
    return (await this.discover()).projects;
  }

  /** Returns the project the given file belongs to, if there is one. */
  async findProjectFor(resource: vscode.Uri): Promise<MkdocsProject | undefined> {
    const { projects, includedBy } = await this.discover();
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
    if (best) {
      return this.rootOf(best, projects, includedBy);
    }
    return this.walkUpFrom(resource);
  }

  /** Invalidates the cache (for example, when workspace folders or mkdocs.yml change). */
  invalidate(): void {
    this.cache = undefined;
  }

  private async discover(): Promise<Discovered> {
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
    this.cache = { projects, includedBy: await includeMap(projects) };
    return this.cache;
  }

  /**
   * The config that owns the site an included one belongs to.
   *
   * An `!include`d config describes a SECTION: its nav has no tabs, it carries no
   * extra_css and usually no palette. Answering with it — which is what the
   * deepest-config rule does on its own — means the page is previewed without the
   * styles and without the navigation of the site it is actually part of.
   */
  private rootOf(
    project: MkdocsProject,
    projects: MkdocsProject[],
    includedBy: Map<string, string>,
  ): MkdocsProject {
    const rootPath = rootIncludeConfig(project.configFile.fsPath, includedBy);
    if (rootPath === project.configFile.fsPath) {
      return project;
    }
    return projects.find((p) => p.configFile.fsPath === rootPath) ?? project;
  }

  /**
   * Walking up the directories from the file itself. Needed when findFiles is
   * powerless: the file is open outside the workspace folder, or the config sits
   * in a directory excluded from the search.
   *
   * Every config up the path is collected, not just the first one: the nearest may
   * well be an included section, and then the site it belongs to is higher up.
   */
  private async walkUpFrom(resource: vscode.Uri): Promise<MkdocsProject | undefined> {
    const found: MkdocsProject[] = [];
    let dir = path.dirname(resource.fsPath);
    for (let i = 0; i < MAX_WALK_UP; i++) {
      const configFile = await this.findConfigIn(vscode.Uri.file(dir));
      if (configFile) {
        found.push(this.projectAt(configFile));
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break; // reached the root of the file system
      }
      dir = parent;
    }
    const nearest = found[0];
    if (!nearest) {
      return undefined;
    }
    const project = this.rootOf(nearest, found, await includeMap(found));
    this.cache = {
      projects: [...(this.cache?.projects ?? []), project],
      includedBy: this.cache?.includedBy ?? new Map(),
    };
    return project;
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

/**
 * Which config includes which, read out of the nav of each. Only the configs
 * already discovered take part: an `!include` pointing outside them is a project
 * we know nothing about anyway.
 */
async function includeMap(projects: MkdocsProject[]): Promise<Map<string, string>> {
  const includedBy = new Map<string, string>();
  for (const project of projects) {
    let nav;
    try {
      const bytes = await vscode.workspace.fs.readFile(project.configFile);
      nav = parseMkdocsConfig(Buffer.from(bytes).toString("utf8")).config.nav;
    } catch (err) {
      getLogger().info(`Projects: config not read — ${project.configFile.fsPath} (${String(err)})`);
      continue;
    }
    for (const target of includeTargets(nav ?? [])) {
      const child = vscode.Uri.joinPath(project.root, target).fsPath;
      // The first config to claim a child keeps it: two sites including the same
      // section is not a shape MkDocs builds, and guessing between them helps nobody.
      if (!includedBy.has(child)) {
        includedBy.set(child, project.configFile.fsPath);
      }
    }
  }
  return includedBy;
}

/** Every `!include` target of a nav, sections included. */
function includeTargets(nav: NavItem[]): string[] {
  const out: string[] = [];
  for (const item of nav) {
    if (item.kind === "section") {
      out.push(...includeTargets(item.children));
      continue;
    }
    const target = includeTargetOf(item);
    if (target !== undefined) {
      out.push(target);
    }
  }
  return out;
}

/** Is the file inside the directory (compared on a separator boundary). */
function isInside(file: string, dir: string): boolean {
  return file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}
