// The view of the page itself: how wide the canvas is, whether the table of
// contents is shown on the right, and which of the toolbar buttons look pressed.
//
// Two of these outlive the editor — the width and the table of contents are
// remembered in the webview's own state, so reopening a page does not undo the
// way the author set it up. The scheme and the palette belong to shared/scheme;
// what stays here is the choice of what to redraw once they change.

import { doc } from "./editorCore";
import { t } from "../shared/i18n";
import { reRenderMermaidTheme } from "../shared/mermaid";
import { effectiveScheme, initScheme, type Scheme } from "../shared/scheme";
import { keepHeaderReadable } from "../shared/siteChrome";

/** The webview's own little store — the only thing the view needs from outside. */
export interface ViewHost {
  getState(): Record<string, unknown> | undefined;
  setState(state: Record<string, unknown>): void;
}

let host: ViewHost;

export function initView(next: ViewHost): void {
  host = next;
}

export function toggleWidth(): void {
  document.body.classList.toggle("vwide");
  syncViewButtons();
  saveViewState();
}

export function toggleToc(): void {
  const on = document.body.classList.toggle("vtoc");
  if (on) {
    refreshToc();
  }
  syncViewButtons();
  saveViewState();
}

// The scheme, the palette and the page background live in shared/scheme.ts; the
// editor only says which buttons to sync and what to redraw once it changes.

/** The manual choice, mirrored here so the view state can store it. */
let themeOverride: Scheme | null = null;

/** Persists the view preferences (width/table of contents) across editor openings. */
function saveViewState(): void {
  const prev = host.getState() ?? {};
  host.setState({
    ...prev,
    vwide: document.body.classList.contains("vwide"),
    vtoc: document.body.classList.contains("vtoc"),
    theme: themeOverride,
  });
}

export function restoreViewState(): void {
  const saved = host.getState();
  if (saved) {
    document.body.classList.toggle("vwide", saved.vwide === true);
    document.body.classList.toggle("vtoc", saved.vtoc === true);
  }
  initScheme(
    {
      afterApply: () => {
        syncViewButtons();
        // Each scheme carries its own header colors — the ink is judged again.
        const head = document.getElementById("vhead");
        if (head) {
          keepHeaderReadable(head);
        }
      },
      onSchemeChange: () => void reRenderMermaidTheme(doc()),
      persist: (override) => {
        themeOverride = override;
        saveViewState();
      },
    },
    saved?.theme as Scheme | null | undefined,
  );
  refreshToc();
}

export function syncViewButtons(): void {
  document
    .getElementById("tbWidth")
    ?.classList.toggle("on", document.body.classList.contains("vwide"));
  document
    .getElementById("tbToc")
    ?.classList.toggle("on", document.body.classList.contains("vtoc"));
  document
    .getElementById("tbSiteHead")
    ?.classList.toggle("on", document.body.classList.contains("vhead"));
  document
    .getElementById("tbSiteNav")
    ?.classList.toggle("on", document.body.classList.contains("vnav"));
  const dark = effectiveScheme() === "slate";
  const themeBtn = document.getElementById("tbTheme");
  if (themeBtn) {
    themeBtn.classList.toggle("on", dark);
    themeBtn.title = dark ? t("Dark theme — switch to light") : t("Light theme — switch to dark");
  }
}

/** A heading ↔ its item in the table of contents (for highlighting while scrolling). */
interface TocEntry {
  head: HTMLElement;
  item: HTMLElement;
}
let tocEntries: TocEntry[] = [];
let tocActive: HTMLElement | null = null;

/** Rebuilds the table of contents from the document's headings (if the panel is visible). */
export function refreshToc(): void {
  const toc = document.getElementById("vtoc");
  if (!toc || !document.body.classList.contains("vtoc")) {
    return;
  }
  toc.textContent = "";
  tocEntries = [];
  tocActive = null;
  const heads = Array.from(doc().querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
  if (heads.length === 0) {
    const empty = document.createElement("div");
    empty.className = "vtoc-empty";
    empty.textContent = t("No headings");
    toc.appendChild(empty);
    return;
  }
  const head = document.createElement("div");
  head.className = "vtoc-head";
  head.textContent = t("On this page");
  toc.appendChild(head);
  for (const h of heads) {
    const lvl = Number(h.tagName[1]);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `vtoc-item vtoc-l${lvl}`;
    item.textContent = (h.textContent ?? "").trim() || t("(untitled)");
    item.addEventListener("click", () => {
      h.scrollIntoView({ behavior: "smooth", block: "start" });
      setTocActive(item);
    });
    toc.appendChild(item);
    tocEntries.push({ head: h, item });
  }
  updateTocActive();
}

/**
 * Highlighting of the section currently on screen — as in Material: the active one is
 * the last heading that went above the “reading line” under the toolbar. A threshold, not
 * the top of the window: otherwise a heading would count as passed before it even slid
 * under the toolbar, and the highlighting would run half a line ahead of the reading.
 */
const TOC_READ_LINE = 96;

function updateTocActive(): void {
  if (tocEntries.length === 0 || !document.body.classList.contains("vtoc")) {
    return;
  }
  let idx = 0;
  for (let i = 0; i < tocEntries.length; i++) {
    if (tocEntries[i].head.getBoundingClientRect().top <= TOC_READ_LINE) {
      idx = i;
    } else {
      break;
    }
  }
  // Scrolled to the bottom: the last section can be shorter than the screen and never
  // reach the line — at the end of the page it is exactly the active one.
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  setTocActive(tocEntries[atBottom ? tocEntries.length - 1 : idx].item);
}

function setTocActive(item: HTMLElement): void {
  if (item === tocActive) {
    return;
  }
  tocActive?.classList.remove("on");
  item.classList.add("on");
  tocActive = item;
  // A long table of contents scrolls with its own scrollbar — keep the active item
  // in view (inside the panel only, without moving the page).
  const toc = document.getElementById("vtoc");
  if (!toc) {
    return;
  }
  const ir = item.getBoundingClientRect();
  const tr = toc.getBoundingClientRect();
  if (ir.top < tr.top + 8) {
    toc.scrollTop -= tr.top + 8 - ir.top;
  } else if (ir.bottom > tr.bottom - 8) {
    toc.scrollTop += ir.bottom - (tr.bottom - 8);
  }
}

// Page scrolling: the table of contents highlighting is recomputed once per frame.
let tocRaf = 0;
window.addEventListener("scroll", () => {
  if (tocRaf) {
    return;
  }
  tocRaf = requestAnimationFrame(() => {
    tocRaf = 0;
    updateTocActive();
  });
});
