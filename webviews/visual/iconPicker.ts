// The icon and emoji picker (the “Icons, Emojis” item of the insert menu).
//
// The icon index (sets → file names) is generated at build time into
// assets/icons/index.json. The shortcode is `${set}-${name}`, the file is
// `${set}/${name}.svg`. What lands in the document is an inline span with
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
  /** Base address of the icon assets (cfg.iconsBase). */
  iconsBase: string;
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

const ICON_SETS: Array<{ key: string; label: string }> = [
  { key: "emoji", label: t("Emoji") },
  { key: "material", label: "Material" },
  { key: "fontawesome", label: "Font Awesome" },
  { key: "octicons", label: "Octicons" },
  { key: "simple", label: t("Brands") },
];
const ICON_GRID_CAP = 180;

function iconIndexUrl(): string {
  const base = host.iconsBase ?? "";
  return base.replace(/\/svg\/?$/, "") + "/index.json";
}

function loadIconIndex(): Promise<IconIndex> {
  if (iconIndex) {
    return Promise.resolve(iconIndex);
  }
  if (!iconIndexPromise) {
    iconIndexPromise = fetch(iconIndexUrl())
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((idx) => (iconIndex = idx as IconIndex))
      .catch(() => (iconIndex = {}));
  }
  return iconIndexPromise;
}

/** The URL of an icon's svg file from its full shortcode (`material-star` → …/material/star.svg). */
function iconAssetUrl(shortcode: string): string {
  const base = host.iconsBase ?? "";
  const dash = shortcode.indexOf("-");
  if (!base || dash < 0) {
    return "";
  }
  return `${base}/${shortcode.slice(0, dash)}/${shortcode.slice(dash + 1)}.svg`;
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
  const render = (): void =>
    renderIconGrid(grid, note, activeSet, search.value.trim().toLowerCase());

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

  render(); // emoji are available immediately
  void loadIconIndex().then(() => {
    if (activeSet !== "emoji") {
      render();
    }
  });
  setTimeout(() => search.focus(), 0);
}

function renderIconGrid(grid: HTMLElement, note: HTMLElement, set: string, query: string): void {
  grid.textContent = "";
  let items: Array<{ code: string; char?: string }>;
  if (set === "emoji") {
    items = Object.keys(EMOJI)
      .filter((n) => !query || n.includes(query))
      .map((n) => ({ code: n, char: EMOJI[n] }));
  } else {
    const names = iconIndex?.[set] ?? [];
    items = names.filter((n) => !query || n.includes(query)).map((n) => ({ code: `${set}-${n}` }));
  }
  const total = items.length;
  for (const it of items.slice(0, ICON_GRID_CAP)) {
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
      const url = iconAssetUrl(it.code);
      ico.style.webkitMaskImage = `url("${url}")`;
      ico.style.maskImage = `url("${url}")`;
      b.appendChild(ico);
    }
    b.addEventListener("mousedown", (e) => e.preventDefault()); // do not lose the selection
    b.addEventListener("click", () => {
      insertIcon(it.code, it.char);
      closePopup();
    });
    grid.appendChild(b);
  }
  if (set !== "emoji" && !iconIndex) {
    note.textContent = t("Loading icons…");
  } else if (total === 0) {
    note.textContent = t("Nothing found");
  } else if (total > ICON_GRID_CAP) {
    note.textContent = t("Showing the first {0} of {1} — refine the search", ICON_GRID_CAP, total);
  } else {
    note.textContent = `${total}`;
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
    // Replacing: the old glyph and its mask go away, the attrs of the author
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
    // The “live” glyph is an svg mask driven by currentColor; the service class viemoji-live
    // is filtered out in the serializer, so only `:shortcode:` goes into the Markdown.
    span.classList.add("twemoji", "viemoji-live");
    const url = iconAssetUrl(shortcode);
    span.style.webkitMaskImage = `url("${url}")`;
    span.style.maskImage = `url("${url}")`;
  }
  if (target) {
    host.markDirty(span);
    return;
  }
  host.restoreSelection();
  host.insertInline(span);
}
