// The component palette and the slash menu.
//
// One list of Material components serves three places: the “+ Insert” palette,
// the buttons pinned to the toolbar, and the quick menu that “/” opens in an
// empty paragraph. They share the list so that a component added in one shows
// up in the others without a second registration.
//
// Insertion is by the caret's indent rather than by hunting for a container: a
// block typed inside an admonition or a content tab nests into it, to any
// depth — see insertPoint().

import { t } from "../shared/i18n";
import { addAnnotation } from "./annotations";
import { inSubEditor } from "./annotationSubEditor";
import {
  openAdmonitionInsert,
  openButtonInsert,
  openCodeInsert,
  openGridInsert,
  openSnippetInsert,
  openTableGrid,
  openTabsInsert,
  tableMarkdown,
  type InsertPoint,
} from "./blockInserts";
import { docEndsNL, docLines, rangeOf, requestFullRender, sendSync } from "./editorCore";
import { openIconPicker } from "./iconPicker";
import { openFootnotePopup, openKeysPopup, openTooltipPopup } from "./inlineElements";
import { hotKeyTextOf, refreshHotkeyLabels } from "./keyBindings";
import { openImagePopup, openMathPopup } from "./mediaLinks";
import { openMermaidInsert } from "./mermaidDialog";
import { applyList, applyStyle } from "./paragraphStyle";
import { closePopup, showPopup, type QuickItem } from "./popups";
import { insertHr } from "./selectionOps";

/** What the palette needs from the editor around it. */
export interface ComponentMenuHost {
  /** The editable document. */
  readonly docEl: HTMLElement;
  /** Sends a message to the extension. */
  post(msg: unknown): void;
  /** The top-level block the caret is in. */
  currentBlock(): Element | null;
  /** Where the icon files are served from inside the webview. */
  iconsBase(): string;
  /** Components the author pinned to the toolbar — not repeated in the menu. */
  pinnedButtons(): string[];
}

let host: ComponentMenuHost;

export function initComponentMenu(next: ComponentMenuHost): void {
  host = next;
}

// ---------------------------------------------------------------------------

/**
 * The Material components (the “+Block” palette) — entries from the Material Reference,
 * each with a real Material icon. A click inserts a ready template for a new block
 * (via insertMarkdownBlock/serialization).
 */
// The anchor for the insert popups (the table size grid and so on). It is placed at the
// click position — on the “Insert” menu item or on a pinned toolbar button.
let insertAnchor: HTMLElement | null = null;
export function insertPopupAnchor(): HTMLElement {
  return insertAnchor ?? (document.getElementById("tbComponent") as HTMLElement);
}

// The order defines the look of both the “+ Insert” menu and the settings list: first the four
// components from DEFAULT_PINNED (in the same order as on the toolbar), then
// the rest in descending order of how often they are used in the Material documentation.
//
// Quick insert is ⌘⌥<letter> / Ctrl+Alt+<letter>: our “Alt” branch is occupied
// by digits only (the paragraph styles), while the letters in it are almost free in
// VS Code itself too. The mnemonic follows the English component name; “Content tabs”
// gets ⇧ because T is already taken by the table. Letters taken by the system or by the
// VS Code menus (I — DevTools, H — Hide Others on macOS) are not used.
export function componentInsertItems(): QuickItem[] {
  return [
    {
      id: "table",
      label: "Data tables",
      hint: t("table (pick the size)"),
      icon: "table-edit",
      key: { alt: true, key: "T" },
      run: () => openTableGrid(insertPopupAnchor()),
    },
    {
      id: "image",
      label: "Images",
      hint: t("image (file or URL)"),
      icon: "image-outline",
      key: { alt: true, key: "P" },
      run: () => openImagePopup(),
    },
    {
      id: "code",
      label: "Code blocks",
      hint: t("language + numbers + title"),
      icon: "code-braces",
      key: { alt: true, key: "C" },
      run: () => openCodeInsert(),
    },
    {
      id: "hr",
      label: t("Divider"),
      hint: t("horizontal rule"),
      icon: "minus",
      key: { alt: true, key: "D" },
      run: () => insertHr(),
    },
    {
      id: "admonition",
      label: "Admonitions",
      hint: t("call-out block"),
      icon: "alert-outline",
      key: { alt: true, key: "A" },
      run: () => openAdmonitionInsert(),
    },
    {
      id: "tabs",
      label: "Content tabs",
      hint: t("tabs (list of names)"),
      icon: "tab",
      key: { alt: true, shift: true, key: "T" },
      run: () => openTabsInsert(),
    },
    {
      id: "icon",
      label: "Icons, Emojis",
      hint: t("pick an icon or emoji"),
      icon: "emoticon-happy-outline",
      key: { alt: true, key: "E" },
      run: () => openIconPicker(),
    },
    {
      id: "grid",
      label: "Grids",
      hint: t("card grid (titles)"),
      icon: "view-grid-plus-outline",
      key: { alt: true, key: "G" },
      run: () => openGridInsert(),
    },
    {
      id: "diagram",
      label: "Diagrams",
      hint: t("Mermaid diagram"),
      icon: "graph-outline",
      key: { alt: true, key: "M" },
      run: () => openMermaidInsert(),
    },
    {
      id: "button",
      label: "Buttons",
      hint: t("button (text + link)"),
      icon: "cursor-default-click-outline",
      key: { alt: true, key: "B" },
      run: () => openButtonInsert(),
    },
    {
      id: "annotation",
      label: "Annotations",
      hint: t("a (1) hint at the cursor"),
      icon: "plus-circle-outline",
      key: { alt: true, key: "N" },
      run: () => addAnnotation(),
    },
    {
      id: "footnote",
      label: "Footnotes",
      hint: t("footnote"),
      icon: "format-vertical-align-bottom",
      key: { alt: true, key: "F" },
      run: () => openFootnotePopup(),
    },
    {
      id: "tooltip",
      label: "Tooltips",
      hint: t("tooltip"),
      icon: "tooltip-plus-outline",
      key: { alt: true, key: "K" },
      run: () => openTooltipPopup(),
    },
    {
      id: "math",
      label: "Math",
      hint: t("LaTeX formula"),
      icon: "function-variant",
      key: { alt: true, key: "Q" },
      run: () => openMathPopup(),
    },
    {
      id: "keys",
      label: "Keyboard keys",
      hint: t("record a key combination"),
      icon: "keyboard-outline",
      run: () => openKeysPopup(),
    },
    {
      id: "snippet",
      label: "Snippets",
      hint: t("include another file"),
      icon: "file-document-multiple-outline",
      run: () => openSnippetInsert(),
    },
  ];
}

/**
 * Inserting a component from the keyboard: the insert popups (the table grid, the code form)
 * are anchored to the component's pinned button, or to “+ Insert” if it lives in the menu.
 */
export function runComponent(item: QuickItem): void {
  const pin = item.id
    ? document.querySelector<HTMLElement>(`#vtPinned [data-comp="${item.id}"]`)
    : null;
  insertAnchor = pin ?? (document.getElementById("tbComponent") as HTMLElement);
  item.run();
}

/** An insert component by id (for the pinned toolbar buttons). */
function componentById(id: string): QuickItem | undefined {
  return componentInsertItems().find((it) => it.id === id);
}

/** A Material icon for a button (inline SVG from the cache, otherwise a CSS mask plus warm-up). */
export function componentIconEl(icon: string | undefined): HTMLElement {
  const ico = document.createElement("span");
  ico.className = "vmenu-ico";
  const cached = icon ? iconSvgCache.get(icon) : undefined;
  if (cached) {
    ico.innerHTML = cached;
  } else if (icon) {
    const url = materialMaskUrl(icon);
    if (url) {
      ico.classList.add("is-mask");
      ico.style.webkitMaskImage = url;
      ico.style.maskImage = url;
    }
    loadMaterialIcon(icon);
  }
  return ico;
}

/** Redraws the component quick buttons pinned to the toolbar. */
export function renderPinnedButtons(): void {
  const box = document.getElementById("vtPinned");
  if (!box) {
    return;
  }
  box.textContent = "";
  for (const id of host.pinnedButtons()) {
    const item = componentById(id);
    if (!item) {
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vt-pin";
    b.setAttribute("data-tip", item.label);
    b.setAttribute("data-key-command", `insert.${id}`);
    b.dataset.comp = id;
    b.appendChild(componentIconEl(item.icon));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      insertAnchor = b; // the insert popups (the table grid) go under this button
      item.run();
    });
    box.appendChild(b);
  }
  refreshHotkeyLabels();
}

/** The URL of a Material icon (MDI) in the assets — for CSS mask-image (colored by currentColor). */
function materialMaskUrl(name: string): string {
  const base = host.iconsBase();
  return base ? `url("${base}/material/${name}.svg")` : "";
}

/**
 * A cache of the inline markup of Material icons (MDI). Menu icons are inserted into the DOM DIRECTLY,
 * rather than through CSS `mask-image: url(...)`: for a menu that is recreated on every opening,
 * the external mask resource occasionally fails to load in time, and the icon disappears.
 * Inline SVG is colored by `currentColor` (fill in CSS) — theme-adaptive, with no loading race.
 */
const iconSvgCache = new Map<string, string>();
const iconSvgPending = new Set<string>();

/** Loads an SVG icon once and puts its markup into the cache (fire-and-forget). */
function loadMaterialIcon(name: string): void {
  const base = host.iconsBase();
  if (!base || !name || iconSvgCache.has(name) || iconSvgPending.has(name)) {
    return;
  }
  iconSvgPending.add(name);
  fetch(`${base}/material/${name}.svg`)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((svg) => {
      if (/^\s*<svg[\s>]/.test(svg)) {
        iconSvgCache.set(name, svg.trim());
      }
    })
    .catch(() => {
      /* keep the fallback mask — worse, but not empty */
    })
    .finally(() => iconSvgPending.delete(name));
}

/** Preloads the icons of the “Insert” palette so that by the time the menu opens they are
 *  already inline (with no mask-resource race). */
export function prefetchComponentIcons(): void {
  for (const it of componentInsertItems()) {
    if (it.icon) {
      loadMaterialIcon(it.icon);
    }
  }
}

function quickInsertItems(): QuickItem[] {
  const mdInsert =
    (template: string): (() => void) =>
    () =>
      insertMarkdownBlock(template);
  return [
    { label: t("Heading 1"), run: () => applyStyle("h1") },
    { label: t("Heading 2"), run: () => applyStyle("h2") },
    { label: t("Heading 3"), run: () => applyStyle("h3") },
    { label: t("Bulleted list"), run: () => applyList("ul") },
    { label: t("Numbered list"), run: () => applyList("ol") },
    { label: t("Task list"), run: () => applyList("task") },
    { label: t("Quote"), run: () => applyStyle("blockquote") },
    { label: t("Table 3×2"), run: () => insertMarkdownBlock(tableMarkdown(2, 3), insertPoint()) },
    { label: t("Divider"), run: () => insertHr() },
    { label: t("Code block"), run: mdInsert("```python\n# " + t("code") + "\n```") },
    {
      label: t("Note (admonition)"),
      run: mdInsert(`!!! note "${t("Note")}"\n    ${t("Note text.")}`),
    },
    { label: t("Tip (tip)"), run: mdInsert(`!!! tip "${t("Tip")}"\n    ${t("Tip text.")}`) },
    {
      label: t("Warning (warning)"),
      run: mdInsert(`!!! warning "${t("Warning")}"\n    ${t("Text.")}`),
    },
    {
      label: t("Collapsible block"),
      run: mdInsert(`??? info "${t("Details")}"\n    ${t("Hidden text.")}`),
    },
    {
      label: t("Tabs"),
      run: mdInsert(
        `=== "${t("Tab {0}", 1)}"\n\n    ${t("Content {0}", 1)}\n\n=== "${t("Tab {0}", 2)}"\n\n    ${t("Content {0}", 2)}`,
      ),
    },
    { label: t("Mermaid diagram"), run: () => openMermaidInsert() },
    { label: t("Formula (block)"), run: mdInsert("$$\nE = mc^2\n$$") },
    { label: t("Other components…"), hint: t("forms"), run: () => requestComponentPanel() },
  ];
}

/** Inserts a markdown template as a new block after the current one (through the extension). */
/** The anchor line for inserting a new block (the end of the current/previous known block). */
function insertBlockAnchor(): number {
  const block = host.currentBlock();
  if (!block) {
    return docLines().length;
  }
  if (block.hasAttribute("data-src-line")) {
    return rangeOf(block).end;
  }
  // A draft: the anchor is the end of the previous known block.
  let prev = block.previousElementSibling;
  while (prev && !prev.hasAttribute("data-src-line")) {
    prev = prev.previousElementSibling;
  }
  return prev ? rangeOf(prev).end : 0;
}

/** The insertion point of a new block: the line in the source plus the indent (for nesting). */
/**
 * Where to insert a new block is decided by the CURSOR position. The block the cursor is in is
 * taken, and the new block is inserted right after it with THE SAME indent as that
 * line has in the source. The indent of the line under the cursor IS the nesting level:
 * `    Text.` inside an admonition → indent 4, `        vcb` inside a tab → 8, and
 * so on. No searching for a “suitable container” — simply the cursor's indent.
 */
export function insertPoint(): InsertPoint {
  const sel = document.getSelection();
  const node = sel && sel.rangeCount > 0 ? sel.anchorNode : null;
  const caretEl = node instanceof Element ? node : (node?.parentElement ?? null);
  let block: Element | null = caretEl;
  while (block && block !== host.docEl && !block.hasAttribute("data-src-line")) {
    block = block.parentElement;
  }
  // An empty tab body: it has no content line in the source, so the cursor's block
  // “rose” up to the tab set itself. For such a tab the line and the indent are
  // computed from its `=== ` marker (otherwise the block would go to the set's level — “lower”).
  const tabBody = caretEl?.closest<HTMLElement>(".tabbed-block");
  if (tabBody && (!(block instanceof HTMLElement) || !tabBody.contains(block))) {
    const tp = emptyTabInsertPoint(tabBody);
    if (tp) {
      return tp;
    }
  }
  if (!(block instanceof HTMLElement) || !block.hasAttribute("data-src-end")) {
    // No cursor / a draft without a range — use the common anchor, at the top level.
    return { line: insertBlockAnchor(), indent: "" };
  }
  const srcLine = docLines()[Number(block.getAttribute("data-src-line"))] ?? "";
  let indent = srcLine.match(/^ */)?.[0] ?? "";
  // A list item: the item's content sits on the marker line (`- …` / `1. …`), so its
  // indent is the MARKER's level. A block nested into the item has to be shifted by another +4
  // (python-markdown's tab length) — otherwise it would land at the marker's level and break the
  // list. (If the cursor is already in a sub-paragraph of the item, its line is not a marker, the indent is already
  // at the content level, and +4 is not added.)
  if (/^ *([-*+]|\d+[.)]) /.test(srcLine)) {
    indent += "    ";
  }
  return { line: Number(block.getAttribute("data-src-end")), indent };
}

/**
 * The insertion point inside the body of a tab that has no content of its own in the
 * source (an empty tab). It finds that tab's `=== ` marker within the set's
 * range, takes the marker's indent + 4 and inserts at the end of the tab's content.
 */
function emptyTabInsertPoint(tabBody: HTMLElement): InsertPoint | null {
  const set = tabBody.closest<HTMLElement>(".tabbed-set");
  if (!set || !set.hasAttribute("data-src-line")) {
    return null;
  }
  const setStart = Number(set.getAttribute("data-src-line"));
  const setEnd = Number(set.getAttribute("data-src-end"));
  const setIndent = (docLines()[setStart] ?? "").match(/^ */)?.[0].length ?? 0;
  // The marker lines of EXACTLY this set (at its indent level, not the nested ones).
  const markers: number[] = [];
  for (let i = setStart; i < setEnd; i++) {
    const m = (docLines()[i] ?? "").match(/^( *)=== /);
    if (m && m[1].length === setIndent) {
      markers.push(i);
    }
  }
  const bodies = Array.from(
    set.querySelectorAll<HTMLElement>(":scope > .tabbed-content > .tabbed-block"),
  );
  const idx = bodies.indexOf(tabBody);
  const markerLine = markers[idx];
  if (idx < 0 || markerLine === undefined) {
    return null;
  }
  const indent = " ".repeat(setIndent + 4);
  // The end of a tab's content = the next marker (or the end of the set).
  return { line: markers[idx + 1] ?? setEnd, indent };
}

export function insertMarkdownBlock(template: string, at?: InsertPoint): void {
  const point = at ?? insertPoint();
  const anchor = point.line;
  // A nested insertion: every non-empty template line is shifted by the body's indent.
  const body = point.indent
    ? template
        .split("\n")
        .map((l) => (l === "" ? "" : point.indent + l))
        .join("\n")
    : template;
  const atEof = anchor >= docLines().length;
  const before = anchor > 0 && (docLines()[anchor - 1] ?? "").trim() !== "";
  const after = !atEof && (docLines()[anchor] ?? "").trim() !== "";
  const text =
    (atEof && !docEndsNL() ? "\n" : "") +
    (before ? "\n" : "") +
    body.replace(/\n+$/, "") +
    "\n" +
    (after ? "\n" : "");
  // A nested insertion (a block inside a block): the new block will appear inside the focus block —
  // request a full render, otherwise applyPatches would keep the old DOM without it.
  if (point.indent) {
    requestFullRender();
  }
  sendSync([{ start: anchor, end: anchor, text }]);
}

function requestComponentPanel(): void {
  if (inSubEditor()) {
    // The wizard panel writes into the file by line numbers — inside an
    // annotation editor those are the note's own, so the quick menu (which
    // edits the current document) serves instead.
    const anchor = document.getElementById("tbComponent") as HTMLElement | null;
    if (anchor) {
      openComponentMenu(anchor);
    }
    return;
  }
  const block = host.currentBlock();
  const line =
    block && block.hasAttribute("data-src-line") ? rangeOf(block).end : docLines().length;
  host.post({ type: "insertAt", line });
}

export function openComponentMenu(anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  // The menu's right edge is aligned to the button — it must not spill outside the window.
  const pop = showPopup(
    Math.max(8, rect.right + window.scrollX - 248),
    rect.bottom + window.scrollY + 4,
  );
  // The components moved to the toolbar (host.pinnedButtons()) are not duplicated in the menu —
  // they are either on the toolbar or here (mutually exclusive, see the settings).
  const items = componentInsertItems().filter(
    (it) => !it.id || !host.pinnedButtons().includes(it.id),
  );
  if (items.length === 0) {
    const note = document.createElement("div");
    note.className = "vmenu-empty";
    note.textContent = t("All components are pinned to the toolbar");
    pop.appendChild(note);
    return;
  }
  renderQuickMenu(pop, items);
}

export function renderQuickMenu(pop: HTMLElement, items: QuickItem[], onPick?: () => void): void {
  const menu = document.createElement("div");
  const withIcons = items.some((it) => it.icon);
  menu.className = withIcons ? "vmenu vmenu-icons" : "vmenu";
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    if (item.icon) {
      // A Material icon, colored by currentColor (theme-adaptive). Inline SVG (from the cache) is
      // preferred — it does not flicker; otherwise there is a fallback to the CSS mask.
      const ico = document.createElement("span");
      ico.className = "vmenu-ico";
      const cached = iconSvgCache.get(item.icon);
      if (cached) {
        ico.innerHTML = cached;
      } else {
        const url = materialMaskUrl(item.icon);
        if (url) {
          ico.classList.add("is-mask");
          ico.style.webkitMaskImage = url;
          ico.style.maskImage = url;
        }
        loadMaterialIcon(item.icon); // load it — from the next opening on it will be inline
      }
      b.appendChild(ico);
      const name = document.createElement("span");
      name.className = "vmenu-name";
      name.textContent = item.label;
      b.appendChild(name);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "vmenu-hint";
        hint.textContent = item.hint;
        b.appendChild(hint);
      }
      const hotkey = item.id ? hotKeyTextOf(`insert.${item.id}`) : "";
      if (hotkey) {
        const kbd = document.createElement("span");
        // Without a hint label the badge aligns itself to the right.
        kbd.className = item.hint ? "vkbd" : "vkbd vkbd-far";
        kbd.textContent = hotkey;
        b.appendChild(kbd);
      }
    } else {
      b.textContent = item.label + (item.hint ? `  (${item.hint})` : "");
    }
    b.addEventListener("click", () => {
      insertAnchor = document.getElementById("tbComponent"); // the insert popups go under “Insert”
      closePopup();
      onPick?.();
      item.run();
    });
    menu.appendChild(b);
  }
  pop.appendChild(menu);
}

/** The slash menu: “/” at the start of an empty paragraph. */
export function maybeOpenSlashMenu(e: KeyboardEvent): boolean {
  if (e.key !== "/") {
    return false;
  }
  const block = host.currentBlock();
  if (!block || block.tagName !== "P" || (block.textContent ?? "").trim() !== "") {
    return false;
  }
  e.preventDefault();
  const rect = (block as HTMLElement).getBoundingClientRect();
  const pop = showPopup(rect.left + window.scrollX, rect.top + window.scrollY + 22);
  renderQuickMenu(pop, quickInsertItems());
  return true;
}
