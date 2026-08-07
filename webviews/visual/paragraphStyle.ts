// Paragraph style and lists: the two drop-down buttons of the toolbar.
//
// Both work the way office editors do: the button label shows the caret's
// current state, the arrow opens the full list with the keyboard shortcuts, the
// active item is highlighted, and picking the active one again removes it — a
// list unfolds into paragraphs, a heading or a quote turns into normal text.
//
// Every one of these operations is markdown-first: the block's lines are taken
// from the file, transformed as text (blockOps) and sent back as a
// replacement. The same thing has several shapes in HTML — a “loose” list item,
// a checkbox inside a label, a nested <ul> — and editing through the DOM kept
// stumbling over the differences.

import {
  fromList,
  fromQuote,
  itemRange,
  renumber,
  retypeList,
  setHeading,
  shiftLines,
  toList,
  toQuote,
  type ListKind,
} from "./blockOps";
import { docLines, rangeOf } from "./editorCore";
import { hotKeyTextOf } from "./keyBindings";
import { closePopup, showPopup } from "./popups";
import { t } from "../shared/i18n";

/** One line of a drop-down: the label, its shortcut badge and its state. */
export interface CommandItem {
  label: string;
  key?: string; // the keyboard shortcut label (badge on the right)
  icon?: string; // a codicon name
  text?: string; // a text glyph (H1, 99…) — when a codicon does not fit
  on?: boolean; // the active item
  disabled?: boolean;
  run: () => void;
}

/** What the style and list operations need from the editor around them. */
export interface ParagraphStyleHost {
  /** The document root: the caret is only followed inside it. */
  readonly docEl: HTMLElement;
  /** The browser's own formatting command — the one path still left to it. */
  cmd(name: string, value?: string): void;
  /** The top-level block the caret is in. */
  currentBlock(): Element | null;
  /** Puts the caret into a block, preparing it if it needs preparing. */
  caretIntoBlock(block: HTMLElement): void;
  /** The nearest ancestor (or the element itself) that owns lines in the file. */
  rangedAncestor(el: Element | null): HTMLElement | null;
  /** The nearest ancestor with the given tag name, inside the document. */
  enclosingTag(node: Node | null, tagName: string): HTMLElement | null;
  /** The indent of a line of the file = the block's nesting level. */
  indentOfLine(line: number): string;
  /** Replaces a range of lines and leaves the caret on one of them. */
  replaceLines(start: number, end: number, lines: string[], caretLine?: number): void;
  /** The “paragraph” blocks the selection touches — the leaves, the ones that
   *  contain no other such block. */
  selectionLines(): HTMLElement[];
  /** The line range those blocks cover, if any. */
  selectionRange(): { start: number; end: number } | null;
}

let host: ParagraphStyleHost;

export function initParagraphStyle(next: ParagraphStyleHost): void {
  host = next;
}

const LIST_ICON: Record<ListKind, string> = {
  ul: "codicon-list-unordered",
  ol: "codicon-list-ordered",
  task: "codicon-tasklist",
};
export const LIST_NAME: Record<ListKind, string> = {
  ul: t("Bulleted list"),
  ol: t("Numbered list"),
  task: t("Task list"),
};

/** The label type when there is no list under the caret (the last one chosen). */
let lastListKind: ListKind = "ul";

/** The list the toolbar button would make: the caret's, or the last one chosen. */
export function toolbarListKind(): ListKind {
  return currentListKind() ?? lastListKind;
}

/** The list item under the caret. */
export function caretListItem(): HTMLElement | null {
  const li = host.enclosingTag(document.getSelection()?.anchorNode ?? null, "LI");
  return li instanceof HTMLElement && host.docEl.contains(li) ? li : null;
}

function listKindOf(li: HTMLElement): ListKind {
  const list = li.parentElement;
  if (
    li.querySelector(
      ":scope > input.task-list-item-checkbox, :scope > label > input.task-list-item-checkbox",
    )
  ) {
    return "task";
  }
  if (list?.classList.contains("contains-task-list")) {
    return "task";
  }
  return list?.tagName === "OL" ? "ol" : "ul";
}

function currentListKind(): ListKind | null {
  const li = caretListItem();
  return li ? listKindOf(li) : null;
}
/**
 * Switching the list type. A markdown-first operation: the block's lines are taken from
 * the file, transformed as text (blockOps) and sent as a replacement — in HTML the same
 * thing is represented in different ways (a “loose” item, a checkbox inside a label, a nested
 * <ul>), and editing through the DOM kept stumbling over these differences.
 */
export function applyList(kind: ListKind): void {
  const li = caretListItem();
  const target = li ? host.rangedAncestor(li.parentElement) : null;
  if (li && target) {
    const { start, end } = rangeOf(target);
    const src = docLines().slice(start, end);
    const base = host.indentOfLine(start);
    const cur = listKindOf(li);
    const out = cur === kind ? fromList(src, base) : renumber(retypeList(src, kind, base));
    host.replaceLines(start, end, out);
  } else {
    const range = host.selectionRange();
    if (!range) {
      return;
    }
    const src = docLines().slice(range.start, range.end);
    host.replaceLines(range.start, range.end, toList(src, kind, host.indentOfLine(range.start)));
  }
  if (currentListKind() !== kind) {
    lastListKind = kind;
  }
  updateBlockButtons();
}

/** Indents an item one level deeper (Tab). */
export function indentItem(li: HTMLElement): void {
  shiftItem(li, true);
}

/** Outdents an item one level up (Shift+Tab). */
export function outdentItem(li: HTMLElement): void {
  shiftItem(li, false);
}

function shiftItem(li: HTMLElement, deeper: boolean): void {
  const target = host.rangedAncestor(li.parentElement);
  const at = Number(li.getAttribute("data-src-line"));
  if (!target || !Number.isFinite(at)) {
    return;
  }
  const { start, end } = rangeOf(target);
  const src = docLines().slice(start, end);
  const item = itemRange(src, at - start);
  const shifted = shiftLines(src.slice(item.start, item.end), deeper);
  const out = renumber([...src.slice(0, item.start), ...shifted, ...src.slice(item.end)]);
  host.replaceLines(start, end, out, at);
}

/** The style of the block under the caret: p | h1…h6 | blockquote. */
export function currentStyleTag(): string {
  const node = document.getSelection()?.anchorNode ?? null;
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  const around = el?.closest<HTMLElement>("h1, h2, h3, h4, h5, h6, blockquote, li, p, td, th");
  if (!around || !host.docEl.contains(around)) {
    return "p";
  }
  const tag = around.tagName;
  if (/^H[1-6]$/.test(tag)) {
    return tag.toLowerCase();
  }
  // The engine wraps quote text in <p> — the paragraph inside a blockquote
  // is treated as a quote too (otherwise the label would show “Normal text”).
  if (tag === "BLOCKQUOTE" || (tag === "P" && around.parentElement?.tagName === "BLOCKQUOTE")) {
    return "blockquote";
  }
  return "p";
}

/**
 * Applies a paragraph style; picking the active one again returns to normal text.
 * Also markdown-first (see applyList): a heading is a “#” prefix, a quote is
 * “> ” on every line, and in text they are unambiguous.
 */
export function applyStyle(tag: string): void {
  const cur = currentStyleTag();
  const next = cur === tag && tag !== "p" ? "p" : tag;
  const level = /^h([1-6])$/.exec(next)?.[1];
  if (cur === "blockquote") {
    const quote = host.rangedAncestor(
      (document.getSelection()?.anchorNode as Element | null)?.parentElement?.closest(
        "blockquote",
      ) ?? null,
    );
    if (!quote) {
      return;
    }
    const { start, end } = rangeOf(quote);
    const base = host.indentOfLine(start);
    const plain = fromQuote(docLines().slice(start, end), base);
    host.replaceLines(start, end, level ? setHeading(plain, Number(level), base) : plain);
    updateBlockButtons();
    return;
  }
  const range = host.selectionRange();
  if (!range) {
    return;
  }
  const src = docLines().slice(range.start, range.end);
  const base = host.indentOfLine(range.start);
  const out =
    next === "blockquote" ? toQuote(src, base) : setHeading(src, level ? Number(level) : 0, base);
  host.replaceLines(range.start, range.end, out);
  updateBlockButtons();
}

export const STYLE_ITEMS: { tag: string; label: string; text: string; key: string }[] = [
  { tag: "p", label: t("Normal text"), text: t("T"), key: "0" },
  { tag: "h1", label: t("Heading 1"), text: "H1", key: "1" },
  { tag: "h2", label: t("Heading 2"), text: "H2", key: "2" },
  { tag: "h3", label: t("Heading 3"), text: "H3", key: "3" },
  { tag: "h4", label: t("Heading 4"), text: "H4", key: "4" },
  { tag: "h5", label: t("Heading 5"), text: "H5", key: "5" },
  { tag: "h6", label: t("Heading 6"), text: "H6", key: "6" },
];

/** The labels of both buttons plus the highlighting of the active state. */
export function updateBlockButtons(): void {
  const kind = currentListKind();
  const group = document.getElementById("vtList");
  const main = document.getElementById("tbList");
  const icon = main?.querySelector<HTMLElement>(".codicon");
  const shown = kind ?? lastListKind;
  if (icon) {
    icon.className = `codicon ${LIST_ICON[shown]}`;
  }
  if (main) {
    main.title = kind ? t("{0} (click to remove)", LIST_NAME[shown]) : LIST_NAME[shown];
  }
  group?.classList.toggle("on", kind !== null);

  const styleTag = currentStyleTag();
  const styleBtn = document.getElementById("tbStyle");
  if (styleBtn) {
    const meta = STYLE_ITEMS.find((s) => s.tag === styleTag);
    const sign = styleBtn.querySelector<HTMLElement>(".vt-style-ico");
    const name = styleBtn.querySelector<HTMLElement>(".vt-style-name");
    if (sign) {
      sign.textContent = styleTag === "blockquote" ? "99" : (meta?.text ?? "T");
    }
    if (name) {
      name.textContent = styleTag === "blockquote" ? t("Quote") : (meta?.label ?? t("Normal text"));
    }
  }
}

export function openListMenu(anchor: HTMLElement): void {
  const kind = currentListKind();
  // Item indentation is Tab/Shift+Tab only: as menu items they were duplicates, and
  // the mouse cannot reach them anyway (the caret has to be inside the item).
  const items: CommandItem[] = [
    {
      label: LIST_NAME.ul,
      icon: LIST_ICON.ul,
      key: hotKeyTextOf("list.ul"),
      on: kind === "ul",
      run: () => applyList("ul"),
    },
    {
      label: LIST_NAME.ol,
      icon: LIST_ICON.ol,
      key: hotKeyTextOf("list.ol"),
      on: kind === "ol",
      run: () => applyList("ol"),
    },
    {
      label: LIST_NAME.task,
      icon: LIST_ICON.task,
      key: hotKeyTextOf("list.task"),
      on: kind === "task",
      run: () => applyList("task"),
    },
  ];
  const rect = anchor.getBoundingClientRect();
  renderCommandMenu(showPopup(rect.left + window.scrollX, rect.bottom + window.scrollY + 4), items);
}

export function openStyleMenu(anchor: HTMLElement): void {
  const cur = currentStyleTag();
  const items: CommandItem[] = STYLE_ITEMS.map((s) => ({
    label: s.label,
    text: s.text,
    key: hotKeyTextOf(`style.${s.tag}`),
    on: cur === s.tag,
    run: () => applyStyle(s.tag),
  }));
  items.push({
    label: t("Quote"),
    text: "99",
    key: hotKeyTextOf("style.quote"),
    on: cur === "blockquote",
    run: () => applyStyle("blockquote"),
  });
  const rect = anchor.getBoundingClientRect();
  renderCommandMenu(showPopup(rect.left + window.scrollX, rect.bottom + window.scrollY + 4), items);
}

/** The command menu: glyph + name + keyboard shortcut badge. */
function renderCommandMenu(pop: HTMLElement, items: CommandItem[]): void {
  const menu = document.createElement("div");
  menu.className = "vmenu vmenu-cmd";
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vmenu-cmd-item";
    b.classList.toggle("on", item.on === true);
    b.disabled = item.disabled === true;
    const sign = document.createElement("span");
    if (item.icon) {
      sign.className = `vmenu-sign codicon ${item.icon}`;
    } else {
      sign.className = "vmenu-sign vmenu-sign-text";
      sign.textContent = item.text ?? "";
    }
    const name = document.createElement("span");
    name.className = "vmenu-name";
    name.textContent = item.label;
    b.append(sign, name);
    if (item.key) {
      const key = document.createElement("span");
      key.className = "vmenu-key";
      key.textContent = item.key;
      b.appendChild(key);
    }
    // The caret in the document has to survive the click — otherwise execCommand has nothing
    // to apply to (the button would take focus away from the contenteditable).
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      closePopup();
      item.run();
    });
    menu.appendChild(b);
  }
  pop.appendChild(menu);
}
