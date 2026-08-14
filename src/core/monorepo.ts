// Reading the configs a nav includes (mkdocs-monorepo-plugin).
//
// The rules of the plugin live in the pure monorepoParse.ts; this is the thin
// layer that goes to disk for them. It is re-exported here so that the rest of
// the code has one place to import from, the way mkdocsConfig.ts does.

import * as vscode from "vscode";
import { readMkdocsConfig } from "./mkdocsConfig";
import type { MkdocsConfig, NavItem } from "./mkdocsConfigParse";
import {
  expandIncludes,
  includeTargetOf,
  prefixNavPaths,
  type MonorepoSection,
} from "./monorepoParse";
import type { MkdocsProject } from "./projectService";
import { navFromFiles, type SiteNode } from "./siteNavBuild";
import { getLogger } from "../util/logger";

export * from "./monorepoParse";

/** A section holding a section holding a section… — six levels is already absurd. */
const MAX_DEPTH = 6;

/** Ceiling on the sections of one project: a config chain must not hang the editor. */
const MAX_SECTIONS = 64;

/**
 * Every config the project's nav includes, and the ones those include in turn.
 * Keyed by the config path — POSIX, relative to the project root — which is the
 * key `expandIncludes` looks up.
 *
 * A config that cannot be read is left out rather than failing the lot: the rest
 * of the site is still worth showing, and the section stays visible but empty.
 */
export async function collectSections(
  project: MkdocsProject,
  config: MkdocsConfig,
): Promise<Map<string, MonorepoSection>> {
  const sections = new Map<string, MonorepoSection>();
  await readSections(sections, project.root, config.nav ?? [], "", "", 0);
  return sections;
}

/** The whole nav of the project with every `!include` replaced by its section. */
export function expandedNav(
  config: MkdocsConfig,
  sections: ReadonlyMap<string, MonorepoSection>,
): NavItem[] | undefined {
  return config.nav ? expandIncludes(config.nav, sections) : undefined;
}

/** Config files that took part in the build — what a watcher has to keep an eye on. */
export function sectionConfigFiles(
  project: MkdocsProject,
  sections: ReadonlyMap<string, MonorepoSection>,
): vscode.Uri[] {
  return [...sections.keys()].map((rel) => vscode.Uri.joinPath(project.root, rel));
}

async function readSections(
  sections: Map<string, MonorepoSection>,
  root: vscode.Uri,
  nav: NavItem[],
  baseDir: string,
  parentPrefix: string,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) {
    getLogger().warn(`Monorepo: includes nested deeper than ${MAX_DEPTH} levels — stopping here`);
    return;
  }
  for (const item of eachItem(nav)) {
    const target = includeTargetOf(item);
    if (target === undefined) {
      continue;
    }
    const configRel = joinPath(baseDir, target);
    // Already read — that is also how a loop of includes ends here.
    if (sections.has(configRel)) {
      continue;
    }
    if (sections.size >= MAX_SECTIONS) {
      getLogger().warn(
        `Monorepo: more than ${MAX_SECTIONS} included configs — the rest are left out`,
      );
      return;
    }
    let config: MkdocsConfig;
    try {
      config = (await readMkdocsConfig(vscode.Uri.joinPath(root, configRel))).config;
    } catch (err) {
      getLogger().warn(`Monorepo: included config not read — ${configRel} (${String(err)})`);
      continue;
    }
    const dir = dirOf(configRel);
    if (config.docsDir.startsWith("/") || /^[a-z]:[\\/]/i.test(config.docsDir)) {
      getLogger().warn(`Monorepo: absolute docs_dir in ${configRel} is not supported`);
      continue;
    }
    const prefix = joinPath(parentPrefix, sectionPrefix(config, dir));
    const docsDir = joinPath(dir, config.docsDir);
    // Claim the key before recursing: a config that includes itself would
    // otherwise be read again on the way down.
    sections.set(configRel, { prefix, docsDir, nav: [] });
    await readSections(sections, root, config.nav ?? [], dir, prefix, depth + 1);
    // Without a nav of its own the section is its files, exactly as MkDocs builds
    // a site with no nav — otherwise the tab would open onto nothing.
    const own = config.nav ?? (await navFromPages(root, docsDir));
    sections.set(configRel, {
      prefix,
      docsDir,
      // The section's own pages carry its prefix; its nested includes are already
      // in the map, each with a prefix of its own.
      nav: expandIncludes(prefixNavPaths(own, prefix), sections, dir),
    });
  }
}

/**
 * The pages of a section that has no nav, as nav items: the file tree of its
 * docs_dir, without titles — those are read from the H1 later, by whoever draws
 * the navigation.
 */
async function navFromPages(root: vscode.Uri, docsDir: string): Promise<NavItem[]> {
  const dir = vscode.Uri.joinPath(root, docsDir);
  const files = await listMarkdown(dir);
  return toNavItems(navFromFiles(files, () => undefined));
}

function toNavItems(nodes: SiteNode[]): NavItem[] {
  const out: NavItem[] = [];
  for (const node of nodes) {
    if (node.kind === "section") {
      out.push({ kind: "section", title: node.title, children: toNavItems(node.children) });
    } else if (node.kind === "page") {
      // No title on purpose: nav without one means “take it from the page”.
      out.push({ kind: "page", path: node.path });
    }
  }
  return out;
}

/** Recursive list of the Markdown files of a directory, POSIX-relative to it. */
async function listMarkdown(dir: vscode.Uri, prefix = "", depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) {
    return [];
  }
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith(".")) {
      continue;
    }
    const rel = prefix ? `${prefix}/${name}` : name;
    if (type === vscode.FileType.Directory) {
      out.push(...(await listMarkdown(vscode.Uri.joinPath(dir, name), rel, depth + 1)));
    } else if (/\.(md|markdown)$/i.test(name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * The URL prefix of a section: `site_name` of the included config, exactly as the
 * plugin uses it. Without one the directory of the config stands in — the section
 * still needs an address of its own, or its pages would collide with the root site's.
 */
function sectionPrefix(config: MkdocsConfig, dir: string): string {
  const name = (config.siteName ?? "").trim().replace(/^\/+|\/+$/g, "");
  return name !== "" ? name : (dir.split("/").pop() ?? dir);
}

/** Every nav item, sections included — an `!include` can sit at any level. */
function* eachItem(nav: NavItem[]): Generator<NavItem> {
  for (const item of nav) {
    yield item;
    if (item.kind === "section") {
      yield* eachItem(item.children);
    }
  }
}

function dirOf(relPath: string): string {
  const at = relPath.lastIndexOf("/");
  return at < 0 ? "" : relPath.slice(0, at);
}

function joinPath(base: string, rest: string): string {
  const left = base.replace(/\/+$/, "");
  const right = rest.replace(/^\.?\//, "").replace(/\/+$/, "");
  if (right === "" || right === ".") {
    return left;
  }
  return left === "" || left === "." ? right : `${left}/${right}`;
}
