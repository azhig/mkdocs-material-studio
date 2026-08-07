// Following a link written inside a page.
//
// On the published site MkDocs turns `guide/setup.md` into a URL and the browser
// does the rest. Inside the extension there is no site: a click has to be turned
// back into a file, and the same href can be written in several ways —
// `setup.md`, `setup`, `setup/` (use_directory_urls), even `setup.html` when the
// address was copied from the built site. This module knows nothing about the
// file system: it only says what to look for, and the caller checks what exists.

import * as path from "node:path";

export type DocLinkKind =
  /** A scheme of its own — http(s), mailto, vscode… The system opens it. */
  | "external"
  /** `#section` — a place on the very same page. */
  | "anchor"
  /** Something inside the project: a page, an image, an archive. */
  | "page";

export interface DocLink {
  kind: DocLinkKind;
  /** For "page": the path with no query and no hash, percent-decoded. */
  target: string;
  /** The `#…` part without the hash sign; "" when the link carries none. */
  hash: string;
}

/**
 * Splits a href into the parts the caller acts on. Returns undefined for a link
 * that leads nowhere (empty, or a lone `?query`).
 */
export function parseDocLink(href: string): DocLink | undefined {
  const raw = href.trim();
  if (raw === "") {
    return undefined;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    return { kind: "external", target: raw, hash: "" };
  }
  const hashAt = raw.indexOf("#");
  const hash = hashAt === -1 ? "" : raw.slice(hashAt + 1);
  const withoutHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const target = withoutHash.split("?")[0];
  if (target === "") {
    return hash === "" ? undefined : { kind: "anchor", target: "", hash };
  }
  return { kind: "page", target: decode(target), hash };
}

/**
 * The files an href may stand for, in the order they should be tried. A `.md`
 * link means itself; everything else may be a directory URL or an extensionless
 * page — both are what MkDocs generates and what authors copy back into a link.
 */
export function linkCandidates(target: string): string[] {
  const clean = target.replace(/\/{2,}/g, "/");
  if (clean === "" || clean.endsWith("/")) {
    return [`${clean}index.md`, `${clean}README.md`];
  }
  const ext = path.posix.extname(clean).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    return [clean];
  }
  if (ext === ".html" || ext === ".htm") {
    // The address came from the built site: `guide/setup.html` is written by
    // `guide/setup.md`, and `guide/index.html` by `guide/index.md`.
    return [clean.replace(/\.html?$/i, ".md"), clean];
  }
  if (ext === "") {
    return [`${clean}.md`, `${clean}/index.md`, `${clean}/README.md`, clean];
  }
  // An ordinary file: an image, a PDF, an archive.
  return [clean];
}

/**
 * Absolute paths to try for a link clicked in a page. A leading `/` means the
 * root of the site (docs_dir), everything else is relative to the page itself —
 * the same rule MkDocs follows.
 */
export function candidatePaths(link: DocLink, docDir: string, pagesRoot: string): string[] {
  if (link.kind !== "page") {
    return [];
  }
  const absolute = link.target.startsWith("/");
  const base = absolute ? pagesRoot : docDir;
  const target = absolute ? link.target.replace(/^\/+/, "") : link.target;
  return linkCandidates(target).map((rel) => path.resolve(base, rel));
}

/**
 * The first candidate that is actually there. The file system is the caller's
 * (the extension asks VS Code, a test asks a set), so this module stays pure.
 */
export async function findLinkTarget(
  link: DocLink,
  docDir: string,
  pagesRoot: string,
  exists: (file: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const file of candidatePaths(link, docDir, pagesRoot)) {
    if (await exists(file)) {
      return file;
    }
  }
  return undefined;
}

/**
 * Schemes we are willing to hand to the operating system. A page is text
 * somebody else wrote — a documentation repository takes changes from
 * strangers — and “open this address” is the one thing in the preview that
 * leaves the editor. `file:` would start whatever application owns the file,
 * `vscode:` would reach another extension's URI handler; a link is not worth
 * either, so only the three schemes a reader actually expects go through.
 */
const OPENABLE_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * The address to hand to the system, or undefined when this link must not leave
 * the editor. A protocol-relative `//host/path` takes the scheme the published
 * site would have given it.
 */
export function externalTarget(href: string): string | undefined {
  const raw = href.trim();
  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1];
  return scheme !== undefined && OPENABLE_SCHEMES.has(scheme.toLowerCase()) ? raw : undefined;
}

/** Is this a page we can open in the preview or in the visual editor? */
export function isMarkdownPath(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray `%` in the path: take it literally.
    return value;
  }
}
