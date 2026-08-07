// Content tabs and card grids, managed in place.
//
// Both are Material components whose DOM is several parallel structures that
// are easy to get out of sync — a tab set is a radio button, a label and a
// content block per tab; a grid is a list inside a `<div class="grid cards">`.
// So neither is edited in the DOM: every operation rewrites the lines of the
// file and waits for the render to come back. That is also why each of them
// ends with a “put the caret in the tab/card that was just added” step keyed on
// a line number rather than on an element.

import { docLines, rangeOf, requestFullRender, setAfterSync, st } from "./editorCore";
import {
  parseTabs as mdParseTabs,
  addTab as mdAddTab,
  removeTab as mdRemoveTab,
  renameTab as mdRenameTab,
  moveTab as mdMoveTab,
  parseCards as mdParseCards,
  addCard as mdAddCard,
  removeCard as mdRemoveCard,
  moveCard as mdMoveCard,
} from "./blockOps";
import { t } from "../shared/i18n";

/** What tab and card operations need from the editor around them. */
export interface TabsGridsHost {
  /** The editable document. */
  readonly docEl: HTMLElement;
  /** The indent of a line of the file, so a new tab lines up with its set. */
  indentOfLine(line: number): string;
  /** The nearest ancestor that owns a range of lines. */
  rangedAncestor(el: Element | null): HTMLElement | null;
  /** Replaces a range of lines, optionally leaving the caret on one of them. */
  replaceLines(start: number, end: number, lines: string[], caretLine?: number): void;
  /** Puts the caret into a block, focusing the editable host around it. */
  caretIntoBlock(block: HTMLElement): void;
}

let host: TabsGridsHost;

export function initTabsGrids(next: TabsGridsHost): void {
  host = next;
}

interface TabSetParts {
  inputs: HTMLInputElement[];
  labels: HTMLElement[];
  content: HTMLElement | null;
  blocks: HTMLElement[];
  setId: string;
}

/** Splits a tab set into radio buttons, labels and content blocks. */
function tabSetParts(set: HTMLElement): TabSetParts {
  const inputs = Array.from(set.querySelectorAll<HTMLInputElement>(':scope > input[type="radio"]'));
  const labels = Array.from(set.querySelectorAll<HTMLElement>(":scope > .tabbed-labels > label"));
  const content = set.querySelector<HTMLElement>(":scope > .tabbed-content");
  const blocks = Array.from(content?.querySelectorAll<HTMLElement>(":scope > .tabbed-block") ?? []);
  // setId — from the radio name (__tabbed_{setId}) or from data-tabs="{setId}:{count}".
  const name = inputs[0]?.name ?? "";
  const setId =
    name.replace(/^__tabbed_/, "") || (set.getAttribute("data-tabs") ?? "").split(":")[0] || "1";
  return { inputs, labels, content, blocks, setId };
}

/**
 * The source lines of a tab set. Tab operations are markdown-first: in the DOM
 * a set is three parallel structures (input + label + content block) that are
 * easy to get out of sync, while in the text they are just `=== "…"` lines.
 */
function tabsTarget(set: HTMLElement): {
  start: number;
  end: number;
  indent: string;
  lines: string[];
} | null {
  const ranged = host.rangedAncestor(set);
  if (!ranged) {
    return null;
  }
  const { start, end } = rangeOf(ranged);
  return { start, end, indent: host.indentOfLine(start), lines: docLines().slice(start, end) };
}

/** Cursor into the body of tab number idx of the set that starts at the given line. */
function focusTabAt(startLine: number, idx: number): void {
  const set = host.docEl.querySelector<HTMLElement>(`.tabbed-set[data-src-line="${startLine}"]`);
  const blocks = set?.querySelectorAll<HTMLElement>(":scope > .tabbed-content > .tabbed-block");
  const input = set?.querySelectorAll<HTMLInputElement>(':scope > input[type="radio"]')[idx];
  if (input) {
    input.checked = true;
  }
  const block = blocks?.[idx];
  if (block) {
    host.caretIntoBlock(block);
  }
}

/** Adds a new tab at the end of the set and makes it active. */
function addTab(set: HTMLElement): void {
  const tgt = tabsTarget(set);
  if (!tgt) {
    return;
  }
  const count = mdParseTabs(tgt.lines, tgt.indent).length;
  requestFullRender();
  host.replaceLines(tgt.start, tgt.end, mdAddTab(tgt.lines, t("Tab {0}", count + 1), tgt.indent));
  setAfterSync(() => focusTabAt(tgt.start, count));
  st.set(t("Tab added — type the content; double-click the label to rename it"));
}

/** Deletes a tab by its label (the last one cannot be deleted — that is “Delete block”). */
function deleteTabEl(set: HTMLElement, label: HTMLElement): void {
  const idx = tabSetParts(set).labels.indexOf(label);
  const tgt = tabsTarget(set);
  if (idx < 0 || !tgt) {
    return;
  }
  const next = mdRemoveTab(tgt.lines, idx, tgt.indent);
  if (next === tgt.lines) {
    st.set(t("The last tab cannot be deleted — delete the whole block"));
    return;
  }
  requestFullRender();
  host.replaceLines(tgt.start, tgt.end, next);
  setAfterSync(() => focusTabAt(tgt.start, Math.max(0, idx - 1)));
  st.set(t("Tab deleted"));
}

/** Renaming a label (double-click → edit → blur). */
export function renameTabEl(set: HTMLElement, label: HTMLElement, title: string): void {
  const idx = tabSetParts(set).labels.indexOf(label);
  const tgt = tabsTarget(set);
  if (idx < 0 || !tgt) {
    return;
  }
  const clean = title.replace(/\s+/g, " ").trim() || t("Tab {0}", idx + 1);
  requestFullRender();
  host.replaceLines(tgt.start, tgt.end, mdRenameTab(tgt.lines, idx, clean, tgt.indent));
  setAfterSync(() => focusTabAt(tgt.start, idx));
}

/** Moves a tab from position fromIdx to toIdx. */
function moveTab(set: HTMLElement, fromIdx: number, toIdx: number): void {
  const tgt = tabsTarget(set);
  if (!tgt || fromIdx === toIdx || fromIdx < 0 || toIdx < 0) {
    return;
  }
  requestFullRender();
  host.replaceLines(tgt.start, tgt.end, mdMoveTab(tgt.lines, fromIdx, toIdx, tgt.indent));
  setAfterSync(() => focusTabAt(tgt.start, toIdx));
  st.set(t("Tab order changed"));
}

/** The label being dragged right now — a drop target compares itself to it. */
let dragTabLabel: HTMLElement | null = null;

/** Makes a label draggable for reordering (except while renaming). */
function wireTabLabelDrag(set: HTMLElement, label: HTMLElement): void {
  label.draggable = true;
  label.addEventListener("dragstart", (e) => {
    if (label.getAttribute("contenteditable") === "true") {
      e.preventDefault(); // a rename is in progress — do not drag
      return;
    }
    dragTabLabel = label;
    label.classList.add("vtab-drag");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    }
  });
  label.addEventListener("dragend", () => {
    dragTabLabel = null;
    label.classList.remove("vtab-drag");
  });
  label.addEventListener("dragover", (e) => {
    if (
      !dragTabLabel ||
      dragTabLabel === label ||
      dragTabLabel.parentElement !== label.parentElement
    ) {
      return;
    }
    e.preventDefault();
  });
  label.addEventListener("drop", (e) => {
    if (
      !dragTabLabel ||
      dragTabLabel === label ||
      dragTabLabel.parentElement !== label.parentElement
    ) {
      return;
    }
    e.preventDefault();
    const all = tabSetParts(set).labels;
    moveTab(set, all.indexOf(dragTabLabel), all.indexOf(label));
    dragTabLabel = null;
  });
}

/**
 * The editor's inline controls on the label row: “+” at the end (add a tab) and
 * “×” on every label (delete that specific one). The buttons are
 * contenteditable=false and are not part of the serialization (× is stripped by
 * tabLabelTitle, + is not a <label>).
 * Idempotent: on repeated decoration the already placed buttons are not duplicated.
 */
export function wireTabControls(set: HTMLElement): void {
  const labelsBox = set.querySelector<HTMLElement>(":scope > .tabbed-labels");
  if (!labelsBox) {
    return;
  }
  for (const label of Array.from(labelsBox.querySelectorAll<HTMLElement>(":scope > label"))) {
    if (label.querySelector(":scope > .vtab-x")) {
      continue;
    }
    wireTabLabelDrag(set, label);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "vtab-x";
    x.setAttribute("contenteditable", "false");
    x.textContent = "×";
    x.title = t("Delete tab");
    // mousedown must not blur/select — otherwise the click would activate the radio / label editing.
    x.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    x.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteTabEl(set, label);
    });
    x.addEventListener("dblclick", (e) => {
      e.stopPropagation(); // do not start renaming the label
    });
    label.appendChild(x);
  }
  if (!labelsBox.querySelector(":scope > .vtab-add")) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "vtab-add";
    add.setAttribute("contenteditable", "false");
    add.textContent = "+";
    add.title = t("Add tab");
    add.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    add.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      addTab(set);
    });
    labelsBox.appendChild(add);
  }
}

// ---------------------------------------------------------------------------
// Card grids (grid cards): inline card management
// ---------------------------------------------------------------------------
//
// A Material grid card is an <li> inside the single <ul> of the
// `<div class="grid cards" markdown>` container. The grid stays freely editable
// (the text is edited inline), while the set of cards is managed right in place:
//   • “×” on a card (on hover) — delete that specific one (at least one remains);
//   • the “⠿” handle — drag to change the order;
//   • “+ Card” below the grid — add a new one.
// The service buttons are marked with the `.vgctl` class (contenteditable=false)
// and do not make it into the serialization (see isServiceElement in htmlToMd).

/** The grid's list of cards — the direct <li> elements of its first <ul>. */
function gridCards(grid: HTMLElement): HTMLElement[] {
  const ul = grid.querySelector<HTMLElement>(":scope > ul");
  return ul ? Array.from(ul.querySelectorAll<HTMLElement>(":scope > li")) : [];
}

// Dragging a card to change the order.
let dragCard: HTMLElement | null = null;

/** Moves card fromLi to the place of toLi (after it — if dragging downwards). */
/** The source lines of the grid block (card operations are markdown-first). */
function gridTarget(grid: HTMLElement): {
  start: number;
  end: number;
  indent: string;
  lines: string[];
} | null {
  const ranged = host.rangedAncestor(grid);
  if (!ranged) {
    return null;
  }
  const { start, end } = rangeOf(ranged);
  // Cards are list items inside the block: their level is one indent deeper than the tag.
  const body = docLines().slice(start, end);
  const item = body.find((l) => /^\s*[-*+]\s/.test(l));
  const indent = item ? (/^\s*/.exec(item)?.[0] ?? "") : host.indentOfLine(start);
  return { start, end, indent, lines: body };
}

/** Cursor into the title of card idx of the grid that starts at the given line. */
function focusCardAt(startLine: number, idx: number): void {
  const grid = host.docEl.querySelector<HTMLElement>(`.grid[data-src-line="${startLine}"]`);
  const card = grid ? gridCards(grid)[idx] : undefined;
  if (card) {
    host.caretIntoBlock(card);
  }
}

function moveCard(grid: HTMLElement, fromLi: HTMLElement, toLi: HTMLElement): void {
  const cards = gridCards(grid);
  const from = cards.indexOf(fromLi);
  const to = cards.indexOf(toLi);
  const tgt = gridTarget(grid);
  if (!tgt || from < 0 || to < 0 || from === to) {
    return;
  }
  requestFullRender();
  host.replaceLines(tgt.start, tgt.end, mdMoveCard(tgt.lines, from, to, tgt.indent));
  setAfterSync(() => focusCardAt(tgt.start, to));
  st.set(t("Card order changed"));
}

/** Adds a card at the end of the grid and puts the cursor into its title. */
function addCard(grid: HTMLElement): void {
  const tgt = gridTarget(grid);
  if (!tgt) {
    return;
  }
  const num = mdParseCards(tgt.lines, tgt.indent).length + 1;
  requestFullRender();
  host.replaceLines(
    tgt.start,
    tgt.end,
    mdAddCard(tgt.lines, `**${t("Card {0}", num)}**`, tgt.indent),
  );
  setAfterSync(() => focusCardAt(tgt.start, num - 1));
  st.set(t("Card added — type the title and the content"));
}

/** Deletes a card (the last one cannot be deleted — that is “Delete block”). */
function deleteCard(grid: HTMLElement, li: HTMLElement): void {
  const idx = gridCards(grid).indexOf(li);
  const tgt = gridTarget(grid);
  if (idx < 0 || !tgt) {
    return;
  }
  const next = mdRemoveCard(tgt.lines, idx, tgt.indent);
  if (next === tgt.lines) {
    st.set(t("The last card cannot be deleted — delete the whole block"));
    return;
  }
  requestFullRender();
  host.replaceLines(tgt.start, tgt.end, next);
  setAfterSync(() => focusCardAt(tgt.start, Math.max(0, idx - 1)));
  st.set(t("Card deleted"));
}

/** Makes a card draggable (via the handle) for reordering. */
function wireCardDrag(grid: HTMLElement, li: HTMLElement, grip: HTMLElement): void {
  grip.addEventListener("dragstart", (e) => {
    dragCard = li;
    li.classList.add("vcard-drag");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    }
  });
  grip.addEventListener("dragend", () => {
    dragCard = null;
    li.classList.remove("vcard-drag");
  });
  li.addEventListener("dragover", (e) => {
    if (!dragCard || dragCard === li || dragCard.parentElement !== li.parentElement) {
      return;
    }
    e.preventDefault();
  });
  li.addEventListener("drop", (e) => {
    if (!dragCard || dragCard === li || dragCard.parentElement !== li.parentElement) {
      return;
    }
    e.preventDefault();
    moveCard(grid, dragCard, li);
    dragCard = null;
  });
}

/**
 * Attaches the inline controls to the grid cards: the “⠿” handle and “×” on
 * every card, “+ Card” below the grid. Idempotent (repeated decoration does not
 * duplicate the buttons). The buttons are .vgctl and never reach the Markdown.
 */
export function wireGridControls(grid: HTMLElement): void {
  const ul = grid.querySelector<HTMLElement>(":scope > ul");
  if (!ul) {
    return;
  }
  for (const li of Array.from(ul.querySelectorAll<HTMLElement>(":scope > li"))) {
    if (li.querySelector(":scope > .vcard-x")) {
      continue; // already equipped
    }
    const grip = document.createElement("span");
    grip.className = "vgctl vcard-grip";
    grip.setAttribute("contenteditable", "false");
    grip.setAttribute("draggable", "true");
    grip.textContent = "⠿";
    grip.title = t("Drag to change the order");
    grip.addEventListener("mousedown", (e) => e.stopPropagation());

    const x = document.createElement("button");
    x.type = "button";
    x.className = "vgctl vcard-x";
    x.setAttribute("contenteditable", "false");
    x.textContent = "×";
    x.title = t("Delete card");
    // mousedown must not steal the selection/focus — otherwise the click would land in the text.
    x.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    x.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteCard(grid, li);
    });

    li.prepend(grip);
    li.appendChild(x);
    wireCardDrag(grid, li, grip);
  }
  if (!grid.querySelector(":scope > .vcard-add")) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "vgctl vcard-add";
    add.setAttribute("contenteditable", "false");
    add.textContent = `+ ${t("Card")}`;
    add.title = t("Add card");
    add.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    add.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      addCard(grid);
    });
    grid.appendChild(add);
  }
}
