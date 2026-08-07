// What happens to the contents of the clipboard on Cmd+V.
//
// Three roads out of one handler, and which one a paste takes is decided here:
//
//   blocks    → through the FILE. The fragment is serialized to Markdown and
//               inserted at the caret's line, the way the component palette
//               inserts blocks. Chrome's own paste pours the first paragraph of
//               an admonition into the target paragraph (beheading it) and
//               flattens a code block into plain text.
//   inline    → by hand, node by node. NOT execCommand("insertHTML"): inside a
//               paste handler Chrome runs the fragment through its own
//               sanitizer, which trades classes and data attributes for the
//               computed inline style — and our islands live in exactly those
//               attributes, so `++ctrl+alt+del++` came back as dead text.
//   our block → the Markdown our own Cut/Copy left, when the system clipboard
//               brought no HTML (or nothing at all: a webview is not always
//               allowed to write it).
//
// Images from the clipboard are not this module's business — they are saved to
// a file next to the page, which is mediaLinks.

import { deleteRangeSafely } from "./deleteGuard";
import { dropPlaceholderBreak } from "./draftLines";
import { inlineIslandsIn, markDirty, noteInlineIsland, scheduleSync } from "./editorCore";
import { lastBlockClipboard, ownBlockClipboard } from "./blockClipboard";
import { serializeTopBlock } from "./htmlToMd";
import { fragmentHasContent, sanitizePastedHtml } from "../shared/pasteSanitize";

/** What the paste path needs from the editor around it. */
export interface PasteHost {
  /** The document root. */
  readonly docEl: HTMLElement;
  /** The outermost block a node belongs to — the one that gets re-serialized. */
  topBlockOf(node: Node | null): Element | null;
  /** Inserts a ready piece of Markdown at the caret's line. */
  insertMarkdownBlock(template: string): void;
}

let host: PasteHost;

export function initPasteContent(next: PasteHost): void {
  host = next;
}

/**
 * Handles a paste that carries text or markup. Returns whether it was handled —
 * the caller keeps the event otherwise (plain text goes in as the browser's
 * own paste, which is what a plain text paste should do).
 */
export function pasteClipboard(data: DataTransfer | null): boolean {
  const html = data?.getData("text/html") ?? "";
  if (html.trim() === "") {
    return pasteOwnBlock(data?.getData("text/plain") ?? "");
  }
  // The source page brings its own styling: inline colors and fonts, Material “¶”
  // anchors with `{ #id }`, service nodes. A sanitized fragment is inserted — the
  // structure (headings, lists, tables, code) survives, foreign styles do not.
  const fragment = sanitizePastedHtml(html);
  if (!fragmentHasContent(fragment)) {
    return false;
  }
  const md = blockFragmentMarkdown(fragment);
  if (md !== null) {
    clearSelection();
    host.insertMarkdownBlock(md);
    return true;
  }
  insertFragmentAtCaret(fragment);
  return true;
}

/**
 * A paste with no markup on it. Plain text that IS our own last Cut/Copy has to
 * be built as a block, not typed in as the literal characters `!!! note`; and a
 * paste that arrived completely empty means the webview was not allowed to write
 * the system clipboard at all — the block was cut out of the file and our own
 * copy is the only place it still exists.
 */
function pasteOwnBlock(plain: string): boolean {
  const block = ownBlockClipboard(plain) ? plain : plain.trim() === "" ? lastBlockClipboard() : "";
  if (block.trim() === "") {
    return false;
  }
  clearSelection();
  host.insertMarkdownBlock(block);
  return true;
}

/**
 * Removes what the paste replaces. Native deletion of a selection merges the
 * blocks at its ends; the guard's deletion never does. Nothing on this path goes
 * through beforeinput, so the guard is called by hand.
 */
function clearSelection(): void {
  const sel = document.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (range && !range.collapsed) {
    deleteRangeSafely(range, host.docEl);
  }
}

/** Tags that stand as blocks at the top of a pasted fragment. */
const PASTE_BLOCK_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "DL",
  "TABLE",
  "PRE",
  "BLOCKQUOTE",
  "DETAILS",
  "HR",
  "DIV",
]);

/**
 * The Markdown of a fragment that holds blocks, or null when it holds none: an
 * inline run or a lone paragraph goes in as nodes and merges into the text
 * around the caret — the familiar behaviour. Loose text standing between the
 * blocks becomes a paragraph of its own; dropping it would lose it, and gluing
 * it to a neighbour would change what the author copied.
 */
export function blockFragmentMarkdown(fragment: DocumentFragment): string | null {
  const parts: string[] = [];
  let pending: Node[] = [];
  let blocks = 0;
  let lastTag = "";

  /** Serializes the inline run collected so far as its own paragraph. */
  const flushInline = (): boolean => {
    const run = pending;
    pending = [];
    if (run.length === 0 || run.every((n) => (n.textContent ?? "").trim() === "")) {
      return true; // only the whitespace between two blocks
    }
    const p = document.createElement("p");
    for (const node of run) {
      p.appendChild(node.cloneNode(true));
    }
    try {
      parts.push(serializeTopBlock(p).replace(/\n+$/, ""));
    } catch {
      return false;
    }
    return true;
  };

  for (const node of Array.from(fragment.childNodes)) {
    if (node instanceof Element && node.tagName === "BR") {
      continue; // the separator the sanitizer leaves in place of unwrapped divs
    }
    if (!(node instanceof Element) || !PASTE_BLOCK_TAGS.has(node.tagName)) {
      pending.push(node);
      continue;
    }
    if (!flushInline()) {
      return null;
    }
    blocks++;
    lastTag = node.tagName;
    try {
      parts.push(serializeTopBlock(node).replace(/\n+$/, ""));
    } catch {
      return null;
    }
  }
  if (blocks === 0) {
    return null; // nothing but inline content — it goes in at the caret
  }
  if (!flushInline()) {
    return null;
  }
  if (blocks === 1 && parts.length === 1 && lastTag === "P") {
    return null; // a lone paragraph merges into the target text
  }
  const text = parts.filter((p) => p !== "").join("\n\n");
  return text === "" ? null : text;
}

/**
 * Flattens what is left for the inline path: a lone paragraph gives up its own
 * tag (its content merges into the target text), and a block the serializer
 * could not read is reduced to its text — a `<div>` dropped inside a `<p>` would
 * be a structure the serializer cannot parse either.
 */
function flattenForInline(fragment: DocumentFragment): void {
  for (const node of Array.from(fragment.childNodes)) {
    if (!(node instanceof Element) || !PASTE_BLOCK_TAGS.has(node.tagName)) {
      continue;
    }
    if (node.tagName === "P") {
      while (node.firstChild) {
        fragment.insertBefore(node.firstChild, node);
      }
    } else {
      fragment.insertBefore(document.createTextNode(node.textContent ?? ""), node);
    }
    node.remove();
  }
}

/** Inserts inline content at the caret — by hand, node by node (see the header). */
function insertFragmentAtCaret(fragment: DocumentFragment): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return;
  }
  flattenForInline(fragment);
  clearSelection();
  if (sel.rangeCount === 0) {
    return;
  }
  const range = sel.getRangeAt(0);
  // Pasting NEXT to the <br> of an empty line leaves it in place: the hint keeps
  // showing through the pasted text, and the file gets a hard break.
  dropPlaceholderBreak(range.startContainer);
  const last = fragment.lastChild;
  const added = Array.from(fragment.childNodes);
  const block = host.topBlockOf(range.startContainer);
  range.insertNode(fragment);
  // What came off the clipboard is the stand-in spelling of an island: the
  // <kbd>s, the KaTeX, the footnote number are drawn by the engine. Ask the
  // answer to this edit to bring the rendered one back.
  const island = inlineIslandsIn(added)[0];
  if (island) {
    noteInlineIsland(island);
  }
  if (last) {
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  if (block instanceof HTMLElement) {
    markDirty(block);
  }
  scheduleSync();
}
