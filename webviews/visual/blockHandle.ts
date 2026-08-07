// The block handle “⋮⋮”.
//
// It appears to the left of the ACTIVE block — the one that was clicked or
// where the caret was placed. Not on hover: a pointer wandering over the text
// would jerk the handle around for no reason, and it would distract while
// typing.
//
// The handle is the single entry point to all block actions (the menu on
// click) and the drag grip: pulling it moves the block among the siblings at
// its own level. It works the same for top-level and nested blocks (in an
// admonition, a tab, a grid card, a quote).

import {
  deleteEdit,
  dirty,
  docEndsNL,
  docLines,
  isFootnoteService,
  rangeOf,
  requestFullRender,
  runSyncNowThen,
  scheduleSync,
  sendSync,
  st,
} from "./editorCore";
import { readBlockClipboard, writeBlockClipboard } from "./blockClipboard";
import { dedentLines, moveBlockEdits } from "./blockMove";
import { fromList, fromQuote, renumber, retypeList, type ListKind } from "./blockOps";
import {
  ADMONITION_LABELS,
  ADMONITION_TYPES,
  renderAdmonitionControls,
  type InsertPoint,
} from "./blockInserts";
import { closePopup, showPopup, type QuickItem } from "./popups";
import { t } from "../shared/i18n";

/** What the handle needs from the editor around it. */
export interface BlockHandleHost {
  /** The document root: everything the handle can touch lives inside it. */
  readonly docEl: HTMLElement;
  /** The outermost block a node belongs to — the one that gets re-serialized. */
  topBlockOf(node: Node | null): Element | null;
  /** The nearest ancestor (or the block itself) that owns lines in the file. */
  rangedAncestor(el: Element | null): HTMLElement | null;
  /** The indent of a line of the file, so a paste keeps its nesting level. */
  indentOfLine(line: number): string;
  /** Replaces a range of lines and leaves the caret on one of them. */
  replaceLines(start: number, end: number, lines: string[], caretLine?: number): void;
  /** Inserts a ready piece of Markdown at a point in the file. */
  insertMarkdownBlock(template: string, at?: InsertPoint): void;
  /** Opens the in-place editor for a block's own Markdown. */
  openIslandEditor(el: HTMLElement): void;
  /** Hides the hover tip — a drag must not leave one hanging over the page. */
  hideTip(): void;
  /** Draws a list of menu items into an open popup. */
  renderQuickMenu(pop: HTMLElement, items: QuickItem[]): void;
  /** Whether the block is a fenced code block with a menu of its own. */
  isInlineCode(el: Element): boolean;
  /** That menu: language, line numbers, title, highlighting. */
  codeMenuItems(block: HTMLElement): QuickItem[];
  /** The language of a fence, for naming the block in the menu header. */
  fenceInfoOf(block: Element): { lang: string };
}

let host: BlockHandleHost;

let handleEl: HTMLElement;
/** The marked block — the one the handle stands next to (see “Which block is marked”). */
let handleFor: HTMLElement | null = null;
/** Whether that mark is held against the caret; the next Escape steps out. */
let escalated = false;
/** The block the caret was in when the hold began. */
let escalatedFrom: HTMLElement | null = null;

/**
 * A drag in progress. The targets are only siblings at the same level: a
 * top-level block moves among the document's blocks, a nested one inside its
 * own admonition/tab/quote. This way a drag cannot accidentally take a
 * paragraph out of a call-out or, conversely, drag it inside.
 */
interface DragState {
  block: HTMLElement;
  siblings: HTMLElement[];
  /** Where the block will land: before this sibling (null — at the very end). */
  before: HTMLElement | null;
  x: number;
  y: number;
}
let dragState: DragState | null = null;
let dragMoved = false;
let dropLine: HTMLElement | null = null;
let autoScroll = 0;

/** Creates the handle and wires everything that listens for the whole page. */
export function initBlockHandle(next: BlockHandleHost): void {
  host = next;

  handleEl = document.createElement("div");
  handleEl.id = "vhandle";
  handleEl.textContent = "⋮⋮";
  handleEl.setAttribute("data-tip", t("Block actions · drag to move"));
  document.body.appendChild(handleEl);

  window.addEventListener("resize", repositionHandle);

  // A click on the document selects a block. Inside islands
  // (contenteditable=false) there is no caret and selectionchange does not
  // fire — that is why we listen for the click itself.
  host.docEl.addEventListener("mousedown", (e) => {
    if (dragState) {
      return;
    }
    const target = e.target as Node;
    const el = target instanceof Element ? target : target.parentElement;
    activateBlock(handleBlockOf(target));
    // Clicking a tab label picks the tab SET — that is the only way to reach
    // it. The click also switches the tab, and the caret lands in the body
    // inside; without holding on, the handle would slide down to that
    // paragraph and the cut would take it instead of the whole set.
    if (el?.closest(".tabbed-labels")) {
      escalated = true;
      escalatedFrom = null;
    }
  });

  // Typing ends the Escape walk: the author is back in the text, so the handle
  // belongs to the block the caret is in again.
  host.docEl.addEventListener("beforeinput", () => {
    escalated = false;
  });

  // A click on the empty area of the page clears the selection: keeping a
  // block highlighted after leaving it is misleading.
  document.addEventListener("mousedown", (e) => {
    const target = e.target as Node;
    if (host.docEl.contains(target) || (target as HTMLElement).closest?.(KEEP_ACTIVE)) {
      return;
    }
    hideHandle();
  });

  handleEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragMoved) {
      dragMoved = false; // it was a drag, not a click — the menu is not opened
      return;
    }
    openBlockMenu();
  });

  handleEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !handleFor) {
      return;
    }
    e.preventDefault(); // do not start a text selection
    const siblings = movableSiblings(handleFor);
    dragMoved = false;
    if (siblings.length < 2) {
      return; // there is nowhere to move — the handle stays just a menu button
    }
    dragState = { block: handleFor, siblings, before: null, x: e.clientX, y: e.clientY };
  });

  document.addEventListener("mousemove", (e) => {
    const drag = dragState;
    if (!drag) {
      return;
    }
    if (!dragMoved) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) {
        return; // a hand tremor on the click — not a drag yet
      }
      dragMoved = true;
      closePopup();
      host.hideTip();
      document.body.classList.add("vdragging");
      drag.block.classList.add("vdrag-src");
    }
    drag.before = dropTargetAt(drag.siblings, e.clientY);
    showDropLine(drag);
    autoScroll = e.clientY < 80 ? -14 : e.clientY > window.innerHeight - 80 ? 14 : 0;
  });

  document.addEventListener("mouseup", () => {
    if (dragState) {
      endDrag(true);
    }
  });

  // Auto-scrolling at the window edges: without it a block cannot be dragged
  // beyond the screen.
  setInterval(() => {
    if (autoScroll !== 0 && dragState) {
      window.scrollBy(0, autoScroll);
    }
  }, 16);
}

/** The block the handle currently belongs to, if any. */
export function activeHandleBlock(): HTMLElement | null {
  return handleFor;
}

/** Whether a block is being dragged right now. */
export function blockDragActive(): boolean {
  return dragState !== null;
}

/**
 * Abandons a drag in progress and reports whether there was one. Escape is
 * shared with the popups and the annotation editors, so the ladder that
 * decides who gets it lives outside this module.
 */
export function cancelBlockDrag(): boolean {
  if (!dragState) {
    return false;
  }
  dragMoved = false;
  endDrag(false);
  return true;
}

/** Places the handle to the left of the block and highlights the block itself as active. */
function placeHandle(block: HTMLElement): void {
  if (handleFor && handleFor !== block) {
    handleFor.removeAttribute("data-vactive");
  }
  handleFor = block;
  block.setAttribute("data-vactive", "");
  const rect = block.getBoundingClientRect();
  const docRect = host.docEl.getBoundingClientRect();
  // The handle is always in the gutter to the left of the canvas: a nested block has no free
  // space at its edges, and the handle would overlap the admonition's border. Which
  // block exactly is active is visible from the stripe to its left and from the line in the menu.
  handleEl.style.left = `${Math.max(4, docRect.left + window.scrollX - 32)}px`;
  handleEl.style.top = `${rect.top + window.scrollY + 2}px`;
  handleEl.classList.add("show");
}

function hideHandle(): void {
  handleFor?.removeAttribute("data-vactive");
  handleFor = null;
  escalated = false;
  escalatedFrom = null;
  handleEl.classList.remove("show");
}

/** Puts the handle back in place after a re-render/scroll/resize. */
export function repositionHandle(): void {
  if (handleFor && handleFor.isConnected) {
    placeHandle(handleFor);
  } else if (handleFor) {
    hideHandle();
  }
}

/**
 * The containers inside which a block has its own handle. The list is closed: inside
 * a table cell or a list item a block lives by its own rules (Tab/Enter and the table menu
 * work there), and the handle would only get in the way.
 */
function isHandleContainer(el: Element | null): boolean {
  return (
    el === host.docEl ||
    (el instanceof HTMLElement &&
      (el.classList.contains("admonition") ||
        el.classList.contains("tabbed-block") ||
        el.classList.contains("card") ||
        el.tagName === "BLOCKQUOTE"))
  );
}

/**
 * A container's chrome — an admonition's title line, a collapsible one's
 * summary — carries the range of the container's own marker. Treating it as a
 * block of its own beheads the container: “Delete block” on the title cuts the
 * `!!!` line and leaves the body behind as an indented code block. The handle
 * walks past the chrome to the container itself.
 */
const CONTAINER_CHROME = ".admonition-title, summary";

/**
 * The block under the handle: the deepest block with lines in the file that lies directly in an
 * allowed container, otherwise the top-level block. This way both a paragraph inside an
 * admonition and code inside a tab get a handle; the parent can be reached
 * via the “breadcrumbs” in the menu header.
 */
export function handleBlockOf(node: Node | null): HTMLElement | null {
  let start: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!start || !host.docEl.contains(start)) {
    return null;
  }
  // We do not descend into a table: rows and cells are the table menu's business.
  const table = start.closest("table");
  if (table && host.docEl.contains(table)) {
    start = table;
  }
  let cur: Element | null = start;
  while (cur && cur !== host.docEl) {
    const parent: HTMLElement | null = cur.parentElement;
    if (parent === host.docEl) {
      return cur as HTMLElement;
    }
    if (
      cur.hasAttribute("data-src-line") &&
      !cur.matches(CONTAINER_CHROME) &&
      isHandleContainer(parent)
    ) {
      return cur as HTMLElement;
    }
    cur = parent;
  }
  return null;
}

/** The block under the handle for the current caret. */
export function caretHandleBlock(): HTMLElement | null {
  const sel = document.getSelection();
  const node = sel && sel.rangeCount > 0 ? sel.anchorNode : null;
  return node && host.docEl.contains(node) ? handleBlockOf(node) : null;
}

// Which block is marked, and by whom. `handleFor` is the mark itself; `held` is
// what says the mark must NOT follow the caret around. A mark is held by Escape
// (the walk out of the text) and by a click on a tab label — in both cases the
// caret ends up in a block inside the marked container, and letting it pull the
// mark down there would take the wrong block on Cmd+X. A click on the text, or
// typing, releases the hold; see `activateBlock` and the beforeinput listener.

/** Makes a block active (the handle plus the highlighting), releasing any hold. */
export function activateBlock(block: HTMLElement | null): void {
  escalated = false; // the caret or a click chose this block, not Escape
  if (!block || block.classList.contains("vlive")) {
    hideHandle();
    return;
  }
  if (block !== handleFor) {
    placeHandle(block);
  }
}

/**
 * The handle following the caret. A held mark stays where it is as long as the
 * caret is still inside it — the caret has not really moved, the selection was
 * merely re-reported, or the click that set the mark also put the caret in the
 * container's body. Leaving the marked block ends the hold.
 */
export function followCaret(block: HTMLElement | null): void {
  if (escalated && block && (block === escalatedFrom || handleFor?.contains(block) === true)) {
    return;
  }
  activateBlock(block);
}

/**
 * Escape steps out of the text: the first press marks the block the caret is
 * in, each next one marks its container — a paragraph, then the tab it lives
 * in, then the whole tab set — until there is nothing above and the mark is
 * cleared. This is how a container gets selected at all: clicking inside tabs
 * or a call-out always lands in some inner block, and the shortcuts act on
 * whatever is marked.
 */
export function escalateBlock(): boolean {
  const marked = handleFor?.isConnected === true ? handleFor : null;
  const target =
    escalated && marked ? handleBlockOf(marked.parentElement) : (marked ?? caretHandleBlock());
  if (!target) {
    hideHandle();
    return false;
  }
  if (!escalated) {
    escalatedFrom = caretHandleBlock();
  }
  placeHandle(target);
  escalated = true;
  return true;
}

// The interface elements that preserve the selection when clicked: they work
// with EXACTLY the active block, so leaving them must not clear it.
const KEEP_ACTIVE = "#vt, #vtoc, #vhandle, .vpop, .vbubble, .vtable-menu, .vlive, .vlive-bar";

function openBlockMenu(): void {
  const block = handleFor;
  if (!block) {
    return;
  }
  const rect = handleEl.getBoundingClientRect();
  const pop = showPopup(rect.left + window.scrollX, rect.bottom + window.scrollY + 4);
  renderBlockMenu(pop, block);
}

/** The block's siblings, among which it can be rearranged. */
export function movableSiblings(block: HTMLElement): HTMLElement[] {
  const parent = block.parentElement;
  if (!parent || !isHandleContainer(parent)) {
    return [];
  }
  return Array.from(parent.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el.hasAttribute("data-src-line") &&
      !el.classList.contains("vlive") &&
      !el.classList.contains("admonition-title") &&
      !isFootnoteService(el),
  );
}

/** Which sibling the block will land before at the pointer's current position. */
export function dropTargetAt(siblings: readonly HTMLElement[], y: number): HTMLElement | null {
  for (const sib of siblings) {
    const rect = sib.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      return sib;
    }
  }
  return null; // below all of them — to the end
}

function showDropLine(drag: DragState): void {
  if (!dropLine) {
    dropLine = document.createElement("div");
    dropLine.id = "vdrop";
    document.body.appendChild(dropLine);
  }
  const last = drag.siblings[drag.siblings.length - 1];
  const anchor = drag.before ?? last;
  const rect = anchor.getBoundingClientRect();
  const y = drag.before ? rect.top : rect.bottom;
  // The width is taken from the container, not from the target block: otherwise the line would jump
  // from narrow (over a table) to wide (over a paragraph) and would read as a part of the block.
  const parent = drag.block.parentElement ?? host.docEl;
  const pr = parent.getBoundingClientRect();
  const cs = getComputedStyle(parent);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  dropLine.style.left = `${pr.left + window.scrollX + padLeft}px`;
  dropLine.style.width = `${Math.max(40, pr.width - padLeft - padRight)}px`;
  dropLine.style.top = `${y + window.scrollY - 1}px`;
  dropLine.classList.add("show");
}

function endDrag(commit: boolean): void {
  const drag = dragState;
  dragState = null;
  autoScroll = 0;
  dropLine?.classList.remove("show");
  document.body.classList.remove("vdragging");
  drag?.block.classList.remove("vdrag-src");
  if (drag && commit && dragMoved) {
    moveBlockBefore(drag.block, drag.before);
  }
}

/**
 * Moves the block before the sibling `before` (null — to the end). The edit is line-based:
 * the block's lines are cut out and inserted at the new place, so the neighboring blocks —
 * including those inside an admonition — stay byte-for-byte identical in the file.
 */
function moveBlockBefore(block: HTMLElement, before: HTMLElement | null): void {
  if (!block.isConnected || before === block) {
    return;
  }
  const siblings = movableSiblings(block);
  const last = siblings[siblings.length - 1];
  const src = rangeOf(block);
  const anchor = before ? rangeOf(before).start : rangeOf(last).end;
  const edits = moveBlockEdits(docLines(), src.start, src.end, anchor, docEndsNL());
  if (edits.length === 0) {
    return; // the block already sits at this position
  }
  hideHandle();
  document.getSelection()?.removeAllRanges();
  requestFullRender(); // after the move the ranges of all blocks have shifted
  sendSync(edits);
}

/** The “Move up/down” items — the same operation from the keyboard and with the mouse. */
function moveBlockByStep(block: HTMLElement, delta: -1 | 1): void {
  const siblings = movableSiblings(block);
  const at = siblings.indexOf(block);
  if (at < 0) {
    return;
  }
  const to = at + delta;
  if (to < 0 || to >= siblings.length) {
    return;
  }
  // Downwards: we land before the block that comes AFTER the sibling (otherwise only the ranges
  // would swap, while the order stayed the same).
  moveBlockBefore(block, delta < 0 ? siblings[to] : (siblings[to + 1] ?? null));
}

/** The context action menu for the block under the handle. */
function deleteBlockAction(block: HTMLElement): void {
  hideHandle();
  // A block with lines in the file is deleted by editing the file — a DOM removal of a nested
  // block would have to be rebuilt through serialization of the parent.
  const ranged = host.rangedAncestor(block);
  if (ranged === block) {
    const { start, end } = rangeOf(block);
    requestFullRender();
    sendSync([deleteEdit(start, end)]);
    return;
  }
  const owner = host.topBlockOf(block);
  block.remove();
  if (owner && owner !== block && owner.isConnected) {
    dirty.add(owner);
  }
  st.set(t("Changed…"));
  scheduleSync();
}

/**
 * The name of the block type — for the menu header. It replaces the former labels like
 * “Edit the diagram” on every item: the type is named once at the top, while the
 * actions are the same for all blocks.
 */
export function blockTypeName(block: HTMLElement): string {
  if (block.classList.contains("admonition")) {
    const kind = Array.from(block.classList).find((c) => ADMONITION_TYPES.includes(c));
    const title = kind ? ADMONITION_LABELS[kind] : undefined;
    return title ? t("Call-out: {0}", title) : t("Call-out");
  }
  if (block.classList.contains("tabbed-set")) return t("Tabs");
  if (block.classList.contains("mermaid")) return t("Mermaid diagram");
  if (block.classList.contains("arithmatex")) return t("Formula");
  if (block.classList.contains("mkdocstrings")) return t("API reference (mkdocstrings)");
  if (block.classList.contains("grid")) return t("Card grid");
  if (block.classList.contains("card")) return t("Card");
  if (block.classList.contains("tabbed-block")) return t("Tab");
  if (block.getAttribute("data-block-type") === "code" || block.classList.contains("highlight")) {
    const lang = host.fenceInfoOf(block).lang;
    return lang ? t("Code block: {0}", lang) : t("Code block");
  }
  if (/^H[1-6]$/.test(block.tagName)) return t("Heading {0}", block.tagName[1]);
  switch (block.tagName) {
    case "P":
      return block.querySelector(":scope > img") ? t("Image") : t("Paragraph");
    case "UL":
      return block.querySelector(".task-list-item") ? t("Task list") : t("Bulleted list");
    case "OL":
      return t("Numbered list");
    case "DL":
      return t("Definition list");
    case "TABLE":
      return t("Table");
    case "BLOCKQUOTE":
      return t("Quote");
    case "HR":
      return t("Divider");
    case "PRE":
      return t("Code block");
    default:
      return t("Block");
  }
}

/**
 * Opens the block's source Markdown in an in-place editor. For a nested block the
 * common indent is stripped (an admonition's four spaces are service ones, there is no point
 * in editing them by hand) and restored on save.
 */
function openBlockSource(block: HTMLElement): void {
  if (!block.hasAttribute("data-src-line")) {
    const at = Array.from(host.docEl.children).indexOf(block);
    if (at >= 0) {
      // The draft is not in the file yet: the edit is first pushed to disk, then the source of the
      // now-matched block is edited.
      runSyncNowThen(() => {
        const fresh = host.docEl.children[at];
        if (fresh instanceof HTMLElement && fresh.hasAttribute("data-src-line")) {
          openBlockSource(fresh);
        }
      });
      return;
    }
    // A nested wrapper without lines of its own (a tab panel, a card) —
    // we edit the source of the nearest block that does have lines.
    const owner = host.rangedAncestor(block);
    if (owner) {
      host.openIslandEditor(owner);
    }
    return;
  }
  host.openIslandEditor(block);
}

/** The list type for a UL/OL block (for the type-change items). */
function listKindOfBlock(block: HTMLElement): ListKind | null {
  if (block.tagName === "OL") {
    return "ol";
  }
  if (block.tagName === "UL") {
    return block.querySelector(":scope > li.task-list-item") ? "task" : "ul";
  }
  return null;
}

/** Changes the type of the whole list (null — unfold the items into paragraphs). */
function retypeListBlock(block: HTMLElement, kind: ListKind | null): void {
  const { start, end } = rangeOf(block);
  const src = docLines().slice(start, end);
  const base = host.indentOfLine(start);
  host.replaceLines(
    start,
    end,
    kind === null ? fromList(src, base) : renumber(retypeList(src, kind, base)),
  );
}

function blockMenuItems(block: HTMLElement): QuickItem[] {
  const items: QuickItem[] = [];

  // An inline code block: language/numbers/title/line highlighting.
  if (host.isInlineCode(block)) {
    items.push(...host.codeMenuItems(block));
  }
  // Admonition: the type and the collapsibility are laid out right in the menu (renderBlockSection).
  // Tabs are added/removed on the label row (“+” and “×”), see wireTabControls.

  // A list: changing the type as a whole. The “List” button on the toolbar works from the caret,
  // whereas here the operation is targeted — at the list that has the handle.
  const kind = listKindOfBlock(block);
  if (kind) {
    const types: Array<[ListKind, string]> = [
      ["ul", `• ${t("Make it bulleted")}`],
      ["ol", `1. ${t("Make it numbered")}`],
      ["task", `☑ ${t("Make it a task list")}`],
    ];
    for (const [k, label] of types) {
      if (k !== kind) {
        items.push({ label, run: () => retypeListBlock(block, k) });
      }
    }
    items.push({ label: `⌫ ${t("Remove the list")}`, run: () => retypeListBlock(block, null) });
  }

  // A quote is unfolded back into normal paragraphs.
  if (block.tagName === "BLOCKQUOTE") {
    items.push({
      label: `⌫ ${t("Remove the quote")}`,
      run: () => {
        const { start, end } = rangeOf(block);
        host.replaceLines(
          start,
          end,
          fromQuote(docLines().slice(start, end), host.indentOfLine(start)),
        );
      },
    });
  }

  return items;
}

/**
 * Operations on the block as an object — moves and the clipboard. They are
 * gathered under the expander named after the block: unlike changing the type,
 * these are service actions, and keeping them open in every section of the menu
 * would be noise.
 */
function blockManageItems(block: HTMLElement): QuickItem[] {
  const items: QuickItem[] = [];
  const siblings = movableSiblings(block);
  const at = siblings.indexOf(block);
  if (at > 0) {
    items.push({ label: `↑ ${t("Move up")}`, run: () => moveBlockByStep(block, -1) });
  }
  if (at >= 0 && at < siblings.length - 1) {
    items.push({ label: `↓ ${t("Move down")}`, run: () => moveBlockByStep(block, 1) });
  }
  items.push({ label: `⧉ ${t("Copy")}`, run: () => copyBlock(block) });
  items.push({ label: `✂ ${t("Cut")}`, run: () => cutBlock(block) });
  items.push({ label: `📋 ${t("Paste after")}`, run: () => void pasteBlockAfter(block) });
  // The source is available for any block without exception: whatever the editor is able to draw,
  // the Markdown text can always be fixed by hand.
  items.push({ label: `✎ ${t("Markdown source")}`, run: () => openBlockSource(block) });
  items.push({ label: `🗑 ${t("Delete block")}`, run: () => deleteBlockAction(block) });
  return items;
}

/** The block's Markdown without the container's service indent. */
function blockSourceText(block: HTMLElement): string {
  if (!block.hasAttribute("data-src-line")) {
    return "";
  }
  const { start, end } = rangeOf(block);
  return dedentLines(docLines().slice(start, end)).lines.join("\n");
}

/**
 * The block the Cut/Copy SHORTCUTS act on. The handle already answers “which
 * block is current” — it follows the caret and the clicked islands. Only the
 * text of a code fence and a tab label BEING RENAMED keep the keys for
 * themselves. A label at rest must not: clicking a tab is how one picks the tab
 * set, and there the shortcut has to cut the set.
 */
function shortcutBlock(): HTMLElement | null {
  const sel = document.getSelection();
  const node = sel && sel.rangeCount > 0 ? sel.anchorNode : null;
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  if (el && host.docEl.contains(el) && el.closest('pre, label[contenteditable="true"]')) {
    return null;
  }
  if (handleFor && handleFor.isConnected) {
    return handleFor;
  }
  return el && host.docEl.contains(el) ? handleBlockOf(node) : null;
}

/**
 * Cmd+C with nothing selected copies the CURRENT block. The browser itself
 * does nothing with a collapsed caret, so no behaviour is taken away. Returns
 * whether a block answered — the caller keeps the key otherwise.
 */
export function copyCurrentBlock(): boolean {
  const block = shortcutBlock();
  if (!block || !block.hasAttribute("data-src-line")) {
    return false;
  }
  copyBlock(block);
  return true;
}

/** Cmd+X with nothing selected cuts the CURRENT block (see copyCurrentBlock). */
export function cutCurrentBlock(): boolean {
  const block = shortcutBlock();
  if (!block || !block.hasAttribute("data-src-line")) {
    return false;
  }
  cutBlock(block);
  return true;
}

function copyBlock(block: HTMLElement): void {
  const text = blockSourceText(block);
  if (!text) {
    st.set(t("The block is not saved yet — nothing to copy"));
    return;
  }
  writeBlockClipboard(text, block.outerHTML);
  st.set(t("Block copied"));
}

function cutBlock(block: HTMLElement): void {
  if (!blockSourceText(block)) {
    return;
  }
  copyBlock(block);
  deleteBlockAction(block);
  st.set(t("Block cut"));
}

/** Inserts the clipboard content as a new block right after the current one. */
async function pasteBlockAfter(block: HTMLElement): Promise<void> {
  const text = await readBlockClipboard();
  if (!text.trim()) {
    st.set(t("The clipboard is empty"));
    return;
  }
  if (!block.hasAttribute("data-src-line")) {
    return;
  }
  const { start, end } = rangeOf(block);
  // The indent is taken from the block itself — the paste stays at its nesting level.
  const body = dedentLines(text.replace(/\n+$/, "").split("\n")).lines.join("\n");
  hideHandle();
  document.getSelection()?.removeAllRanges();
  host.insertMarkdownBlock(body, { line: end, indent: host.indentOfLine(start) });
}

/**
 * The block menu: one section per level — the block itself, then the containers around
 * it (a call-out, a tab, a quote). Everything is expanded at once: reaching the container's
 * actions requires no navigation, and the admonition type picker sits right
 * in its section instead of behind another click.
 */
function renderBlockMenu(pop: HTMLElement, block: HTMLElement): void {
  pop.classList.add("block-menu");
  for (const el of [block, ...blockAncestors(block)]) {
    renderBlockSection(pop, el);
  }
}

function renderBlockSection(pop: HTMLElement, el: HTMLElement): void {
  const name = blockTypeName(el);
  const hasTypeControls = el.classList.contains("admonition");
  const items = blockMenuItems(el);

  // A header of its own only when something stands above the expander — the
  // call-out's types, a code block's settings. Otherwise the expander is the
  // header, and the section does not say its own name twice in a row.
  if (hasTypeControls || items.length > 0) {
    const head = document.createElement("div");
    head.className = "vmenu-sec";
    head.textContent = name;
    pop.appendChild(head);
  }
  if (hasTypeControls) {
    renderAdmonitionControls(pop, el);
  }
  if (items.length > 0) {
    host.renderQuickMenu(pop, items);
  }

  // Moves and the clipboard, under an expander named after the block it acts
  // on. The menu has one section per level — the block the caret is in and
  // every container around it — and “Delete block” means something very
  // different in each, so each expander says which block is its own.
  const bar = document.createElement("div");
  bar.className = "vmenu";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "vmenu-more";
  const label = document.createElement("span");
  label.className = "grow";
  label.textContent = `⋮ ${name}`;
  const chevron = document.createElement("span");
  chevron.className = "vmenu-more-caret";
  chevron.textContent = "▸";
  toggle.append(label, chevron);
  bar.appendChild(toggle);
  pop.appendChild(bar);

  const sub = document.createElement("div");
  sub.className = "vmenu-sub";
  sub.hidden = true;
  host.renderQuickMenu(sub, blockManageItems(el));
  pop.appendChild(sub);

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation(); // a click on the expander button must not close the menu
    const opening = sub.hidden;
    // One section open at a time. The actions are the same five words for every
    // level — they act on different blocks, but two identical lists on screen
    // at once read as a duplicate, and no label makes that go away.
    closeBlockSections(pop);
    if (opening) {
      sub.hidden = false;
      toggle.classList.add("open");
      chevron.textContent = "▾";
    }
  });
}

/** Collapses every section of the block menu. */
function closeBlockSections(pop: HTMLElement): void {
  for (const sub of Array.from(pop.querySelectorAll<HTMLElement>(".vmenu-sub"))) {
    sub.hidden = true;
  }
  for (const toggle of Array.from(pop.querySelectorAll<HTMLElement>(".vmenu-more"))) {
    toggle.classList.remove("open");
    const caret = toggle.querySelector(".vmenu-more-caret");
    if (caret) {
      caret.textContent = "▸";
    }
  }
}

/**
 * The container blocks around a block — from the nearest to the outermost. Containers without
 * lines of their own in the file (a tab panel, a grid card) are skipped:
 * they have no range of their own, so there is nothing to apply the actions to.
 */
export function blockAncestors(block: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let cur = block.parentElement;
  while (cur && cur !== host.docEl) {
    const own = cur.parentElement === host.docEl || cur.hasAttribute("data-src-line");
    if (own && (isHandleContainer(cur) || cur.parentElement === host.docEl)) {
      chain.push(cur);
    }
    cur = cur.parentElement;
  }
  return chain;
}
