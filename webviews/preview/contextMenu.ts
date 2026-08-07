// The read-only context menu of the preview.
//
// A webview gets VS Code's stock context menu — Cut, Copy, Paste — no matter
// whether anything on the page is editable. In a page that is only read, Cut
// and Paste are dead weight that suggests the page can be edited. The stock
// menu cannot be trimmed from the extension side, only suppressed wholesale,
// so the preview suppresses it and shows a single-entry menu of its own:
// Copy, and only when there is a selection to copy.

import { t } from "../shared/i18n";

/** What the menu needs from the page around it. */
export interface ContextMenuHost {
  /** Copies the current selection to the clipboard. */
  copySelection(): void;
}

let menu: HTMLElement | null = null;

function closeMenu(): void {
  menu?.remove();
  menu = null;
}

function openMenu(x: number, y: number, host: ContextMenuHost): void {
  const box = document.createElement("div");
  box.className = "mv-ctx";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = t("Copy");
  // mousedown would close the menu (see the document listener) before click fires.
  copy.addEventListener("mousedown", (e) => e.stopPropagation());
  copy.addEventListener("click", () => {
    closeMenu();
    host.copySelection();
  });
  box.appendChild(copy);
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  document.body.appendChild(box);
  // Opened against the window's right or bottom edge, the menu flips inwards.
  const r = box.getBoundingClientRect();
  if (r.right > window.innerWidth - 4) {
    box.style.left = `${Math.max(4, x - r.width)}px`;
  }
  if (r.bottom > window.innerHeight - 4) {
    box.style.top = `${Math.max(4, y - r.height)}px`;
  }
  menu = box;
}

export function initReadOnlyMenu(host: ContextMenuHost): void {
  document.addEventListener("contextmenu", (e) => {
    // Suppressing the default is what removes the stock Cut/Copy/Paste menu.
    e.preventDefault();
    closeMenu();
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed) {
      return;
    }
    openMenu(e.clientX, e.clientY, host);
  });
  document.addEventListener("mousedown", (e) => {
    if (menu && !menu.contains(e.target as Node)) {
      closeMenu();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
    }
  });
  window.addEventListener("scroll", closeMenu, true);
}
