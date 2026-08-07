// Popups: the small floating forms of the editor — a link, a footnote, the
// settings, a picker. One at a time, closed by Escape or by a click outside.
//
// The module owns that “one at a time” rule, so whoever opens a popup with
// state of its own (a picker waiting for a choice, the settings waiting for a
// keystroke) registers a reset through onPopupClose instead of being called by
// name from here.

import { t } from "../shared/i18n";
import { type HotKey } from "./hotkeys";

/**
 * One line of a menu inside a popup. The same shape serves the component
 * palette, the slash menu and the block menu, so the modules that build those
 * lists do not have to know about each other.
 */
export interface QuickItem {
  id?: string; // a stable identifier (for pinning the button to the toolbar)
  label: string;
  hint?: string;
  icon?: string; // the Material icon (MDI) name for the menu with icons
  key?: HotKey; // the quick-insert shortcut (⌘⌥… / Ctrl+Alt+…)
  run: () => void;
}

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------

let activePopup: HTMLElement | null = null;

/** Resets to run when a popup closes — registered by whoever needs one. */
const closeHandlers: Array<() => void> = [];

/** Registers a reset for a popup that keeps state of its own while open. */
export function onPopupClose(fn: () => void): void {
  closeHandlers.push(fn);
}

export function closePopup(): void {
  for (const fn of closeHandlers) {
    fn();
  }
  activePopup?.remove();
  activePopup = null;
}

/** Whether a popup is open: the sync postpones its catch-up patch while one is. */
export function hasActivePopup(): boolean {
  return activePopup !== null;
}

document.addEventListener("mousedown", (e) => {
  if (activePopup && !activePopup.contains(e.target as Node)) {
    closePopup();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activePopup) {
    closePopup();
  }
});

export function showPopup(x: number, y: number): HTMLElement {
  closePopup();
  const pop = document.createElement("div");
  pop.className = "vpop";
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${y}px`;
  document.body.appendChild(pop);
  activePopup = pop;
  // The content is appended by the caller — clamp to the window edge afterwards.
  requestAnimationFrame(() => {
    if (!pop.isConnected) {
      return;
    }
    const maxX = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
    if (parseFloat(pop.style.left) > maxX) {
      pop.style.left = `${Math.max(8, maxX)}px`;
    }
  });
  return pop;
}

export function popupAtSelection(): HTMLElement {
  const sel = document.getSelection();
  let x = 100;
  let y = 100;
  if (sel && sel.rangeCount > 0) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    x = rect.left + window.scrollX;
    y = rect.bottom + window.scrollY + 6;
  }
  return showPopup(x, y);
}

/** A popup right under an element — for editing what was clicked. */
export function popupAtElement(el: Element): HTMLElement {
  const rect = el.getBoundingClientRect();
  return showPopup(rect.left + window.scrollX, rect.bottom + window.scrollY + 6);
}

export function formPopup(
  pop: HTMLElement,
  fields: {
    name: string;
    label: string;
    value?: string;
    placeholder?: string;
    suggest?: () => ComboItem[];
  }[],
  okLabel: string,
  onOk: (values: Record<string, string>) => void,
): void {
  const form = document.createElement("form");
  const inputs = new Map<string, HTMLInputElement>();
  for (const f of fields) {
    const label = document.createElement("label");
    label.textContent = f.label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = f.value ?? "";
    input.placeholder = f.placeholder ?? "";
    label.appendChild(input);
    if (f.suggest) {
      label.classList.add("vcombo");
      attachCombo(input, label, f.suggest);
    }
    form.appendChild(label);
    inputs.set(f.name, input);
  }
  const row = document.createElement("div");
  row.className = "row";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = okLabel;
  row.append(cancel, ok);
  form.appendChild(row);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values: Record<string, string> = {};
    for (const [name, input] of inputs) {
      values[name] = input.value;
    }
    closePopup();
    onOk(values);
  });
  pop.appendChild(form);
  inputs.values().next().value?.focus();
}

// ---------------------------------------------------------------------------
// A filterable drop-down under a text field. NOT the native <datalist>: in a
// webview its drop-down is positioned incorrectly (it drifts to the left of the
// field), so the list is our own, absolutely positioned right under the input.
// ---------------------------------------------------------------------------

export interface ComboItem {
  value: string;
  hint?: string;
}

const COMBO_LIMIT = 40;

export function attachCombo(
  input: HTMLInputElement,
  host: HTMLElement,
  items: () => ComboItem[],
): void {
  input.autocomplete = "off";
  const list = document.createElement("div");
  list.className = "vmenu vcombo-list";
  list.style.display = "none";
  host.appendChild(list);

  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    list.textContent = "";
    const all = items();
    const matches = all
      .filter((it) => it.value.toLowerCase().includes(q) || it.hint?.toLowerCase().includes(q))
      .slice(0, COMBO_LIMIT);
    // Nothing to add when the only match is exactly what has been typed.
    if (matches.length === 0 || (matches.length === 1 && matches[0].value.toLowerCase() === q)) {
      list.style.display = "none";
      return;
    }
    for (const it of matches) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.value = it.value;
      const value = document.createElement("span");
      value.textContent = it.value;
      b.appendChild(value);
      if (it.hint) {
        const hint = document.createElement("span");
        hint.className = "hint";
        hint.textContent = it.hint;
        b.appendChild(hint);
      }
      b.addEventListener("mousedown", (e) => {
        e.preventDefault(); // do not blur the input before the click
        input.value = it.value;
        list.style.display = "none";
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      list.appendChild(b);
    }
    list.style.display = "flex";
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      list.style.display = "none";
    }, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (list.style.display === "none") {
      return;
    }
    if (e.key === "Escape") {
      // Close the list, keep the popup — Escape twice closes the form.
      e.stopPropagation();
      list.style.display = "none";
      return;
    }
    if (e.key === "Enter") {
      const first = list.querySelector<HTMLElement>("button");
      if (first) {
        e.preventDefault();
        input.value = first.dataset.value ?? "";
        list.style.display = "none";
      }
    }
  });
}

// ---------------------------------------------------------------------------
// A popup with a form like formPopup, but richer: a heading, textarea fields,
// helper text under a field and an optional destructive action on the left.
// Used by the footnote, tooltip and abbreviation editors.
// ---------------------------------------------------------------------------

export interface EditorField {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
  help?: string;
}

export function editorPopup(
  pop: HTMLElement,
  opts: {
    title?: string;
    fields: EditorField[];
    okLabel: string;
    danger?: { label: string; onClick: () => void };
    onOk: (values: Record<string, string>) => void;
  },
): void {
  const form = document.createElement("form");
  if (opts.title) {
    const head = document.createElement("div");
    head.className = "vpop-title";
    head.textContent = opts.title;
    form.appendChild(head);
  }
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  for (const f of opts.fields) {
    const label = document.createElement("label");
    label.textContent = f.label;
    let input: HTMLInputElement | HTMLTextAreaElement;
    if (f.multiline) {
      const ta = document.createElement("textarea");
      ta.rows = 3;
      // Enter is a newline inside the textarea; the form is submitted with Cmd/Ctrl+Enter.
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          form.requestSubmit();
        }
      });
      input = ta;
    } else {
      const inp = document.createElement("input");
      inp.type = "text";
      input = inp;
    }
    input.value = f.value ?? "";
    input.placeholder = f.placeholder ?? "";
    label.appendChild(input);
    form.appendChild(label);
    if (f.help) {
      const help = document.createElement("div");
      help.className = "vpop-help";
      help.textContent = f.help;
      form.appendChild(help);
    }
    inputs.set(f.name, input);
  }
  const row = document.createElement("div");
  row.className = "row";
  if (opts.danger) {
    const danger = document.createElement("button");
    danger.type = "button";
    danger.className = "danger";
    danger.textContent = opts.danger.label;
    const run = opts.danger.onClick;
    danger.addEventListener("click", () => {
      closePopup();
      run();
    });
    row.appendChild(danger);
  }
  const grow = document.createElement("span");
  grow.className = "grow";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = opts.okLabel;
  row.append(grow, cancel, ok);
  form.appendChild(row);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values: Record<string, string> = {};
    for (const [name, input] of inputs) {
      values[name] = input.value;
    }
    closePopup();
    opts.onOk(values);
  });
  pop.appendChild(form);
  inputs.values().next().value?.focus();
}

/** The first line of a parser's complaint — what the dialogs show under the field. */
export function firstErrorLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n").slice(0, 2).join(" — ").slice(0, 200);
}
