// Site header and the left navigation panel: collecting data from mkdocs.yml
// and docs/.
//
// Both modes (the lightweight preview and the visual editor) receive the very same
// structure in a `siteChrome` message and render it with a shared webview module.
// Building the page tree lives in the pure siteNavBuild.ts (covered by vitest).
//
// Without mkdocs.yml a fallback kicks in — an index of the Markdown files of the
// whole workspace folder: ordinary documentation inside a project deserves a page
// list too.

import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { readMkdocsConfig, type MkdocsConfig, type NavItem } from "./mkdocsConfig";
import {
  navFromConfig,
  navFromFiles,
  navFromFolder,
  firstHeading,
  isEntryPage,
  markdownLinks,
  resolveLink,
  type SiteNode,
} from "./siteNavBuild";
import type { MkdocsProject } from "./projectService";
import { getLogger } from "../util/logger";

/** Header and navigation data in the exact shape the webview receives. */
export interface SiteChromeData {
  siteName: string;
  /** Image logo (theme.logo) — already a webview address. */
  logoUri?: string;
  /** Icon logo (theme.icon.logo) — inlined SVG. */
  logoSvg?: string;
  repoUrl?: string;
  repoName?: string;
  /** The navigation.tabs feature is on — the top level is shown as tabs. */
  tabs: boolean;
  nav: SiteNode[];
}

/**
 * How many files to read for the sake of their H1 heading. A limit for huge
 * sites: the remaining pages get their title from the file name (just like
 * MkDocs does when there is no H1 at all).
 */
const MAX_TITLE_FILES = 500;

/** Index ceiling without mkdocs.yml — there the whole workspace folder is walked. */
const MAX_FOLDER_PAGES = 2000;

/** Traversal depth: protection against symbolic links looping back on themselves. */
const MAX_DEPTH = 12;

/** Directories that must not appear in the index: dependencies, builds, internals. */
const SKIP_DIRS = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "site",
  "target",
  "coverage",
  "venv",
  "env",
  "__pycache__",
  "Pods",
]);

/** Page read cache: path → mtime + title (null — no H1) + links. */
const pageCache = new Map<string, { mtimeMs: number; title: string | null; links: string[] }>();

/**
 * The navigation scope: either an MkDocs project (pages from docs_dir according
 * to mkdocs.yml) or just a workspace folder — then we build an index of every
 * Markdown file.
 */
export interface ChromeScope {
  /** Root of the scope — the watcher keeps an eye on it. */
  root: vscode.Uri;
  /** Pages directory: the project's docs_dir or the same root. */
  pagesRoot: vscode.Uri;
  project?: MkdocsProject;
  config?: MkdocsConfig;
}

/**
 * Determines the scope for the open document. Without an MkDocs project we take
 * the document's workspace folder, and if it is outside the workspace — its own
 * directory.
 */
export async function chromeScope(
  doc: vscode.Uri,
  project: MkdocsProject | undefined,
): Promise<ChromeScope> {
  if (project) {
    try {
      const { config } = await readMkdocsConfig(project.configFile);
      return { root: project.root, pagesRoot: docsRootOf(project, config), project, config };
    } catch (err) {
      getLogger().warn(`Navigation: failed to read the config — ${String(err)}`);
      return { root: project.root, pagesRoot: project.root, project };
    }
  }
  const folder =
    vscode.workspace.getWorkspaceFolder(doc)?.uri ?? vscode.Uri.file(path.dirname(doc.fsPath));
  return { root: folder, pagesRoot: folder };
}

export async function buildSiteChrome(
  scope: ChromeScope,
  toWebviewUri: (uri: vscode.Uri) => string,
  extensionUri: vscode.Uri,
): Promise<SiteChromeData> {
  const config = scope.config;
  if (!config) {
    return buildFolderChrome(scope);
  }
  const docsRoot = scope.pagesRoot;
  const files = await listMarkdown(docsRoot.fsPath);
  const wanted = config.nav ? navPagePaths(config.nav) : files;
  const pages = await readPages(docsRoot.fsPath, wanted);
  const titleOf = (rel: string): string | undefined => pages.get(rel)?.title ?? undefined;

  return {
    siteName: config.siteName ?? path.basename(scope.root.fsPath),
    logoUri: config.theme.logo
      ? toWebviewUri(vscode.Uri.joinPath(docsRoot, config.theme.logo))
      : undefined,
    logoSvg: await readIconSvg(extensionUri, config.theme.icon?.logo),
    repoUrl: config.repoUrl,
    repoName: config.repoUrl ? (config.repoName ?? hostLabel(config.repoUrl)) : undefined,
    tabs: config.theme.features?.includes("navigation.tabs") === true,
    nav: config.nav ? navFromConfig(config.nav, titleOf) : navFromFiles(files, titleOf),
  };
}

/**
 * Markdown index for a project without mkdocs.yml. The order comes from the
 * tables of contents (SUMMARY.md/README.md/index.md of every directory), but the
 * tree is built from the files — a page nothing links to is still visible.
 */
async function buildFolderChrome(scope: ChromeScope): Promise<SiteChromeData> {
  const root = scope.pagesRoot.fsPath;
  const all = await listMarkdown(root);
  const files = all.slice(0, MAX_FOLDER_PAGES);
  if (all.length > files.length) {
    getLogger().warn(
      `Navigation: ${all.length} pages, showing the first ${files.length} (no mkdocs.yml)`,
    );
  }
  // Tables of contents are read first: the read limit is lower than the index
  // size, and it is exactly they that define the order inside a directory — they
  // must not be lost to the limit.
  const pages = await readPages(root, [
    ...files.filter(isEntryPage),
    ...files.filter((rel) => !isEntryPage(rel)),
  ]);
  return {
    siteName: path.basename(root) || "Markdown",
    tabs: false,
    nav: navFromFolder(
      files,
      (rel) => pages.get(rel)?.title ?? undefined,
      (rel) => pages.get(rel)?.links ?? [],
    ),
  };
}

/** Directory holding the page sources (docs_dir can be overridden). */
function docsRootOf(project: MkdocsProject, config: MkdocsConfig): vscode.Uri {
  return path.isAbsolute(config.docsDir)
    ? vscode.Uri.file(config.docsDir)
    : vscode.Uri.joinPath(project.root, config.docsDir);
}

/** Document path relative to the pages directory — the webview marks the active page by it. */
export function activePagePath(scope: ChromeScope, uri: vscode.Uri): string | undefined {
  const rel = path.relative(scope.pagesRoot.fsPath, uri.fsPath);
  return rel.startsWith("..") || path.isAbsolute(rel) ? undefined : rel.split(path.sep).join("/");
}

/** Page file for a path coming from the navigation. */
export function pageUri(scope: ChromeScope, relPath: string): vscode.Uri {
  return vscode.Uri.joinPath(scope.pagesRoot, relPath);
}

/**
 * Watches the composition: edits to mkdocs.yml (nav, name or logo changed) and
 * pages appearing or disappearing. Edits inside a page are not watched — at most
 * the H1 changes, and rebuilding the whole tree on every save for its sake is
 * pointless.
 */
export function watchSiteChrome(root: vscode.Uri, reload: () => void): vscode.Disposable {
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, "mkdocs.{yml,yaml}"),
  );
  const pagesWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(root, "**/*.{md,markdown}"),
    false,
    true, // content changes are of no interest
    false,
  );
  const subs = [
    configWatcher,
    pagesWatcher,
    configWatcher.onDidChange(reload),
    configWatcher.onDidCreate(reload),
    pagesWatcher.onDidCreate(reload),
    pagesWatcher.onDidDelete(reload),
  ];
  return new vscode.Disposable(() => {
    for (const sub of subs) {
      sub.dispose();
    }
  });
}

/**
 * Whether the header, the left panel and the table of contents are shown —
 * state shared by both modes.
 */
export interface ChromeVisibility {
  header: boolean;
  nav: boolean;
  toc: boolean;
}

/**
 * The choice made in the current session. Settings are a way to SURVIVE a
 * restart, not the source of truth: the write can fail (a read-only profile, an
 * older extension version that has not re-registered the properties yet), and
 * then the button on the panel would be dead — you press it and nothing happens.
 */
const sessionVisibility: Partial<ChromeVisibility> = {};

/**
 * Visibility is shared by both modes: the button is pressed in one of them, and
 * the same result is expected in the other (and after a VS Code restart — that
 * is what the settings are for).
 */
export function chromeVisibility(): ChromeVisibility {
  const cfg = vscode.workspace.getConfiguration("mkdocsStudio");
  return {
    header: sessionVisibility.header ?? cfg.get<boolean>("showSiteHeader", false),
    nav: sessionVisibility.nav ?? cfg.get<boolean>("showSiteNav", false),
    toc: sessionVisibility.toc ?? cfg.get<boolean>("showToc", false),
  };
}

/**
 * Applies the toggle and tries to remember it. The order matters: the session
 * state first (so the button always works), the settings write afterwards.
 */
export async function saveChromeVisibility(
  header: unknown,
  nav: unknown,
  toc?: unknown,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("mkdocsStudio");
  if (typeof header === "boolean") {
    sessionVisibility.header = header;
    if (await persist(cfg, "showSiteHeader", header)) {
      // It was written — from now on the setting is the source of truth again,
      // otherwise editing it by hand (in the settings UI) would stop having any
      // effect until a restart.
      delete sessionVisibility.header;
    }
  }
  if (typeof nav === "boolean") {
    sessionVisibility.nav = nav;
    if (await persist(cfg, "showSiteNav", nav)) {
      delete sessionVisibility.nav;
    }
  }
  if (typeof toc === "boolean") {
    sessionVisibility.toc = toc;
    if (await persist(cfg, "showToc", toc)) {
      delete sessionVisibility.toc;
    }
  }
}

async function persist(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  value: boolean,
): Promise<boolean> {
  try {
    await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    return true;
  } catch (err) {
    // Not a broken scenario: the choice is already applied, it just will not
    // survive a restart.
    getLogger().info(`Site header: setting ${key} was not saved (${String(err)})`);
    return false;
  }
}

/** Did a configuration change affect the header/navigation visibility? */
export function affectsChromeVisibility(e: vscode.ConfigurationChangeEvent): boolean {
  return (
    e.affectsConfiguration("mkdocsStudio.showSiteHeader") ||
    e.affectsConfiguration("mkdocsStudio.showSiteNav") ||
    e.affectsConfiguration("mkdocsStudio.showToc")
  );
}

/** Paths of nav pages with no explicit title — those are the only ones we read. */
function navPagePaths(items: NavItem[]): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.kind === "section") {
      result.push(...navPagePaths(item.children));
    } else if (item.title === undefined) {
      result.push(item.path.replace(/\\/g, "/"));
    }
  }
  return result;
}

interface PageInfo {
  /** The first H1, or null when there is none. */
  title: string | null;
  /** Links to other pages, resolved relative to the scope root. */
  links: string[];
}

/**
 * Reads the pages for their title and links — in a single pass over the file and
 * with an mtime-keyed cache: both come from one and the same text.
 */
async function readPages(root: string, rels: string[]): Promise<Map<string, PageInfo>> {
  const pages = new Map<string, PageInfo>();
  for (const rel of rels.slice(0, MAX_TITLE_FILES)) {
    const file = path.join(root, rel);
    try {
      const stat = await fs.stat(file);
      const cached = pageCache.get(file);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        pages.set(rel, { title: cached.title, links: cached.links });
        continue;
      }
      const text = await fs.readFile(file, "utf8");
      const info: PageInfo = {
        title: firstHeading(text) ?? null,
        links: markdownLinks(text).map((link) => resolveLink(rel, link)),
      };
      if (pageCache.size > 4000) {
        pageCache.clear();
      }
      pageCache.set(file, { mtimeMs: stat.mtimeMs, ...info });
      pages.set(rel, info);
    } catch {
      // The file is missing (a stale nav entry) — the title comes from the name.
    }
  }
  return pages;
}

/**
 * Recursive list of pages. Hidden directories, dependencies and build outputs
 * are skipped: the index needs the documentation, not the README of every
 * package in node_modules and not the page copies in site/.
 */
async function listMarkdown(root: string, prefix = "", depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) {
    return [];
  }
  let entries: Dirent[];
  try {
    entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || (entry.isDirectory() && SKIP_DIRS.has(entry.name))) {
      continue;
    }
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...(await listMarkdown(root, rel, depth + 1)));
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      result.push(rel);
    }
  }
  return result;
}

/** theme.icon.logo — a shortcode such as `material/library`; we return ready SVG. */
async function readIconSvg(
  extensionUri: vscode.Uri,
  shortcode: string | undefined,
): Promise<string | undefined> {
  if (!shortcode) {
    return undefined;
  }
  const parts = shortcode.split("/");
  if (parts.length !== 2 || parts.some((p) => p === "" || p.includes(".."))) {
    return undefined;
  }
  const file = vscode.Uri.joinPath(
    extensionUri,
    "assets",
    "icons",
    "svg",
    parts[0],
    `${parts[1]}.svg`,
  );
  try {
    return await fs.readFile(file.fsPath, "utf8");
  } catch {
    getLogger().warn(`Site header: logo icon not found — ${shortcode}`);
    return undefined;
  }
}

/** Label of the repository button when repo_name is not set (as in MkDocs). */
function hostLabel(repoUrl: string): string | undefined {
  try {
    const host = vscode.Uri.parse(repoUrl).authority.replace(/^www\./, "");
    const known: Record<string, string> = {
      "github.com": "GitHub",
      "gitlab.com": "GitLab",
      "bitbucket.org": "Bitbucket",
    };
    return known[host] ?? host ?? undefined;
  } catch {
    return undefined;
  }
}
