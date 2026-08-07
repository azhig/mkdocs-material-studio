// Annotations.
//
// Material writes an annotation as an `(n)` marker in the text, the
// `{ .annotate }` class on the block, and a numbered list right after it where
// item `n` is the note. In code the marker goes inside a comment — `# (n)!` —
// and the block needs no class. One toolbar button works out which of the two
// the caret is in.
//
// On screen the markers become clickable dots and the numbered list is hidden:
// what the reader of the built site sees as a tooltip, the author sees as a
// dot they can open. Clicking one opens the note in a full editor of its own —
// the note's body becomes the WHOLE document, `#doc` physically moves into a
// modal window, and every tool (styles, lists, tables, inserted blocks, undo)
// works there exactly as it does at top level. The file is written once, by
// “Done”, which wraps the body back into its list item and lands in the parent
// as a single edit and a single undo step; “Cancel” leaves the parent
// untouched. A nested annotation opens one more editor on top of the first —
// its “parent document” is simply the outer note's body.
//
// The injected record is called `editor` rather than `host` here: in this file
// a “host” is the element an annotation is attached to, and two meanings of
// one word in one file is one too many.

import { COMMENT_SYNTAX, parseFence } from "./codeFence";
import { activeHandleBlock } from "./blockHandle";
import { getCodeCaret, isInlineCode } from "./codeBlockEdit";
import { restoreRange } from "./inlineTools";
import { serializeTopBlock } from "./htmlToMd";
import { closePopup } from "./popups";
import { initSubEditor, inSubEditor, openAnnotationModal } from "./annotationSubEditor";
import { type SyncEdit } from "./syncModel";
import {
  deleteEdit,
  docLines,
  mutedRemote,
  rangeOf,
  runSyncNowThen,
  sendSync,
  setAfterSync,
  st,
  syncBusy,
} from "./editorCore";
import { t } from "../shared/i18n";

/** What annotations need from the editor around them. */
export interface AnnotationsHost {
  /** The document root — which, inside a note's editor, is the note. */
  readonly docEl: HTMLElement;
  /** Sends a message to the extension (rendering a note's fragment). */
  post(msg: unknown): void;
  /** The top-level blocks of the document, in order. */
  blocksInOrder(): Element[];
  /** The top-level block the caret is in. */
  currentBlock(): Element | null;
  /** The outermost block a node belongs to. */
  topBlockOf(node: Node | null): Element | null;
  /** Puts the caret into a block, preparing it if it needs preparing. */
  caretIntoBlock(block: HTMLElement): void;
  /** Applies a render patch — used when a note's fragment comes back. */
  applyPatches(html: string, text: string, version: number): void;
  /** An insert edit for a new block, with the blank lines around it right. */
  insertBlockEdit(anchorLine: number, body: string): SyncEdit;
}

let editor: AnnotationsHost;

export function initAnnotations(next: AnnotationsHost): void {
  editor = next;
  initSubEditor({
    docEl: next.docEl,
    post: (msg) => next.post(msg),
    blocksInOrder: () => next.blocksInOrder(),
    caretIntoBlock: (block) => next.caretIntoBlock(block),
    applyPatches: (html, text, version) => next.applyPatches(html, text, version),
    hideTip: hideAnnotationTip,
  });
}

/** The “Annotation” button: annotates the text under the caret or the code island under the handle. */
/** The caret context inside an inline code block: the block and the line index. */
function codeCaretContext(): { block: HTMLElement; line: number } | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  const node = sel.anchorNode;
  if (!node || !editor.docEl.contains(node)) {
    return null;
  }
  const block = editor.topBlockOf(node);
  if (!(block instanceof HTMLElement) || !isInlineCode(block)) {
    return null;
  }
  const codeEl = block.querySelector(":scope > pre > code") as HTMLElement | null;
  if (!codeEl || !codeEl.contains(node)) {
    return null;
  }
  return { block, line: getCodeCaret(codeEl)?.line ?? 0 };
}

export function addAnnotation(): void {
  // A fresh (just typed) block is not synchronized yet: it has no
  // data-src-line. If the annotation editor is opened now, focus leaves the
  // document, and the background synchronization (debounce) will replace the unfocused
  // draft with a new element — the captured reference to the block goes stale, and the
  // annotation is applied only partially (the `(1)` marker stays as text).
  // Therefore we first wait for the synchronization: the focused block receives
  // data-src-line in place (it is not recreated), and only then we annotate.
  if (syncBusy()) {
    runSyncNowThen(() => addAnnotation());
    return;
  }
  // The annotation is created right away with a placeholder, and the modal
  // then opens with the placeholder selected — the text is written in the
  // document itself, with the whole toolbar available.
  const placeholder = t("Annotation text");
  // The caret is in code → an annotation for the line under the caret.
  const codeCtx = codeCaretContext();
  if (codeCtx) {
    applyCodeAnnotationAtLine(codeCtx.block, codeCtx.line, placeholder);
    editAnnotationAfterSync(placeholder);
    return;
  }
  const host = annotationHost();
  if (host) {
    const sel = document.getSelection();
    const saved = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    applyTextAnnotation(host, saved, placeholder);
    editAnnotationAfterSync(placeholder);
    return;
  }
  const code = activeCodeIsland();
  if (code) {
    applyCodeAnnotation(code, placeholder);
    editAnnotationAfterSync(placeholder);
    return;
  }
  st.set(t("Place the cursor in the text (or hover a code block) to annotate"));
}

/** The editable annotation host block nearest to the caret (paragraph/heading/item). */
function annotationHost(): HTMLElement | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  let cur: Node | null = sel.anchorNode;
  if (!cur || !editor.docEl.contains(cur)) {
    return null;
  }
  while (cur && cur !== editor.docEl) {
    if (
      cur instanceof HTMLElement &&
      /^(P|LI|H[1-6])$/.test(cur.tagName) &&
      cur.isContentEditable
    ) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * The adjacent OL list after the block, stepping over empty placeholder paragraphs.
 * The user could have pressed Enter between the block and the list (empty `<p>` with
 * “Keep writing…”) — then the OL stops being the immediate sibling, and
 * without skipping the blanks the companion list is not found (the `(n)` marker stays
 * as text, and the list is not hidden).
 */
function siblingCompanionOl(host: Element): HTMLElement | null {
  let next = host.nextElementSibling;
  while (next && next.tagName === "P" && (next.textContent ?? "").trim() === "") {
    next = next.nextElementSibling;
  }
  return next && next.tagName === "OL" ? (next as HTMLElement) : null;
}

/** The companion list for a block: a nested OL inside an LI, or the adjacent OL after the block. */
function companionList(host: HTMLElement): HTMLElement | null {
  if (host.tagName === "LI") {
    const ols = Array.from(host.children).filter((c) => c.tagName === "OL");
    return (ols[ols.length - 1] as HTMLElement | undefined) ?? null;
  }
  return siblingCompanionOl(host);
}

function applyTextAnnotation(host: HTMLElement, saved: Range | null, text: string): void {
  // The block's “known” status is checked BEFORE editing the DOM: if the block is not
  // synchronized yet (no data-src-line), we do not leave a “garbage” `(n)` marker behind.
  // Usually addAnnotation has already flushed the synchronization, but the block could have been replaced
  // by a background patch while the editor was open (the host reference went stale).
  const container = editor.topBlockOf(host) as HTMLElement | null;
  if (!container || !container.hasAttribute("data-src-line") || !editor.docEl.contains(host)) {
    if (syncBusy()) {
      runSyncNowThen(() => applyTextAnnotation(host, saved, text));
    } else {
      st.set(t("Could not add an annotation to this block"));
    }
    return;
  }

  if (saved) {
    restoreRange(saved);
  }
  // Inside a list item (including an item of another annotation — Material
  // allows nesting) the explanation list nests one indent deeper, and
  // `{ .annotate }` belongs to the item's paragraph.
  const nested = host.tagName === "LI" || host.parentElement?.tagName === "LI";
  const existing = host.classList.contains("annotate") ? companionList(host) : null;
  const index = (existing ? existing.querySelectorAll(":scope > li").length : 0) + 1;

  if (host === container) {
    // A top-level block: the explanation list is a separate adjacent block.
    // The `(n)` marker and the `.annotate` class are put into the DOM without
    // false edits (mutedRemote), after which the block is serialized — this way
    // the marker is not escaped. The annotation text is put into the list
    // source DIRECTLY, so that the Markdown inside it is not escaped.
    mutedRemote(() => {
      insertAnnotationMarker(`(${index})`);
      host.classList.add("annotate");
    });
    document.getSelection()?.removeAllRanges();
    const { start, end } = rangeOf(host);
    const edits: SyncEdit[] = [
      { start, end, text: serializeTopBlock(host).replace(/\n+$/, "") + "\n" },
    ];
    if (existing && existing.hasAttribute("data-src-line")) {
      const { start: os, end: oe } = rangeOf(existing);
      const slice = docLines().slice(os, oe);
      // Preserve the trailing blank separator line (otherwise the next block
      // sticks to the list — it becomes a lazy continuation of the item).
      const trailingBlank = trailingBlankCount(slice);
      const items = slice.slice();
      while (items.length && (items[items.length - 1] ?? "").trim() === "") {
        items.pop();
      }
      items.push(`${index}. ${text}`);
      edits.push({ start: os, end: oe, text: items.join("\n") + "\n".repeat(1 + trailingBlank) });
    } else {
      edits.push(editor.insertBlockEdit(end, `${index}. ${text}`));
    }
    sendSync(edits);
    return;
  }

  // The host lives inside a container (an admonition, a tab, a list item): the
  // whole container is rewritten as one edit. The marker is inserted with a
  // unique spelling first — `(n)` alone could match someone else's marker in
  // the serialized text — and replaced with the real one on its line. A tight
  // list item carries no paragraph to hold the class, so for items the
  // `{ .annotate }` line is spliced in textually instead.
  const uniq = `(@@${index}@@)`;
  mutedRemote(() => {
    insertAnnotationMarker(uniq);
    if (host.tagName !== "LI") {
      host.classList.add("annotate");
    }
  });
  document.getSelection()?.removeAllRanges();
  const { start, end } = rangeOf(container);
  const lines = serializeTopBlock(container).replace(/\n+$/, "").split("\n");
  const anchor = lines.findIndex((l) => l.includes(uniq));
  if (anchor < 0) {
    st.set(t("Could not add the annotation"));
    return;
  }
  lines[anchor] = lines[anchor].replace(uniq, `(${index})`);
  const baseIndent = lines[anchor].match(/^\s*/)?.[0] ?? "";
  const indent = nested ? baseIndent + "    " : baseIndent;
  // Step past the rest of the paragraph and its attribute lines, up to the
  // blank separator or the next block.
  let at = anchor + 1;
  let hasAttr = false;
  while (
    at < lines.length &&
    lines[at].trim() !== "" &&
    !/^\s*\d+[.)]\s/.test(lines[at]) &&
    !/^\s*[-*+]\s/.test(lines[at])
  ) {
    if (/^\s*\{[^}]*\.annotate[^}]*\}\s*$/.test(lines[at])) {
      hasAttr = true;
    }
    at++;
  }
  if (nested && !hasAttr) {
    lines.splice(at, 0, `${indent}{ .annotate }`);
    at++;
  }
  const item = `${indent}${index}. ${text}`;
  const itemRe = new RegExp(`^${indent}\\d+[.)]\\s`);
  let listStart = -1;
  if (at < lines.length && itemRe.test(lines[at])) {
    listStart = at;
  } else if (at + 1 < lines.length && lines[at].trim() === "" && itemRe.test(lines[at + 1])) {
    listStart = at + 1;
  }
  if (listStart >= 0) {
    // The list already exists — append an item to its end (items at this
    // indent, their continuations deeper, blank lines in between).
    let j = listStart;
    while (
      j < lines.length &&
      (lines[j].trim() === "" ||
        itemRe.test(lines[j]) ||
        (lines[j].match(/^\s*/)?.[0].length ?? 0) > indent.length)
    ) {
      j++;
    }
    while (j > listStart && (lines[j - 1] ?? "").trim() === "") {
      j--;
    }
    lines.splice(j, 0, item);
  } else {
    lines.splice(at, 0, "", item);
  }
  sendSync([{ start, end, text: lines.join("\n") + "\n" }]);
}

/** Inserts the given text marker (`(n)` / a unique stand-in) at the caret. */
function insertAnnotationMarker(markerText: string): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return;
  }
  const range = sel.getRangeAt(0);
  range.collapse(false);
  const { startContainer, startOffset } = range;
  let space = "";
  if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0) {
    const ch = (startContainer.nodeValue ?? "")[startOffset - 1];
    if (ch && !/\s/.test(ch)) {
      space = " ";
    }
  }
  const marker = document.createTextNode(`${space}${markerText}`);
  range.insertNode(marker);
  range.setStartAfter(marker);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The code block under the handle (for an annotation inside a comment). */
function activeCodeIsland(): HTMLElement | null {
  const b = activeHandleBlock();
  if (
    b &&
    b.isConnected &&
    b.getAttribute("data-block-type") === "code" &&
    b.hasAttribute("data-src-line")
  ) {
    return b;
  }
  return null;
}

/** Adds a code annotation; returns the number it got (0 — nothing was done). */
function applyCodeAnnotation(el: HTMLElement, text: string): number {
  const { start, end } = rangeOf(el);
  const fenceLines = docLines().slice(start, end);
  if (fenceLines.length < 2) {
    return 0;
  }
  const parts = parseFence(fenceLines);
  const [open, close] = COMMENT_SYNTAX[parts.lang.trim().toLowerCase()] ?? ["# ", ""];

  const next = el.nextElementSibling as HTMLElement | null;
  const companion =
    next && next.tagName === "OL" && next.hasAttribute("data-src-line") ? next : null;
  const index = (companion ? companion.querySelectorAll(":scope > li").length : 0) + 1;

  // 1) The `# (n)!` marker on its own line at the end of the code body.
  const opening = fenceLines[0];
  const closing = fenceLines[fenceLines.length - 1];
  const bodyLines = fenceLines.slice(1, -1);
  bodyLines.push(`${open}(${index})!${close}`.replace(/\s+$/, ""));
  const edits: SyncEdit[] = [
    { start, end, text: [opening, ...bodyLines, closing].join("\n") + "\n" },
  ];

  // 2) The companion list item.
  const item = `${index}. ${text}`;
  if (companion) {
    const { start: os, end: oe } = rangeOf(companion);
    let ins = oe;
    while (ins > os && (docLines()[ins - 1] ?? "").trim() === "") {
      ins--;
    }
    edits.push({ start: ins, end: ins, text: item + "\n" });
  } else {
    edits.push(editor.insertBlockEdit(end, item));
  }

  document.getSelection()?.removeAllRanges();
  sendSync(edits);
  return index;
}

/** An annotation for a specific code line: the `# (n)!` marker at the end of line lineIndex. */
function applyCodeAnnotationAtLine(el: HTMLElement, lineIndex: number, text: string): number {
  const { start, end } = rangeOf(el);
  const fence = docLines().slice(start, end);
  if (fence.length < 2) {
    return 0;
  }
  const parts = parseFence(fence);
  const [open, close] = COMMENT_SYNTAX[parts.lang.trim().toLowerCase()] ?? ["# ", ""];
  const next = el.nextElementSibling as HTMLElement | null;
  const companion =
    next && next.tagName === "OL" && next.hasAttribute("data-src-line") ? next : null;
  const index = (companion ? companion.querySelectorAll(":scope > li").length : 0) + 1;

  const opening = fence[0];
  const closing = fence[fence.length - 1];
  const bodyLines = fence.slice(1, -1);
  const marker = `${open}(${index})!${close}`.replace(/\s+$/, "");
  if (bodyLines.length === 0) {
    bodyLines.push(marker);
  } else {
    const li = Math.min(Math.max(0, lineIndex), bodyLines.length - 1);
    const cur = bodyLines[li];
    bodyLines[li] = cur.trim() === "" ? marker : `${cur.replace(/\s+$/, "")} ${marker}`;
  }
  const edits: SyncEdit[] = [
    { start, end, text: [opening, ...bodyLines, closing].join("\n") + "\n" },
  ];
  const item = `${index}. ${text}`;
  if (companion) {
    const { start: os, end: oe } = rangeOf(companion);
    let ins = oe;
    while (ins > os && (docLines()[ins - 1] ?? "").trim() === "") {
      ins--;
    }
    edits.push({ start: ins, end: ins, text: item + "\n" });
  } else {
    edits.push(editor.insertBlockEdit(end, item));
  }
  document.getSelection()?.removeAllRanges();
  sendSync(edits);
  return index;
}

// --- Annotation decoration: `(n)` → a clickable “plus”, the companion list is hidden,
//     and the content (rendered Markdown) is shown in a pop-up. ------------------

/** Decorates all annotated blocks and code blocks (after a render/patch). */
export function decorateAnnotations(): void {
  const focus = editor.currentBlock();
  mutedRemote(() => {
    hideAnnotationTip();
    for (const host of Array.from(editor.docEl.querySelectorAll<HTMLElement>(".annotate"))) {
      // The block being typed in is left alone — its markers come alive when
      // the caret leaves.
      if (focus && (host === focus || host.contains(focus))) {
        continue;
      }
      const list = annotationCompanion(host);
      if (!list) {
        continue;
      }
      const items = Array.from(list.children).filter((c) => c.tagName === "LI") as HTMLElement[];
      if (markAnnotationRefs(host, list, items) > 0) {
        list.classList.add("annotation-list");
      }
    }
    decorateCodeAnnotations(focus);
  });
}

/** The explanation list: the adjacent OL after a simple block, the last nested OL for a container. */
function annotationCompanion(host: HTMLElement): HTMLElement | null {
  if (/^(P|UL|OL|BLOCKQUOTE|TABLE|H[1-6])$/.test(host.tagName)) {
    return siblingCompanionOl(host);
  }
  for (let c = host.lastElementChild; c; c = c.previousElementSibling) {
    if (c.tagName === "OL") {
      return c as HTMLElement;
    }
  }
  return null;
}

/** Replaces the textual `(N)` with plus markers; returns the number of replacements. */
function markAnnotationRefs(host: HTMLElement, list: HTMLElement, items: HTMLElement[]): number {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = (n as Text).parentElement;
    if (!el || list.contains(n) || el.closest("pre, code, .md-annotation")) {
      continue;
    }
    if (/\(\d+\)/.test((n as Text).data)) {
      targets.push(n as Text);
    }
  }
  let used = 0;
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let rest = node.data;
    let m: RegExpExecArray | null;
    while ((m = /\((\d+)\)/.exec(rest)) !== null) {
      const idx = Number(m[1]);
      const item = items[idx - 1];
      if (!item) {
        break;
      }
      frag.appendChild(document.createTextNode(rest.slice(0, m.index)));
      frag.appendChild(makeAnnotationDot(idx, item, list));
      used++;
      rest = rest.slice(m.index + m[0].length);
    }
    if (frag.childNodes.length > 0) {
      frag.appendChild(document.createTextNode(rest));
      node.replaceWith(frag);
    }
  }
  return used;
}

/** Annotations in code: `# (n)!` in a comment + the companion list right after the block. */
function decorateCodeAnnotations(focus: Element | null): void {
  for (const block of Array.from(editor.docEl.querySelectorAll<HTMLElement>("div.highlight"))) {
    if (focus && (block === focus || block.contains(focus))) {
      continue; // the block holding the caret — the markers stay literal for editing
    }
    const next = block.nextElementSibling as HTMLElement | null;
    if (!next || next.tagName !== "OL" || !/\(\d+\)!/.test(block.textContent ?? "")) {
      continue;
    }
    const items = Array.from(next.children).filter((c) => c.tagName === "LI") as HTMLElement[];
    let used = 0;
    for (const comment of Array.from(block.querySelectorAll<HTMLElement>(".hljs-comment"))) {
      const m = /\((\d+)\)!/.exec(comment.textContent ?? "");
      const item = m ? items[Number(m[1]) - 1] : undefined;
      if (!m || !item) {
        continue;
      }
      comment.textContent = "";
      comment.appendChild(makeAnnotationDot(Number(m[1]), item, next));
      used++;
    }
    // Monochrome mode (no comment highlighting): the `# (N)!` tail is replaced.
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (
        /\(\d+\)!/.test((n as Text).data) &&
        !(n as Text).parentElement?.closest(".hljs-comment")
      ) {
        nodes.push(n as Text);
      }
    }
    for (const node of nodes) {
      const m = /(?:#|\/\/|;|--|<!--)?\s*\((\d+)\)!(?:\s*-->)?\s*$/.exec(
        node.data.replace(/\n$/, ""),
      );
      const item = m ? items[Number(m[1]) - 1] : undefined;
      if (!m || !item) {
        continue;
      }
      const keepNL = node.data.endsWith("\n") ? "\n" : "";
      node.data = node.data.replace(/\n$/, "").slice(0, m.index).replace(/\s+$/, " ");
      node.after(makeAnnotationDot(Number(m[1]), item, next), document.createTextNode(keepNL));
      used++;
    }
    if (used > 0) {
      next.classList.add("annotation-list");
    }
  }
}

function makeAnnotationDot(idx: number, item: HTMLElement, list: HTMLElement): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "md-annotation";
  dot.setAttribute("contenteditable", "false");
  dot.setAttribute("data-annotation-index", String(idx));
  // A click on the dot must not move focus into the editable code: otherwise focusin
  // would repaint the block into literal markers and remove the dot before the tooltip opens.
  dot.addEventListener("mousedown", (e) => e.preventDefault());
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (annotTips.some((tip) => tip.dot === dot)) {
      hideAnnotationTip();
      return;
    }
    // Inside an open editor the note is already editable — its nested marker
    // goes straight to an editor of its own, on top, not to a read-only tip.
    if (inSubEditor() && editor.docEl.contains(dot)) {
      const nested = list.querySelectorAll<HTMLElement>(":scope > li")[idx - 1];
      if (nested) {
        openAnnotationModal(nested);
        return;
      }
    }
    openAnnotationTip(dot, item, list, idx);
  });
  return dot;
}

/** The annotation action icons (a thin currentColor stroke, in the TBL_ICONS style). */
const ANNOTIP_ICONS = {
  edit: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.4 2.3 13.7 4.6"/><path d="M10.5 3.2 3.1 10.6l-.8 3.1 3.1-.8 7.4-7.4z"/></svg>',
  del: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.7 4.2h10.6"/><path d="M6 4.2V2.9h4v1.3"/><path d="M4.2 4.2 4.8 13a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.8"/><path d="M6.7 6.6v5M9.3 6.6v5"/></svg>',
};

// The tips stack the way they do on the Material site: a nested annotation's
// marker sits inside its parent's pop-up and opens another pop-up on top of
// it. The stack is managed apart from the ordinary popups — those close each
// other, tips must not.
interface AnnotTip {
  pop: HTMLElement;
  dot: HTMLElement;
}
export const annotTips: AnnotTip[] = [];

/** Closes the tips from the given depth up (0 — the whole stack). */
export function closeAnnotationTips(from = 0): void {
  for (const tip of annotTips.splice(from)) {
    tip.dot.classList.remove("on");
    tip.pop.remove();
  }
}

function hideAnnotationTip(): void {
  closeAnnotationTips(0);
}

/**
 * The annotation pop-up: rendered Markdown + the “Edit”/“Delete” icons.
 * `docDot` is the marker in the document — for a nested tip the anchor is a
 * clone inside the parent pop-up, and deletion needs the real one.
 */
// A running salt so each cloned fragment (an annotation tip) gets ids nobody
// else in the document uses.
let cloneIdSalt = 0;

/**
 * Makes the ids inside a cloned fragment unique so they do not collide with the
 * originals still in the document — a duplicate id shadows one another and
 * `label[for=]`/anchor links resolve to the wrong copy. The label→radio and
 * `#anchor` references are rewritten to match, so tabs and footnotes keep
 * working inside the clone.
 */
function uniquifyIds(root: HTMLElement): void {
  const salt = `_c${++cloneIdSalt}`;
  const remap = new Map<string, string>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[id]"))) {
    const old = el.getAttribute("id");
    if (old) {
      remap.set(old, old + salt);
      el.setAttribute("id", old + salt);
    }
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[for]"))) {
    const f = el.getAttribute("for");
    if (f && remap.has(f)) {
      el.setAttribute("for", remap.get(f) as string);
    }
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('a[href^="#"]'))) {
    const target = (el.getAttribute("href") ?? "").slice(1);
    if (remap.has(target)) {
      el.setAttribute("href", "#" + remap.get(target));
    }
  }
  // Radio groups are matched by name document-wide — salt them too, or the
  // clone's tab set would share a group with the document's copy.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("input[name]"))) {
    const n = el.getAttribute("name");
    if (n) {
      el.setAttribute("name", n + salt);
    }
  }
}

function openAnnotationTip(
  dot: HTMLElement,
  item: HTMLElement,
  list: HTMLElement,
  idx: number,
  depth = 0,
  docDot: HTMLElement = dot,
): void {
  closeAnnotationTips(depth);
  if (depth === 0) {
    closePopup(); // a form or a menu could be open under the first tip
  }
  const rect = dot.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "vpop vannotip";
  pop.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  pop.style.top = `${rect.bottom + window.scrollY + 6}px`;
  pop.style.zIndex = String(60 + depth);
  document.body.appendChild(pop);
  requestAnimationFrame(() => {
    if (!pop.isConnected) {
      return;
    }
    const maxX = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
    if (parseFloat(pop.style.left) > maxX) {
      pop.style.left = `${Math.max(8, maxX)}px`;
    }
  });
  dot.classList.add("on");
  annotTips.push({ pop, dot });

  const body = document.createElement("div");
  body.className = "vannotip-body";
  body.innerHTML = item.innerHTML;
  // The clone repeats the note's ids (tab radios `__tabbed_N_M`, footnote
  // anchors). They already exist in the document's hidden companion list, so a
  // tab label's `for=` resolved to that hidden copy and switching a tab here
  // did nothing. Re-id the clone (keeping label→radio and anchor links intact)
  // so its tabs switch on their own.
  uniquifyIds(body);

  // Nested markers inside the clone come alive: a click opens the next tip on
  // top, like on the published site. Each marker finds its OWN companion list
  // through its host block, so a nested annotation buried in a tab or an
  // admonition is wired too — not only one sitting as a direct child of the
  // note. The clone preserves document order, so the real dot (for delete)
  // is the one at the same position in the original item.
  const cloneDots = Array.from(body.querySelectorAll<HTMLElement>(".md-annotation"));
  const realDots = Array.from(item.querySelectorAll<HTMLElement>(".md-annotation"));
  cloneDots.forEach((cloneDot, i) => {
    const host = cloneDot.closest<HTMLElement>(".annotate");
    const cloneList = host ? annotationCompanion(host) : null;
    if (
      !cloneList ||
      !cloneList.classList.contains("annotation-list") ||
      cloneList.contains(cloneDot)
    ) {
      return;
    }
    const k = Number(cloneDot.getAttribute("data-annotation-index"));
    const target = Array.from(cloneList.children).filter((c) => c.tagName === "LI")[k - 1] as
      HTMLElement | undefined;
    if (!target) {
      return;
    }
    const realDot = realDots[i] ?? cloneDot;
    cloneDot.addEventListener("mousedown", (e) => e.preventDefault());
    cloneDot.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Toggle: a second click on the same marker folds its tip back (and
      // any deeper ones), the way the top-level marker toggles its own.
      if (annotTips.some((tip) => tip.dot === cloneDot)) {
        closeAnnotationTips(depth + 1);
        return;
      }
      openAnnotationTip(cloneDot, target, cloneList, k, depth + 1, realDot);
    });
  });

  const actions = document.createElement("div");
  actions.className = "vannotip-actions";
  const mkAction = (
    icon: string,
    tip: string,
    danger: boolean,
    fn: () => void,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = icon;
    b.setAttribute("data-tip", tip);
    if (danger) {
      b.className = "vannotip-del"; // an own scoped modifier (not the global `.danger`)
    }
    b.addEventListener("mousedown", (e) => e.preventDefault()); // do not move focus/the caret away
    b.addEventListener("click", fn);
    return b;
  };

  const edit = mkAction(ANNOTIP_ICONS.edit, t("Edit"), false, () => {
    hideAnnotationTip();
    openAnnotationInline(list, idx);
  });
  const del = mkAction(ANNOTIP_ICONS.del, t("Delete"), true, () => {
    hideAnnotationTip();
    deleteAnnotation(docDot, list, idx);
  });
  actions.append(edit, del);
  pop.append(actions, body);
}

// A click outside the tips closes them; a click inside tip N keeps N and its
// ancestors, closing only the deeper ones. Dots run their own toggle.
document.addEventListener("mousedown", (e) => {
  if (annotTips.length === 0) {
    return;
  }
  const target = e.target as Node;
  // A marker runs its own toggle on click — folding deeper tips from here would
  // race it (mousedown closes, the click reopens) and the nested tip would
  // never collapse. Leave markers to their handler.
  if (target instanceof HTMLElement && target.closest(".md-annotation")) {
    return;
  }
  const inTip = annotTips.findIndex((tip) => tip.pop.contains(target));
  if (inTip >= 0) {
    closeAnnotationTips(inTip + 1);
    return;
  }
  closeAnnotationTips(0);
});

function openAnnotationInline(list: HTMLElement, idx: number): void {
  const item = list.querySelectorAll<HTMLElement>(":scope > li")[idx - 1];
  if (item) {
    openAnnotationModal(item);
  }
}

/** Opens the annotation just added for editing (after the sync re-render). */
function editAnnotationAfterSync(placeholder: string): void {
  setAfterSync(() => {
    // The freshly created item is found by its placeholder text — an index
    // would be ambiguous: markers are numbered per list, and nested lists
    // reuse the same numbers.
    const items = Array.from(
      editor.docEl.querySelectorAll<HTMLElement>("ol.annotation-list li"),
    ).filter((li) => (li.textContent ?? "").trim() === placeholder);
    const item = items[items.length - 1];
    if (item) {
      openAnnotationModal(item, true);
    }
  });
}

/** How many trailing blank lines the slice has (separators before the next block). */
export function trailingBlankCount(lines: string[]): number {
  let n = 0;
  while (n < lines.length && (lines[lines.length - 1 - n] ?? "").trim() === "") {
    n++;
  }
  return n;
}

/** Deletes an annotation: the marker from the block, the item from the list, and renumbers the rest. */
function deleteAnnotation(dot: HTMLElement, list: HTMLElement, idx: number): void {
  // A companion that lives inside a container (an admonition, a tab, another
  // annotation's item): its lines sit inside the top block's range — two text
  // edits would overlap and corrupt the file. That case is edited in the DOM
  // and the whole block is serialized as a single edit. Code annotations stay
  // on the text path: their markers are comment text inside the fence.
  const inCode = dot.closest("pre, .vcode, div.highlight") !== null;
  if (!inCode && list.parentElement !== editor.docEl) {
    deleteAnnotationInBlock(dot, list, idx);
    return;
  }
  const block = editor.topBlockOf(dot);
  if (!block || !block.hasAttribute("data-src-line")) {
    return;
  }
  const isCode = block.getAttribute("data-block-type") === "code";
  const b = rangeOf(block);
  const blockLines = docLines().slice(b.start, b.end);

  // Renumber the markers in the block, dropping idx.
  const markerRe = isCode ? /\((\d+)\)!/g : /\((\d+)\)/g;
  let newBlock = blockLines.join("\n").replace(markerRe, (_full, n) => {
    const num = Number(n);
    if (num === idx) {
      return isCode ? "(∅)!" : "(∅)"; // a temporary marker used to clean up the line/spaces
    }
    return isCode ? `(${num > idx ? num - 1 : num})!` : `(${num > idx ? num - 1 : num})`;
  });
  if (isCode) {
    // The marker is removed, cleaning up the empty comment left behind; a comment line
    // that consisted of the marker alone is deleted entirely.
    const out: string[] = [];
    for (const line of newBlock.split("\n")) {
      if (!line.includes("(∅)!")) {
        out.push(line);
        continue;
      }
      const cleaned = line
        .replace(/\(∅\)!/g, "")
        .replace(/\s*<!--\s*-->\s*$/, "")
        .replace(/\s*(#|\/\/|;|--)\s*$/, "")
        .replace(/\s+$/, "");
      if (cleaned.trim() !== "") {
        out.push(cleaned);
      }
    }
    newBlock = out.join("\n");
  } else {
    newBlock = newBlock.replace(/\s*\(∅\)/g, "");
  }

  const edits: SyncEdit[] = [{ start: b.start, end: b.end, text: newBlock + "\n" }];

  // The list: remove item idx and renumber; an empty list is deleted.
  const l = rangeOf(list);
  const listSlice = docLines().slice(l.start, l.end);
  const trailingBlank = trailingBlankCount(listSlice); // the trailing separator — preserve it
  const parts = listSlice
    .join("\n")
    .replace(/\n+$/, "")
    .split(/\n(?=\d+\.\s)/)
    .map((p) =>
      p
        .replace(/^\s*\d+\.\s+/, "")
        .split("\n")
        .map((ln) => ln.replace(/^\s{1,4}/, ""))
        .join("\n"),
    );
  parts.splice(idx - 1, 1);
  if (parts.length === 0) {
    edits.push(deleteEdit(l.start, l.end));
  } else {
    edits.push({
      start: l.start,
      end: l.end,
      text: renumberList(parts) + "\n".repeat(1 + trailingBlank),
    });
  }

  hideAnnotationTip();
  document.getSelection()?.removeAllRanges();
  sendSync(edits);
}

/**
 * Deleting an annotation whose list is nested in a container: the marker, the
 * renumbering and the item are all edited in the DOM, and the container is
 * serialized back as one edit. The ordered list renumbers itself — the
 * serializer numbers items by position.
 */
function deleteAnnotationInBlock(dot: HTMLElement, list: HTMLElement, idx: number): void {
  const container = editor.topBlockOf(list) as HTMLElement | null;
  if (!container || !container.hasAttribute("data-src-line")) {
    return;
  }
  const host = dot.closest<HTMLElement>(".annotate");
  mutedRemote(() => {
    // The space glued to the marker on insertion goes away with it.
    const prev = dot.previousSibling;
    if (prev?.nodeType === Node.TEXT_NODE && /\s$/.test(prev.nodeValue ?? "")) {
      prev.nodeValue = (prev.nodeValue ?? "").replace(/\s$/, "");
    }
    dot.remove();
    if (host) {
      for (const d of Array.from(host.querySelectorAll<HTMLElement>(".md-annotation"))) {
        const n = Number(d.getAttribute("data-annotation-index"));
        if (n > idx) {
          d.setAttribute("data-annotation-index", String(n - 1));
        }
      }
    }
    list.querySelectorAll(":scope > li")[idx - 1]?.remove();
    if (list.querySelectorAll(":scope > li").length === 0) {
      // The last explanation is gone — the list and the `{ .annotate }` of its
      // paragraph go too.
      list.remove();
      host?.classList.remove("annotate");
    }
  });
  hideAnnotationTip();
  document.getSelection()?.removeAllRanges();
  const { start, end } = rangeOf(container);
  sendSync([{ start, end, text: serializeTopBlock(container).replace(/\n+$/, "") + "\n" }]);
}

/** A list of items → numbered Markdown (multi-line ones get a 4-space indent). */
export function renumberList(parts: string[]): string {
  return parts
    .map((t, i) => {
      const lines = t.split("\n");
      const head = `${i + 1}. ${lines[0]}`;
      const tail = lines
        .slice(1)
        .map((l) => (l === "" ? "" : `    ${l}`))
        .join("\n");
      return tail ? `${head}\n${tail}` : head;
    })
    .join("\n");
}
