// The site page tree for the header and the left panel: from nav in mkdocs.yml,
// and when there is none — from the files in docs/ (exactly as MkDocs itself does).
//
// The module is deliberately pure (no vscode, no file system): reading files and
// headings is siteChrome.ts's job, ready-made lists and a title lookup function
// arrive here. That way the ordering and naming rules are covered by vitest.

import type { NavItem } from "./mkdocsConfigParse";

/** A page: a POSIX-style path relative to docs_dir. */
export interface SitePage {
  kind: "page";
  title: string;
  path: string;
}

/** A section: a title and nested items. */
export interface SiteSection {
  kind: "section";
  title: string;
  children: SiteNode[];
}

/** An external link (nav accepts a URL instead of a file). */
export interface SiteLink {
  kind: "link";
  title: string;
  href: string;
}

export type SiteNode = SitePage | SiteSection | SiteLink;

/** Page title by its path; undefined — when the file has no H1. */
export type TitleLookup = (path: string) => string | undefined;

/** Links to other pages from a file — in the order they appear in the text. */
export type LinkLookup = (path: string) => string[];

const INDEX_NAMES = new Set(["index.md", "index.markdown", "readme.md", "readme.markdown"]);

/**
 * Table-of-contents files in order of preference: SUMMARY.md is a ready-made
 * chapter list (mdBook, GitBook), README/index is the entry point of an ordinary
 * repository.
 */
const ENTRY_NAMES = ["summary.md", "readme.md", "index.md"];

/** The table of contents of its own directory — such files are read first. */
export function isEntryPage(path: string): boolean {
  const name = (path.split("/").pop() ?? path).toLowerCase();
  return ENTRY_NAMES.includes(name);
}

/** Builds the tree from nav in mkdocs.yml: titles come from nav, otherwise from the file. */
export function navFromConfig(items: NavItem[], titleOf: TitleLookup): SiteNode[] {
  const result: SiteNode[] = [];
  for (const item of items) {
    if (item.kind === "section") {
      result.push({
        kind: "section",
        title: item.title,
        children: navFromConfig(item.children, titleOf),
      });
      continue;
    }
    const path = item.path.replace(/\\/g, "/");
    if (isExternal(path)) {
      result.push({ kind: "link", title: item.title ?? path, href: path });
      continue;
    }
    result.push({
      kind: "page",
      title: item.title ?? titleOf(path) ?? titleFromPath(path),
      path,
    });
  }
  return result;
}

/**
 * Builds the tree from the list of files in docs/ — the MkDocs mode without nav.
 * The order matches os.walk in MkDocs: first the files of the directory (index
 * first, then alphabetically), then the subdirectories alphabetically.
 */
export function navFromFiles(paths: string[], titleOf: TitleLookup): SiteNode[] {
  const normalized = paths.map((p) => p.replace(/\\/g, "/")).filter((p) => p !== "");
  return buildLevel(normalized, "", titleOf);
}

/**
 * Markdown index for a project without mkdocs.yml. The tree follows the
 * directories (so the ENTIRE contents are visible, no file gets lost), while the
 * order inside a directory is set by its table of contents:
 * SUMMARY.md/README.md/index.md comes first, followed by the pages in the order
 * they are mentioned in it, and the rest alphabetically after them.
 */
export function navFromFolder(
  paths: string[],
  titleOf: TitleLookup,
  linksOf: LinkLookup,
): SiteNode[] {
  const normalized = paths.map((p) => p.replace(/\\/g, "/")).filter((p) => p !== "");
  return buildLevel(normalized, "", titleOf, linksOf).map(collapseSingleChild);
}

/**
 * Collapses a chain of directories without branches into a single item
 * (“Samples / Demo / Docs”): in an ordinary repository the documentation often
 * sits deep, and three expansions in a row for the sake of one page is extra
 * work for the reader. We do not do this for an MkDocs site: there the author
 * defined the structure.
 */
function collapseSingleChild(node: SiteNode): SiteNode {
  if (node.kind !== "section") {
    return node;
  }
  let title = node.title;
  let children = node.children;
  while (children.length === 1 && children[0].kind === "section") {
    const only = children[0];
    title = `${title} / ${only.title}`;
    children = only.children;
  }
  return { kind: "section", title, children: children.map(collapseSingleChild) };
}

function buildLevel(
  paths: string[],
  prefix: string,
  titleOf: TitleLookup,
  linksOf?: LinkLookup,
): SiteNode[] {
  const files: string[] = [];
  const dirs = new Map<string, string[]>();
  for (const rel of paths) {
    const slash = rel.indexOf("/");
    if (slash < 0) {
      files.push(rel);
      continue;
    }
    const dir = rel.slice(0, slash);
    const rest = rel.slice(slash + 1);
    const bucket = dirs.get(dir);
    if (bucket) {
      bucket.push(rest);
    } else {
      dirs.set(dir, [rest]);
    }
  }

  const order = linksOf ? entryOrder(files, prefix, linksOf) : undefined;
  const nodes: SiteNode[] = [];
  for (const name of order ? sortByOrder(files, order.files) : files.sort(compareFileNames)) {
    const path = prefix + name;
    nodes.push({ kind: "page", title: titleOf(path) ?? titleFromPath(path), path });
  }
  const dirNames = Array.from(dirs.keys());
  for (const dir of order ? sortByOrder(dirNames, order.dirs) : dirNames.sort(compareNames)) {
    nodes.push({
      kind: "section",
      title: humanize(dir),
      children: buildLevel(dirs.get(dir) ?? [], `${prefix}${dir}/`, titleOf, linksOf),
    });
  }
  return nodes;
}

/**
 * The order defined by the directory's table of contents: the table-of-contents
 * file itself first, then the files and subdirectories mentioned in it (by first
 * mention).
 */
function entryOrder(
  files: string[],
  prefix: string,
  linksOf: LinkLookup,
): { files: string[]; dirs: string[] } {
  const entry = ENTRY_NAMES.map((wanted) =>
    files.find((name) => name.toLowerCase() === wanted),
  ).find((name): name is string => name !== undefined);
  if (entry === undefined) {
    return { files: [], dirs: [] };
  }
  const fileOrder = [entry];
  const dirOrder: string[] = [];
  for (const link of linksOf(prefix + entry)) {
    if (!link.startsWith(prefix)) {
      continue; // the link points outside this directory — it sets no order here
    }
    const rest = link.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      if (!fileOrder.includes(rest)) {
        fileOrder.push(rest);
      }
    } else {
      const dir = rest.slice(0, slash);
      if (!dirOrder.includes(dir)) {
        dirOrder.push(dir);
      }
    }
  }
  return { files: fileOrder, dirs: dirOrder };
}

/** First the ones listed in `order` (in its order), then the rest alphabetically. */
function sortByOrder(names: string[], order: string[]): string[] {
  const listed = order.filter((name) => names.includes(name));
  const rest = names.filter((name) => !listed.includes(name)).sort(compareFileNames);
  return [...listed, ...rest];
}

/**
 * Links to other Markdown pages — in the order they appear. External addresses,
 * anchors and links to non-Markdown targets are skipped; code blocks are skipped
 * too (links inside examples have nothing to do with the table of contents).
 */
export function markdownLinks(text: string): string[] {
  const result: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === undefined) {
        fence = fenceMatch[1][0];
      } else if (fenceMatch[1][0] === fence) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      continue;
    }
    // Inline links [text](path) and link definitions [label]: path.
    for (const re of [
      /\]\(\s*<?([^)<>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
      /^\s{0,3}\[[^\]]+\]:\s*<?([^\s<>]+)>?/g,
    ]) {
      for (let m = re.exec(line); m !== null; m = re.exec(line)) {
        const target = pageTarget(m[1]);
        if (target !== undefined && !result.includes(target)) {
          result.push(target);
        }
      }
    }
  }
  return result;
}

/** Keeps only relative links to Markdown pages, without the anchor. */
function pageTarget(raw: string): string | undefined {
  const target = raw.split("#")[0].split("?")[0].trim();
  if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
    return undefined;
  }
  return /\.(md|markdown)$/i.test(target) ? target : undefined;
}

/** Resolves a relative link from the source file: `a/b.md` + `../c.md` → `c.md`. */
export function resolveLink(fromPath: string, link: string): string {
  const base = link.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  const parts = link.replace(/^\//, "").split("/");
  const stack = [...base];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

/** index.md comes first in its directory — as in MkDocs. */
function compareFileNames(a: string, b: string): number {
  const ai = INDEX_NAMES.has(a.toLowerCase()) ? 0 : 1;
  const bi = INDEX_NAMES.has(b.toLowerCase()) ? 0 : 1;
  return ai !== bi ? ai - bi : compareNames(a, b);
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en");
}

/** Title from the file (or directory) name — the MkDocs fallback. */
export function titleFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const stem = name.replace(/\.(md|markdown)$/i, "");
  return humanize(stem);
}

/** `getting-started` → `Getting started`: hyphens to spaces + capital first letter. */
function humanize(name: string): string {
  const text = name.replace(/[-_]+/g, " ").trim();
  if (text === "") {
    return name;
  }
  // MkDocs capitalizes only when the name is entirely lowercase — otherwise
  // `FastAPI` would turn into `Fastapi`.
  return text === text.toLowerCase() ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function isExternal(path: string): boolean {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(path);
}

/**
 * The first level-one heading — MkDocs takes the page title from there.
 * Skips code blocks (inside them `#` is a comment) and front matter.
 */
export function firstHeading(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let i = 0;
  // YAML front matter at the start of the file.
  if (lines[0]?.trim() === "---") {
    for (i = 1; i < lines.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
        i++;
        break;
      }
    }
  }
  let fence: string | undefined;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === undefined) {
        fence = fenceMatch[1][0];
      } else if (fenceMatch[1][0] === fence) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      continue;
    }
    const atx = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) {
      return cleanTitle(atx[1]);
    }
    // Setext: a line of text with === underneath it.
    if (line.trim() !== "" && /^\s{0,3}=+\s*$/.test(lines[i + 1] ?? "")) {
      return cleanTitle(line.trim());
    }
  }
  return undefined;
}

/** Strips markup from the heading: `{ #id }`, emphasis, links, code. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/\{[^}]*\}\s*$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/:[a-z0-9_+-]+:/gi, "")
    .trim();
}
