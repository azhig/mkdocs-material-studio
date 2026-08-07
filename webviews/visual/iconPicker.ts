// The icon and emoji picker (the “Icons, Emojis” item of the insert menu).
//
// The 14 342 icons of mkdocs-material live in one pack next to the extension
// (see src/core/iconPack.ts), so the picker asks for them instead of loading
// files: the names of a set arrive once, the SVGs a screenful at a time as the
// grid is scrolled. What lands in the document is an inline span with
// data-emoji=":shortcode:" — the serializer writes `:shortcode:`, and the host
// render turns it into the canonical glyph.
//
// The picker knows nothing about the editor: the operations it needs — where to
// anchor the popup, how to insert an inline node, how to mark a block changed —
// are handed to it once, at startup.

import { EMOJI } from "../../src/preview/mdPlugins/materialIcons";
import { t } from "../shared/i18n";
import { closePopup, onPopupClose, showPopup } from "./popups";

export interface IconPickerHost {
  /** The names of every icon set — asked for once, on first open. */
  iconNames: () => Promise<Record<string, string[]>>;
  /** The SVG of each of these shortcodes; missing ones are simply absent. */
  iconSvgs: (codes: string[]) => Promise<Record<string, string>>;
  /** Where to open the popup when nothing was clicked. */
  anchor: () => HTMLElement;
  /** Puts a node at the caret. */
  insertInline: (el: HTMLElement) => void;
  /** Marks the block holding the node as changed. */
  markDirty: (node: Node) => void;
  saveSelection: () => void;
  restoreSelection: () => void;
}

let host: IconPickerHost;

export function initIconPicker(next: IconPickerHost): void {
  host = next;
  // Closing the popup without a choice leaves the icon that was clicked alone.
  onPopupClose(() => {
    iconPickTarget = null;
  });
}

type IconIndex = Record<string, string[]>;
let iconIndex: IconIndex | null = null;
let iconIndexPromise: Promise<IconIndex> | null = null;
/** SVGs already fetched, by shortcode — a grid scrolled twice asks once. */
const svgCache = new Map<string, string>();

const ICON_SETS: Array<{ key: string; label: string }> = [
  { key: "emoji", label: t("Emoji") },
  { key: "material", label: "Material" },
  { key: "fontawesome", label: "Font Awesome" },
  { key: "octicons", label: "Octicons" },
  { key: "simple", label: t("Brands") },
];

/**
 * How many cells are added at a time. The whole set is reachable — the grid
 * appends the next page as it is scrolled — but building 7 447 buttons at once
 * would freeze the popup on open.
 */
const ICON_PAGE = 120;

/** How close to the bottom of the grid the next page starts loading. */
const NEAR_BOTTOM = 240;

/** Fetches the names of the sets once; the grid reads them from here. */
export function loadIconNames(): Promise<IconIndex> {
  if (iconIndex) {
    return Promise.resolve(iconIndex);
  }
  iconIndexPromise ??= host
    .iconNames()
    .then((idx) => (iconIndex = idx))
    .catch(() => (iconIndex = {}));
  return iconIndexPromise;
}

/**
 * The icon and emoji picker. With an element passed in it replaces that icon
 * (a click on an icon in the document); without one it inserts at the cursor.
 */
export function openIconPicker(existing?: HTMLElement): void {
  if (!existing) {
    host.saveSelection();
  }
  const anchor = existing ?? host.anchor();
  const rect = anchor.getBoundingClientRect();
  const pop = showPopup(
    Math.max(8, rect.right + window.scrollX - 372),
    rect.bottom + window.scrollY + 6,
  );
  // After showPopup: it closes the previous popup, and that resets the target.
  iconPickTarget = existing ?? null;
  pop.className = "vpop icon-picker";

  const search = document.createElement("input");
  search.type = "text";
  search.className = "ip-search";
  search.placeholder = t("Search an icon or emoji…");
  pop.appendChild(search);

  const tabs = document.createElement("div");
  tabs.className = "ip-tabs";
  pop.appendChild(tabs);

  const grid = document.createElement("div");
  grid.className = "ip-grid";
  pop.appendChild(grid);

  const note = document.createElement("div");
  note.className = "ip-note";
  pop.appendChild(note);

  let activeSet = "emoji";
  const view = createGridView(grid, note);
  const render = (): void => view.show(activeSet, search.value.trim().toLowerCase());

  for (const s of ICON_SETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ip-tab" + (s.key === activeSet ? " on" : "");
    b.textContent = s.label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      activeSet = s.key;
      for (const el of Array.from(tabs.children)) {
        el.classList.toggle("on", el === b);
      }
      render();
    });
    tabs.appendChild(b);
  }

  let deb: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(render, 110);
  });
  grid.addEventListener("scroll", () => view.onScroll());

  render(); // emoji are available immediately
  void loadIconNames().then(() => {
    if (activeSet !== "emoji") {
      render();
    }
  });
  setTimeout(() => search.focus(), 0);
}

interface GridItem {
  code: string;
  char?: string;
}

/** The scrolling grid: it holds the current list and appends pages of it. */
export interface GridView {
  /** Starts over with this set and query. */
  show(set: string, query: string): void;
  /** Called on scroll — adds the next page when the bottom is near. */
  onScroll(): void;
  /** How many cells are on screen right now (for the tests). */
  shown(): number;
}

export function createGridView(grid: HTMLElement, note: HTMLElement): GridView {
  let items: GridItem[] = [];
  let shown = 0;
  let set = "";

  const appendPage = (): void => {
    const page = items.slice(shown, shown + ICON_PAGE);
    if (page.length === 0) {
      return;
    }
    const cells: Array<{ code: string; el: HTMLElement }> = [];
    for (const it of page) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ip-cell";
      b.title = ":" + it.code + ":";
      if (it.char !== undefined) {
        b.classList.add("ip-emoji");
        b.textContent = it.char;
      } else {
        const ico = document.createElement("span");
        ico.className = "ip-ico";
        b.appendChild(ico);
        cells.push({ code: it.code, el: ico });
      }
      b.addEventListener("mousedown", (e) => e.preventDefault()); // do not lose the selection
      b.addEventListener("click", () => {
        insertIcon(it.code, it.char);
        closePopup();
      });
      grid.appendChild(b);
    }
    shown += page.length;
    void paintIcons(cells);
    note.textContent = `${shown} / ${items.length}`;
  };

  return {
    show(nextSet, query) {
      set = nextSet;
      grid.textContent = "";
      shown = 0;
      grid.scrollTop = 0;
      if (set === "emoji") {
        items = Object.keys(EMOJI)
          .filter((n) => !query || n.includes(query))
          .map((n) => ({ code: n, char: EMOJI[n] }));
      } else {
        items = (iconIndex?.[set] ?? [])
          .filter((n) => !query || n.includes(query))
          .map((n) => ({ code: `${set}-${n}` }));
      }
      if (set !== "emoji" && !iconIndex) {
        note.textContent = t("Loading icons…");
        return;
      }
      if (items.length === 0) {
        note.textContent = t("Nothing found");
        return;
      }
      appendPage();
    },
    onScroll() {
      if (
        shown < items.length &&
        grid.scrollTop + grid.clientHeight + NEAR_BOTTOM >= grid.scrollHeight
      ) {
        appendPage();
      }
    },
    shown: () => shown,
  };
}

/** Fills the cells of a page with their SVGs — one request for the whole page. */
async function paintIcons(cells: Array<{ code: string; el: HTMLElement }>): Promise<void> {
  const missing = cells.filter((c) => !svgCache.has(c.code)).map((c) => c.code);
  if (missing.length > 0) {
    const svgs = await host.iconSvgs(missing);
    for (const [code, svg] of Object.entries(svgs)) {
      svgCache.set(code, svg);
    }
  }
  for (const cell of cells) {
    const svg = svgCache.get(cell.code);
    if (svg !== undefined && cell.el.isConnected) {
      cell.el.innerHTML = svg;
    }
  }
}

/** The icon being replaced by the picker (null — the picker inserts a new one). */
let iconPickTarget: HTMLElement | null = null;

/** Inserts an icon/emoji inline: a span with data-emoji (→ `:shortcode:` in Markdown). */
function insertIcon(shortcode: string, char?: string): void {
  const target = iconPickTarget;
  iconPickTarget = null;
  const span = target ?? document.createElement("span");
  if (target) {
    // Replacing: the old glyph goes away, the attrs of the author
    // (`{ .heart }`, a title) stay on the element.
    span.textContent = "";
    span.classList.remove("twemoji", "viemoji-live");
    span.style.webkitMaskImage = "";
    span.style.maskImage = "";
  }
  span.setAttribute("data-emoji", `:${shortcode}:`);
  if (char !== undefined) {
    span.textContent = char;
  } else {
    // What goes in is the same SVG the render would draw — the picker already
    // has it from the grid. The class marks it as ours for the serializer,
    // which writes `:shortcode:` and nothing else.
    span.classList.add("twemoji", "viemoji-live");
    span.innerHTML = svgCache.get(shortcode) ?? "";
  }
  if (target) {
    host.markDirty(span);
    return;
  }
  host.restoreSelection();
  host.insertInline(span);
}
