// The editor's own hand tools: the selection, the lines of the file under it,
// and the caret.
//
// These are the operations every feature reaches for — which line does this
// paragraph start on, replace these lines and leave the caret here, mark what
// the selection touched as changed. They lived in the middle of the editor's
// wiring, between the toolbar and the component menu, because that is where the
// first caller happened to be.
//
// Everything here is markdown-first: a “line” is a line of the file, not a line
// on screen, and an operation that changes structure edits those lines and lets
// the render come back.

import {
  dirty,
  docEndsNL,
  docLines,
  rangeOf,
  requestFullRender,
  scheduleSync,
  sendSync,
  setAfterSync,
} from "./editorCore";
import type { SyncEdit } from "./syncModel";

/** What these operations need from the editor around them. */
export interface SelectionOpsHost {
  /** The editable document. */
  readonly docEl: HTMLElement;
  /** The top-level block the caret is in. */
  currentBlock(): Element | null;
  /** The top-level blocks, in document order. */
  blocksInOrder(): Element[];
  /** Puts the caret into a block, focusing the editable host around it. */
  caretIntoBlock(block: HTMLElement): void;
  /** The block that starts at a line of the file. */
  findBlockByStart(start: number): Element | undefined;
  /** Drops a ready piece of Markdown in at the caret's level. */
  insertMarkdownBlock(template: string): void;
}

let host: SelectionOpsHost;

export function initSelectionOps(next: SelectionOpsHost): void {
  host = next;
}

export function cmd(name: string, value?: string): void {
  document.execCommand(name, false, value);
  if (document.activeElement === host.docEl) {
    return;
  }
  // Focusing a contenteditable that did NOT have focus resets the caret to its
  // start — the next keystrokes then land in the first block of the document
  // and are written there. Keep the selection the command has just produced.
  const sel = document.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  host.docEl.focus();
  if (range && host.docEl.contains(range.startContainer)) {
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}

/**
 * The “paragraph” lines under the caret or the selection: what will become list items
 * or change style. Leaf blocks are taken — the ones that contain no other such blocks.
 */
export function selectionLines(): HTMLElement[] {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return [];
  }
  const range = sel.getRangeAt(0);
  const all = Array.from(host.docEl.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li"));
  const hit = all.filter(
    (el) => range.intersectsNode(el) && el.querySelector("p, li, h1, h2, h3, h4, h5, h6") === null,
  );
  if (hit.length > 0) {
    return hit;
  }
  const block = host.currentBlock();
  return block instanceof HTMLElement ? [block] : [];
}

/** The nearest ancestor (including the node itself) that has lines in the source. */
export function rangedAncestor(el: Element | null): HTMLElement | null {
  let cur: Element | null = el;
  while (cur && cur !== host.docEl) {
    if (cur.hasAttribute("data-src-line")) {
      return cur as HTMLElement;
    }
    cur = cur.parentElement;
  }
  return null;
}

/** The line range covering the selected blocks (or the caret's block). */
export function selectionRange(): { start: number; end: number } | null {
  const blocks = selectionLines()
    .map((el) => rangedAncestor(el))
    .filter((el): el is HTMLElement => el !== null);
  if (blocks.length === 0) {
    return null;
  }
  let start = Number.MAX_SAFE_INTEGER;
  let end = 0;
  for (const b of blocks) {
    const r = rangeOf(b);
    start = Math.min(start, r.start);
    end = Math.max(end, r.end);
  }
  return { start, end };
}

/** A block's indent in the source = its nesting level. */
export function indentOfLine(line: number): string {
  return /^\s*/.exec(docLines()[line] ?? "")?.[0] ?? "";
}

/**
 * Replacing a block's lines with new Markdown: the edit goes straight into the file, the document
 * is re-rendered by the engine, and the caret returns to the block at line `caretLine`.
 */
export function replaceLines(start: number, end: number, lines: string[], caretLine = start): void {
  const text = lines.join("\n").replace(/\n+$/, "") + "\n";
  if (docLines().slice(start, end).join("\n") + "\n" === text) {
    return; // nothing changed
  }
  requestFullRender();
  setAfterSync(() => caretToLine(caretLine));
  sendSync([{ start, end, text }]);
}

/** Places the caret into the block starting at the line (or into the nearest following one). */
function caretToLine(line: number): void {
  const exact = host.findBlockByStart(line);
  if (exact instanceof HTMLElement) {
    host.caretIntoBlock(exact);
    return;
  }
  // Not a top-level block: a list item or a paragraph nested in one carries its
  // own source line, and an edit inside an annotation note aims at exactly that.
  const deep = host.docEl.querySelector<HTMLElement>(`[data-src-line="${line}"]`);
  if (deep) {
    host.caretIntoBlock(deep);
    return;
  }
  let best: HTMLElement | null = null;
  for (const b of host.blocksInOrder()) {
    const start = Number(b.getAttribute("data-src-line"));
    if (
      Number.isFinite(start) &&
      start >= line &&
      (!best || start < Number(best.getAttribute("data-src-line")))
    ) {
      best = b as HTMLElement;
    }
  }
  if (best) {
    host.caretIntoBlock(best);
  }
}

/**
 * An insert edit for a new block at line anchorLine, with correct blank lines
 * before and after (without duplicating the blank separators that already exist).
 */
export function insertBlockEdit(anchorLine: number, body: string): SyncEdit {
  const atEof = anchorLine >= docLines().length;
  const prevBlank = anchorLine === 0 || (docLines()[anchorLine - 1] ?? "").trim() === "";
  const lead = prevBlank ? "" : "\n";
  let trail: string;
  if (atEof) {
    trail = docEndsNL() ? "" : "\n";
  } else {
    trail = (docLines()[anchorLine] ?? "").trim() === "" ? "\n" : "\n\n";
  }
  return { start: anchorLine, end: anchorLine, text: lead + body + trail };
}

export function enclosingTag(node: Node | null, tagName: string): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== host.docEl) {
    if (cur instanceof HTMLElement && cur.tagName === tagName) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

export function markDirtyAtSelection(): void {
  const block = host.currentBlock();
  if (block) {
    dirty.add(block);
    scheduleSync();
  }
}

/** A horizontal rule — like the other components, by inserting lines into the file. */
export function insertHr(): void {
  host.insertMarkdownBlock("---");
}

export function placeCaret(el: Element, atEnd = false): void {
  const sel = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  sel?.removeAllRanges();
  sel?.addRange(range);
  (el as HTMLElement).focus?.();
}
