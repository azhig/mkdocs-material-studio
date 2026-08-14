// mkdocs-monorepo-plugin: a nav entry `!include ./lib/mkdocs.yml` pulls in
// another config, and the pages it lists live next to it rather than under the
// root docs_dir.
//
// What the plugin does with such an entry, and what this module reproduces:
//
//   nav:
//     - Library: '!include ./lib/mkdocs.yml'      # lib/mkdocs.yml: site_name: lib
//
//   * the entry becomes a SECTION whose contents are the included nav;
//   * `site_name` of the included config is a URL prefix, so its page `2/index.md`
//     is addressed as `lib/2/index.md`;
//   * that prefixed path resolves against the section's own docs_dir (`lib/docs`),
//     not against the root one — and the same holds for extra_css entries.
//
// The module is pure: reading the configs is the job of monorepo.ts, so the rules
// above are covered by vitest.

import type { NavItem } from "./mkdocsConfigParse";

/** One included config, in the shape the rest of the extension needs it. */
export interface MonorepoSection {
  /** URL prefix — `site_name` of the included config (`lib`, `conv/user_docs`). */
  prefix: string;
  /** Pages directory, POSIX and relative to the root project (`lib/docs`). */
  docsDir: string;
  /** nav of the included config, its paths already carrying the prefix. */
  nav: NavItem[];
}

/** A nav entry points at a config, never at a page: a page is always Markdown. */
const CONFIG_FILE = /(^|\/)mkdocs\.ya?ml$/i;

const INCLUDE_TAG = "!include";

/** An include chain deeper than this is a mistake, or a loop we failed to spot. */
const MAX_CHAIN = 16;

/**
 * The config an `!include` entry points at — POSIX and relative to the directory
 * of the config the entry is written in. Undefined for an ordinary nav entry.
 *
 * Two spellings reach us. Quoted, the way the plugin documents it, the value
 * arrives as the text `!include ./lib/mkdocs.yml`. Unquoted, YAML reads
 * `!include` as a tag and hands over the bare path — so an entry pointing at a
 * config file counts too.
 */
export function includeTargetOf(item: NavItem): string | undefined {
  if (item.kind !== "page") {
    return undefined;
  }
  const raw = item.path.replace(/\\/g, "/").trim();
  const text = raw.startsWith(INCLUDE_TAG) ? raw.slice(INCLUDE_TAG.length).trim() : raw;
  if (!CONFIG_FILE.test(text)) {
    return undefined;
  }
  return insideProject(text);
}

/**
 * Drops the `./` noise and refuses to leave the project: a config outside the
 * root is not a section of this site, and reading it is not ours to do.
 */
function insideProject(relPath: string): string | undefined {
  if (relPath.startsWith("/") || /^[a-z]:\//i.test(relPath)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of relPath.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      return undefined;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : undefined;
}

/** A nav path that is a URL, not a file — those are left alone everywhere here. */
function isExternal(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
}

/**
 * Joins the section prefix onto every page path, the way the plugin does.
 *
 * An `!include` entry keeps its path: it names a config on disk, not a page of
 * the site, and it is looked up by that path when the section is expanded.
 */
export function prefixNavPaths(items: NavItem[], prefix: string): NavItem[] {
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  if (clean === "") {
    return items;
  }
  return items.map((item) => {
    if (item.kind === "section") {
      return { ...item, children: prefixNavPaths(item.children, clean) };
    }
    const path = item.path.replace(/\\/g, "/");
    if (isExternal(path) || includeTargetOf(item) !== undefined) {
      return item;
    }
    return { ...item, path: `${clean}/${path.replace(/^\.?\//, "")}` };
  });
}

/**
 * Replaces every `!include` entry with a section holding the included nav.
 *
 * A section whose config could not be read stays as an empty section rather than
 * disappearing: the author wrote it down, and a title with nothing under it says
 * “this part did not load” far better than a silently shorter menu.
 */
export function expandIncludes(
  nav: NavItem[],
  sections: ReadonlyMap<string, MonorepoSection>,
  baseDir = "",
): NavItem[] {
  const result: NavItem[] = [];
  for (const item of nav) {
    if (item.kind === "section") {
      result.push({ ...item, children: expandIncludes(item.children, sections, baseDir) });
      continue;
    }
    const target = includeTargetOf(item);
    if (target === undefined) {
      result.push(item);
      continue;
    }
    // An entry names its config relative to the config it is written in; the
    // sections are keyed from the project root, so the two are joined here.
    const key = join(baseDir, target);
    const section = sections.get(key);
    result.push({
      kind: "section",
      title: item.title ?? section?.prefix ?? target,
      children: section?.nav ?? [],
    });
  }
  return result;
}

/** The section a prefixed path belongs to; the longest prefix wins. */
export function sectionFor(
  relPath: string,
  sections: readonly MonorepoSection[],
): MonorepoSection | undefined {
  const path = relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  let best: MonorepoSection | undefined;
  for (const section of sections) {
    if (path === section.prefix || path.startsWith(`${section.prefix}/`)) {
      if (!best || section.prefix.length > best.prefix.length) {
        best = section;
      }
    }
  }
  return best;
}

/**
 * Where a path out of nav or extra_css really lives — POSIX and relative to the
 * root project. With a section prefix the rest of the path belongs to that
 * section's docs_dir; without one it is the root docs_dir, as before.
 */
export function resolveSectionPath(
  relPath: string,
  rootDocsDir: string,
  sections: readonly MonorepoSection[],
): string {
  const path = relPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  const section = sectionFor(path, sections);
  if (!section) {
    return join(rootDocsDir, path);
  }
  return join(section.docsDir, path.slice(section.prefix.length).replace(/^\//, ""));
}

/**
 * The prefixed path of a file that lives in a section — the reverse of
 * resolveSectionPath, for telling the webview which page is the open one.
 */
export function sectionPathOf(
  relFromRoot: string,
  sections: readonly MonorepoSection[],
): string | undefined {
  const path = relFromRoot.replace(/\\/g, "/").replace(/^\.?\//, "");
  let best: MonorepoSection | undefined;
  for (const section of sections) {
    if (path.startsWith(`${section.docsDir}/`)) {
      if (!best || section.docsDir.length > best.docsDir.length) {
        best = section;
      }
    }
  }
  return best ? join(best.prefix, path.slice(best.docsDir.length).replace(/^\//, "")) : undefined;
}

/**
 * The root of an include chain. An included config describes a section, not a
 * site: its nav has no tabs, it carries no extra_css and usually no palette, so
 * everything has to be read from the config that includes it.
 */
export function rootIncludeConfig(
  configPath: string,
  parentOf: ReadonlyMap<string, string>,
): string {
  let current = configPath;
  const seen = new Set<string>([current]);
  for (let i = 0; i < MAX_CHAIN; i++) {
    const parent = parentOf.get(current);
    // A config that includes itself through a chain would spin here forever;
    // stopping leaves the deepest sane answer rather than no answer at all.
    if (parent === undefined || seen.has(parent)) {
      return current;
    }
    seen.add(parent);
    current = parent;
  }
  return current;
}

function join(base: string, rest: string): string {
  const left = base.replace(/\/+$/, "");
  if (rest === "") {
    return left;
  }
  return left === "" || left === "." ? rest : `${left}/${rest}`;
}
