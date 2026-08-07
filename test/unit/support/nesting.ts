// The shapes a Material page nests things into, and the check that a page still
// writes back unchanged.
//
// Two suites need the same set: nestingMatrix.test.ts checks that a page built
// this way round-trips, and nestingInserts.test.ts puts the caret inside one of
// these and inserts a component. Sharing the builders means a container added
// here is covered by both at once.

import { buildMarkdownEngine } from "../../../src/preview/markdownEngine";
import { canSerialize, serializeTopBlock } from "../../../webviews/visual/htmlToMd";

/** The engine the preview and the visual editor both run on. */
export const md = buildMarkdownEngine({
  resolveIcon: (code) =>
    code.startsWith("material-") || code.startsWith("octicons-") || code.startsWith("fontawesome-")
      ? `<svg data-icon="${code}"><path d="M0"/></svg>`
      : undefined,
  readSnippet: () => undefined,
});

/** Indents the non-empty lines by n spaces. */
export function ind(body: string, n = 4): string {
  const pad = " ".repeat(n);
  return body
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

/** Wraps a markdown body, written at zero indent, into a container. */
export type Wrap = (body: string) => string;

export const CONTAINERS: Record<string, Wrap> = {
  adm: (b) => `!!! note "A remark of mine"\n${ind(b)}`,
  admFold: (b) => `??? note "Collapsed"\n${ind(b)}`,
  tabs: (b) => `=== "First"\n\n${ind(b)}\n=== "Second"\n\n    Tail.\n`,
  // The tab that is not the one a fresh render shows: a block put here has to
  // find the second `===` marker, not the set's first line.
  tabs2: (b) => `=== "First"\n\n    Head.\n\n=== "Second"\n\n${ind(b)}`,
  ul: (b) => `- Item\n\n${ind(b)}`,
  ol: (b) => `1. Step\n\n${ind(b)}`,
  quote: (b) =>
    b
      .replace(/\n$/, "")
      .split("\n")
      .map((l) => (l.trim() === "" ? ">" : "> " + l))
      .join("\n") + "\n",
  task: (b) => `- [x] A task\n\n${ind(b)}`,
  grid: (b) => `<div class="grid" markdown>\n\n${b}\n</div>\n`,
};

/** The leaf wrapped in the containers of the path, outermost first. */
export function build(path: readonly string[], leaf: string): string {
  let src = leaf;
  for (let i = path.length - 1; i >= 0; i--) {
    src = CONTAINERS[path[i]](src);
  }
  return src;
}

/**
 * Renders the source and writes every top-level block back. Returns what went
 * wrong, or null when the file survives the trip byte for byte — the property
 * the visual editor rests on, since it rewrites a block whenever the user
 * touches it.
 */
export function roundTripFail(src: string): string | null {
  const lines = src.split("\n");
  const host = document.createElement("div");
  try {
    host.innerHTML = md.render(src);
  } catch (e) {
    return `render: ${String(e)}`;
  }
  const blocks = Array.from(host.children) as HTMLElement[];
  if (blocks.length === 0) return "no of the blocks";
  for (const el of blocks) {
    // Blocks with footnotes are marked non-editable at the top level too —
    // that is a deliberate limitation, not a nesting defect.
    if (!canSerialize(el)) continue;
    // The engine generates the footnote service tail itself (there are no source lines);
    // the editor marks it vservice and never writes it to the file.
    if (el.classList.contains("footnotes-sep") || el.classList.contains("footnotes")) continue;
    const startAttr = el.getAttribute("data-src-line");
    if (startAttr === null) return `no data-src-line on <${el.tagName.toLowerCase()}>`;
    const start = Number(startAttr);
    const end = Number(el.getAttribute("data-src-end"));
    const slice = lines.slice(start, end).join("\n").replace(/\n+$/, "") + "\n";
    let out: string;
    try {
      out = serializeTopBlock(el);
    } catch (e) {
      return `serialize: ${String(e)}`;
    }
    if (out !== slice) {
      return `<${el.tagName.toLowerCase()}>@${start}\n  expected: ${JSON.stringify(slice)}\n  got: ${JSON.stringify(out)}`;
    }
  }
  return null;
}
