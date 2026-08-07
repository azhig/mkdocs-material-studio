// Inline formatting: the bubble menu and the operations it runs.
//
// The bubble is a floating bar above the selected text, shown for a non-empty
// selection inside the editable area (never inside a code or formula island).
// It repeats the frequent inline actions of the top toolbar, within reach of
// the text being edited.
//
// The operations underneath it are here for a reason that shows in the file:
// bold and italic are the browser's own execCommand, but underline is not.
// `execCommand("underline")` produces `<u>`, which Markdown cannot express, so
// it would vanish on the next save; what Material means by underline is
// `^^text^^`, an `<ins>`. The same goes for inline code and for the highlight
// colours — each has one spelling that survives the round trip, and each is
// applied by editing the DOM rather than by asking the browser.

import { clearRangePiece } from "./inlineFormat";
import { dirty } from "./editorCore";
import { closePopup, hasActivePopup, showPopup } from "./popups";
import { refreshHotkeyLabels } from "./keyBindings";
import { t } from "../shared/i18n";

/** What inline formatting needs from the editor around it. */
export interface InlineToolsHost {
  /** The document root: the bubble never leaves it. */
  readonly docEl: HTMLElement;
  /** The browser's own formatting command (bold, italic, strikethrough). */
  cmd(name: string, value?: string): void;
  /** The link form — the one bubble button that opens something bigger. */
  openLinkPopup(): void;
  /** The nearest ancestor with the given tag name, inside the document. */
  enclosingTag(node: Node | null, tagName: string): HTMLElement | null;
  /** The outermost block a node belongs to — the one that gets re-serialized. */
  topBlockOf(node: Node | null): Element | null;
  /** Marks the block under the selection as changed. */
  markDirtyAtSelection(): void;
  /** Whether the bubble is wanted at all: the user can turn it off. */
  bubbleEnabled(): boolean;
}

let host: InlineToolsHost;

export function initInlineTools(next: InlineToolsHost): void {
  host = next;
}

/** Whether the bubble exists right now — it is only rebuilt when needed. */
export function bubbleShown(): boolean {
  return bubbleMenu !== null;
}

let bubbleMenu: HTMLElement | null = null;

/** The node's nearest editable host; null if the node is inside an “island” (ce=false). */
function editableHostOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  const editable = el?.closest<HTMLElement>("[contenteditable]");
  if (!editable || editable.getAttribute("contenteditable") === "false") {
    return null;
  }
  return host.docEl.contains(editable) ? editable : null;
}

export function hideBubbleMenu(): void {
  bubbleMenu?.remove();
  bubbleMenu = null;
}

export function updateBubbleMenu(): void {
  if (!host.bubbleEnabled()) {
    hideBubbleMenu();
    return;
  }
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || hasActivePopup()) {
    hideBubbleMenu();
    return;
  }
  if (
    !editableHostOf(sel.anchorNode) ||
    !editableHostOf(sel.focusNode) ||
    sel.toString().trim() === ""
  ) {
    hideBubbleMenu();
    return;
  }
  const anchorEl =
    sel.anchorNode instanceof Element ? sel.anchorNode : (sel.anchorNode?.parentElement ?? null);
  if (anchorEl?.closest("pre, .vcode, .arithmatex")) {
    hideBubbleMenu(); // the selection is inside code/a formula — formatting is not applicable
    return;
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    hideBubbleMenu();
    return;
  }
  const menu = bubbleMenu ?? createBubbleMenu();
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 34;
  const left = Math.max(
    8,
    Math.min(rect.left + rect.width / 2 - mw / 2, window.innerWidth - mw - 8),
  );
  const top = rect.top - mh - 8 < 8 ? rect.bottom + 8 : rect.top - mh - 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  syncBubbleState();
}

function createBubbleMenu(): HTMLElement {
  const menu = document.createElement("div");
  menu.className = "vbubble";
  const btn = (
    html: string,
    tip: string,
    fn: (e: Event) => void,
    cmdName?: string,
    command?: string, // the command id in the registry — the shortcut badge is set from it
  ): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = html;
    b.setAttribute("data-tip", tip);
    if (command) {
      b.setAttribute("data-key-command", command);
    }
    if (cmdName) {
      b.dataset.cmd = cmdName;
    }
    b.addEventListener("mousedown", (e) => e.preventDefault()); // do not lose the selection
    b.addEventListener("click", (e) => {
      e.preventDefault();
      fn(e);
    });
    menu.appendChild(b);
  };
  btn(
    `<b>${t("B")}</b>`,
    t("Bold"),
    () => {
      host.cmd("bold");
      syncBubbleState();
    },
    "bold",
    "format.bold",
  );
  btn(
    `<i>${t("I")}</i>`,
    t("Italic"),
    () => {
      host.cmd("italic");
      syncBubbleState();
    },
    "italic",
    "format.italic",
  );
  btn(
    `<u>${t("U")}</u>`,
    t("Underline"),
    () => {
      toggleUnderline();
      hideBubbleMenu();
    },
    undefined,
    "format.underline",
  );
  btn(
    `<s>${t("S")}</s>`,
    t("Strikethrough"),
    () => {
      host.cmd("strikeThrough");
      syncBubbleState();
    },
    "strikeThrough",
    "format.strike",
  );
  btn(
    '<span class="codicon codicon-code"></span>',
    t("Code"),
    () => toggleInlineCode(),
    undefined,
    "format.code",
  );
  btn("==", t("Highlight"), () => {
    hideBubbleMenu();
    openMarkPalette();
  });
  btn(
    '<span class="codicon codicon-link"></span>',
    t("Link"),
    () => {
      hideBubbleMenu();
      host.openLinkPopup();
    },
    undefined,
    "format.link",
  );
  btn(
    '<span class="codicon codicon-clear-all"></span>',
    t("Clear formatting"),
    () => {
      clearFormatting();
      hideBubbleMenu();
    },
    undefined,
    "format.clear",
  );
  refreshHotkeyLabels();
  document.body.appendChild(menu);
  bubbleMenu = menu;
  return menu;
}

function syncBubbleState(): void {
  if (!bubbleMenu) {
    return;
  }
  for (const b of Array.from(bubbleMenu.querySelectorAll<HTMLButtonElement>("button[data-cmd]"))) {
    let on = false;
    try {
      on = document.queryCommandState(b.dataset.cmd ?? "");
    } catch {
      on = false;
    }
    b.classList.toggle("on", on);
  }
}

/** Inline code: wrap the selection in <code> or unwrap it. */
export function toggleInlineCode(): void {
  toggleInlineTag("CODE");
}

/**
 * Underline. In Markdown this is `^^text^^` (pymdownx.caret → <ins>), so
 * we insert exactly <ins> and not the browser's <u> from execCommand("underline"):
 * <u> cannot be expressed in Markdown and would silently vanish during serialization.
 */
export function toggleUnderline(): void {
  toggleInlineTag("INS");
}

function toggleInlineTag(tagName: string): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return;
  }
  const range = sel.getRangeAt(0);
  // The element may be around the selection — the caret in the middle of an
  // underlined word — or inside it, when the whole paragraph was selected and
  // the button pressed again. Both mean “take this formatting off”.
  const enclosing = host.enclosingTag(range.commonAncestorContainer, tagName);
  const covered = enclosing || range.collapsed ? [] : taggedWithin(range, tagName);
  if (enclosing || covered.length > 0) {
    for (const el of enclosing ? [enclosing] : covered) {
      unwrapElement(el);
    }
    host.markDirtyAtSelection();
    return;
  }
  if (range.collapsed) {
    return;
  }
  const el = document.createElement(tagName.toLowerCase());
  try {
    range.surroundContents(el);
  } catch {
    // The selection crosses element boundaries — the simplified path.
    const text = range.toString();
    range.deleteContents();
    el.textContent = text;
    range.insertNode(el);
  }
  sel.removeAllRanges();
  const after = document.createRange();
  after.setStartAfter(el);
  after.collapse(true);
  sel.addRange(after);
  host.markDirtyAtSelection();
}

/** The elements of this kind that the selection reaches — it wraps them, rather than sitting inside one. */
function taggedWithin(range: Range, tagName: string): HTMLElement[] {
  const common = range.commonAncestorContainer;
  const root = common instanceof Element ? common : common.parentElement;
  if (!root) {
    return [];
  }
  return Array.from(root.querySelectorAll<HTMLElement>(tagName.toLowerCase())).filter((el) =>
    range.intersectsNode(el),
  );
}

/** Replaces an element with its own children — the formatting goes, the text stays. */
function unwrapElement(el: Element): void {
  const parent = el.parentNode;
  while (el.firstChild) {
    parent?.insertBefore(el.firstChild, el);
  }
  el.remove();
}

// The highlighter color palette: the hl-* class is serialized as ==text=={ .hl-… }.
// The user defines the real colors in docs/stylesheets/extra.css; here these are
// approximate swatches for clarity in the editor and the preview.
const HL_COLORS: Array<{ key: string; label: string; css: string }> = [
  { key: "", label: t("Default (theme accent)"), css: "var(--md-accent-fg-color, #ffec3d)" },
  { key: "hl-yellow", label: t("Yellow"), css: "#fff3a0" },
  { key: "hl-green", label: t("Green"), css: "#c3f0c8" },
  { key: "hl-blue", label: t("Blue"), css: "#bfe3ff" },
  { key: "hl-pink", label: t("Pink"), css: "#ffc9de" },
  { key: "hl-orange", label: t("Orange"), css: "#ffd8a8" },
  { key: "hl-purple", label: t("Purple"), css: "#e0c8ff" },
];

export function openMarkPalette(): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    // With no selection, toggle the default highlight (as before).
    toggleInlineTag("MARK");
    return;
  }
  const saved = sel.getRangeAt(0).cloneRange();
  // The palette is placed next to the selected text (not next to the anchor button) — near what
  // is being colored; equally convenient from the top toolbar and from the bubble menu.
  const rect = saved.getBoundingClientRect();
  const pop = showPopup(rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
  pop.className = "vpop mark-palette";

  for (const c of HL_COLORS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.title = c.label;
    b.style.background = c.css;
    b.addEventListener("click", () => {
      applyMark(saved, c.key);
      closePopup();
    });
    pop.appendChild(b);
  }

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "swatch clear";
  clear.title = t("Remove highlight");
  clear.textContent = "✕";
  clear.addEventListener("click", () => {
    restoreRange(saved);
    // The highlight may be around the selection or inside it — selecting the
    // whole coloured phrase is the obvious way to ask for the colour off.
    const enclosing = host.enclosingTag(saved.commonAncestorContainer, "MARK");
    const marks = enclosing ? [enclosing] : taggedWithin(saved, "MARK");
    for (const mark of marks) {
      unwrapElement(mark);
    }
    if (marks.length > 0) {
      host.markDirtyAtSelection();
    }
    closePopup();
  });
  pop.appendChild(clear);
}

export function restoreRange(range: Range): void {
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Splits the selection by blocks: every affected paragraph/item gets its own
 * range within its boundaries. A selection spanning several items cannot be wrapped
 * in a single element, but block by block it can be, without breaking the list structure.
 */
function rangePerBlock(range: Range): Range[] {
  const leaves = Array.from(
    host.docEl.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, td, th"),
  ).filter(
    (el) =>
      range.intersectsNode(el) &&
      el.querySelector("p, li, h1, h2, h3, h4, h5, h6, td, th") === null &&
      !el.closest(".vgctl, .isl-tools"),
  );
  if (leaves.length === 0) {
    return [range.cloneRange()];
  }
  const parts: Range[] = [];
  for (const leaf of leaves) {
    const piece = document.createRange();
    piece.selectNodeContents(leaf);
    if (range.compareBoundaryPoints(Range.START_TO_START, piece) > 0) {
      piece.setStart(range.startContainer, range.startOffset);
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, piece) < 0) {
      piece.setEnd(range.endContainer, range.endOffset);
    }
    if (!piece.collapsed && piece.toString().trim() !== "") {
      parts.push(piece);
    }
  }
  return parts;
}

/**
 * The colored highlighter. The selection can cross several blocks (list items,
 * paragraphs) — then EVERY text piece is wrapped separately. The previous version
 * tried to wrap the whole range in a single <mark> and, on failure, replaced it with
 * flat text: the list items stuck together into a single paragraph.
 */
function applyMark(range: Range, colorKey: string): void {
  restoreRange(range);
  const paint = (el: HTMLElement): void => {
    const keep = Array.from(el.classList).filter((c) => !c.startsWith("hl-") && c !== "critic");
    el.className = keep.join(" ");
    if (colorKey) {
      el.classList.add(colorKey);
    }
  };

  const inside = host.enclosingTag(range.commonAncestorContainer, "MARK");
  if (inside) {
    paint(inside as HTMLElement); // the selection is inside an existing mark — just repaint it
    host.markDirtyAtSelection();
    return;
  }

  const parts = rangePerBlock(range);
  if (parts.length === 0) {
    return;
  }
  const marks: HTMLElement[] = [];
  // From the end: wrapping changes the DOM, and the boundaries of the pieces not yet processed must
  // stay valid.
  for (const piece of [...parts].reverse()) {
    const frag = piece.extractContents();
    // A mark inside a mark cannot be expressed in Markdown — unwrap the nested ones.
    for (const inner of Array.from(frag.querySelectorAll("mark"))) {
      while (inner.firstChild) {
        inner.parentNode?.insertBefore(inner.firstChild, inner);
      }
      inner.remove();
    }
    const mark = document.createElement("mark");
    mark.appendChild(frag);
    piece.insertNode(mark);
    marks.push(mark);
  }
  for (const mark of marks) {
    paint(mark);
    // The selection could have spanned several blocks — each one has to be synchronized.
    const block = host.topBlockOf(mark);
    if (block) {
      dirty.add(block);
    }
  }
  // Restore the selection onto the marked-up text (the first and the last piece).
  const first = marks[marks.length - 1];
  const last = marks[0];
  if (first && last) {
    const sel = document.getSelection();
    const back = document.createRange();
    back.setStartBefore(first);
    back.setEndAfter(last);
    sel?.removeAllRanges();
    sel?.addRange(back);
  }
  host.markDirtyAtSelection();
}

// --- Clearing formatting ----------------------------------------------------

/**
 * “Clear formatting”: removes bold, italic, underline,
 * strikethrough, code and highlighting from the selection (or from the whole block under the caret),
 * leaving the text, links and images. It works block by block — a selection spanning
 * several list items does not collapse them into a single paragraph.
 */
export function clearFormatting(): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return;
  }
  let range = sel.getRangeAt(0);
  const anchor =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  if (!anchor || !host.docEl.contains(anchor) || anchor.closest("pre, .vcode, .arithmatex")) {
    return; // code and formulas do not count as formatting
  }
  if (range.collapsed) {
    // With no selection, the whole block under the caret is cleared — as in office editors.
    const leaf = anchor.closest<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, td, th");
    if (!leaf) {
      return;
    }
    range = document.createRange();
    range.selectNodeContents(leaf);
  }
  const parts = rangePerBlock(range);
  if (parts.length === 0) {
    return;
  }
  const bounds: Array<{ first: Node; last: Node }> = [];
  // From the end: editing the DOM shifts the boundaries of the pieces not yet processed.
  for (const piece of [...parts].reverse()) {
    const around =
      piece.commonAncestorContainer instanceof Element
        ? piece.commonAncestorContainer
        : piece.commonAncestorContainer.parentElement;
    const block =
      around?.closest<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, td, th") ?? host.docEl;
    const edge = clearRangePiece(piece, block);
    if (edge) {
      bounds.push(edge);
    }
    // The selection could have spanned several blocks — each one has to be synchronized.
    const top = host.topBlockOf(block);
    if (top) {
      dirty.add(top);
    }
  }
  const from = bounds[bounds.length - 1];
  const to = bounds[0];
  if (from && to) {
    const back = document.createRange();
    back.setStartBefore(from.first);
    back.setEndAfter(to.last);
    sel.removeAllRanges();
    sel.addRange(back);
  }
  host.markDirtyAtSelection();
}
