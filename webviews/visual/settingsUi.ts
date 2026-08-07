// The editor's own settings popup.
//
// Three things live here that the extension's settings page cannot do well:
// which components sit on the toolbar (a list with a switch per component),
// when inline formatting appears (a segmented switch), and the keyboard
// shortcuts — the only place in the editor that reads a keystroke in order to
// store it rather than to act on it.
//
// Everything it changes is written straight back to VS Code's settings, so a
// choice made here survives a reload like any other setting.

import {
  assignHotKey,
  claimKey,
  effectiveHotKey,
  isKeyOverridden,
  keyLabel,
  keyOverrides,
  resetKeyOverrides,
  type KeyCommand,
} from "./keyBindings";
import { eventHotKey } from "./hotkeys";
import { showPopup, type QuickItem } from "./popups";
import { t } from "../shared/i18n";

/** What the settings popup edits on the editor's behalf. */
export interface SettingsUiHost {
  /** The component palette — the list of things that can go on the toolbar. */
  componentInsertItems(): QuickItem[];
  /** That component's icon, drawn the same way the palette draws it. */
  componentIconEl(icon: string | undefined): HTMLElement;
  /** Whether a component currently has a button on the toolbar. */
  isPinned(id: string): boolean;
  /** Pins or unpins it, and redraws the toolbar. */
  setPinned(id: string, pinned: boolean): void;
  /** When the inline formatting bubble appears: selection / both / toolbar. */
  inlineFormatting(): string;
  setInlineFormatting(mode: string): void;
  /** The full command list, for the shortcuts page. */
  keyCommands(): KeyCommand[];
  /** Writes every setting above back to the extension. */
  persistUiConfig(): void;
}

let host: SettingsUiHost;

export function initSettingsUi(next: SettingsUiHost): void {
  host = next;
}

/** A segmented switch (iOS style): the selected option is highlighted. */
function makeSegmented(
  options: Array<{ value: string; label: string; title?: string }>,
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  const seg = document.createElement("div");
  seg.className = "vseg";
  for (const o of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vseg-opt" + (o.value === current ? " on" : "");
    b.textContent = o.label;
    if (o.title) {
      b.title = o.title;
    }
    b.addEventListener("click", () => {
      for (const el of Array.from(seg.children)) {
        el.classList.toggle("on", el === b);
      }
      onPick(o.value);
    });
    seg.appendChild(b);
  }
  return seg;
}

/**
 * The “Editor settings” popup (the gear button). Two screens: the main one
 * (the placement of components and of formatting) and “Keyboard shortcuts” — so that a list
 * of three dozen commands does not stretch the main one. Everything is applied immediately and
 * saved into the VS Code config (setConfig).
 */
export function openEditorSettings(anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const pop = showPopup(
    Math.max(8, rect.right + window.scrollX - 344),
    rect.bottom + window.scrollY + 6,
  );
  pop.className = "vpop editor-settings";
  renderSettingsMain(pop);
}

/** The settings popup header: a glyph (or “back”) plus the screen name. */
function settingsHeader(pop: HTMLElement, title: string, back?: () => void): void {
  const header = document.createElement("div");
  header.className = "es-header";
  if (back) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "es-back";
    btn.innerHTML = '<span class="codicon codicon-arrow-left"></span>';
    btn.setAttribute("data-tip", t("Back"));
    btn.addEventListener("click", back);
    header.appendChild(btn);
  } else {
    const gear = document.createElement("span");
    gear.className = "codicon codicon-settings-gear";
    header.appendChild(gear);
  }
  const htext = document.createElement("span");
  htext.textContent = title;
  header.appendChild(htext);
  pop.appendChild(header);
}

function renderSettingsMain(pop: HTMLElement): void {
  endKeyCapture();
  pop.textContent = "";
  settingsHeader(pop, t("Editor settings"));

  // --- Insert components: the toolbar OR the “+ Insert” menu ---
  const secBtns = document.createElement("div");
  secBtns.className = "es-section";
  const bTitle = document.createElement("div");
  bTitle.className = "es-title";
  bTitle.textContent = t("Insert components");
  const bSub = document.createElement("div");
  bSub.className = "es-sub";
  bSub.textContent = t(
    "Where to show each one — as a quick button on the toolbar or in the “+ Insert” list.",
  );
  secBtns.append(bTitle, bSub);

  const list = document.createElement("div");
  list.className = "es-list";
  for (const item of host.componentInsertItems()) {
    if (!item.id) {
      continue;
    }
    const id = item.id;
    const row = document.createElement("div");
    row.className = "es-row";
    const name = document.createElement("span");
    name.className = "es-name";
    name.textContent = item.label;
    const seg = makeSegmented(
      [
        { value: "menu", label: t("Menu"), title: t("In the “+ Insert” button list") },
        { value: "panel", label: t("Toolbar"), title: t("As a quick button on the top toolbar") },
      ],
      host.isPinned(id) ? "panel" : "menu",
      (v) => {
        if (v === "panel") {
          host.setPinned(id, true);
        } else {
          host.setPinned(id, false);
        }
        host.persistUiConfig();
      },
    );
    row.append(host.componentIconEl(item.icon), name, seg);
    list.appendChild(row);
  }
  secBtns.appendChild(list);
  pop.appendChild(secBtns);

  const divider = document.createElement("div");
  divider.className = "es-divider";
  pop.appendChild(divider);

  // --- Text formatting (at the bottom) ---
  const secFmt = document.createElement("div");
  secFmt.className = "es-section";
  const fTitle = document.createElement("div");
  fTitle.className = "es-title";
  fTitle.textContent = t("Text formatting");
  const fSub = document.createElement("div");
  fSub.className = "es-sub";
  fSub.textContent = t("Where to show bold, italic, underline, code, highlight, link, clear.");
  secFmt.append(fTitle, fSub);
  const fmtSeg = makeSegmented(
    [
      { value: "selection", label: t("By the text"), title: t("Pop-up menu on selection") },
      { value: "toolbar", label: t("On the toolbar"), title: t("Buttons on the top toolbar") },
      { value: "both", label: t("Everywhere"), title: t("Both places") },
    ],
    host.inlineFormatting(),
    (v) => {
      host.setInlineFormatting(v);
      host.persistUiConfig();
    },
  );
  fmtSeg.classList.add("es-wide");
  secFmt.appendChild(fmtSeg);
  pop.appendChild(secFmt);

  // --- Navigation to the keyboard shortcuts screen ---
  const nav = document.createElement("button");
  nav.type = "button";
  nav.className = "es-nav";
  nav.innerHTML =
    '<span class="codicon codicon-keyboard"></span>' +
    `<span class="es-name">${t("Keyboard shortcuts")}</span>` +
    '<span class="codicon codicon-chevron-right"></span>';
  nav.addEventListener("click", () => renderSettingsKeys(pop));
  pop.appendChild(nav);
}

// The “Keyboard shortcuts” screen: a list of commands by group, each with a button showing
// the current shortcut. Clicking the button starts the capture: the next press with
// Cmd/Ctrl becomes the new shortcut (Esc — cancel, Backspace — disable).
let cancelKeyCapture: (() => void) | null = null;

export function endKeyCapture(): void {
  cancelKeyCapture?.();
}

function renderSettingsKeys(pop: HTMLElement, notice?: string): void {
  endKeyCapture();
  pop.textContent = "";
  settingsHeader(pop, t("Keyboard shortcuts"), () => renderSettingsMain(pop));

  const sub = document.createElement("div");
  sub.className = "es-sub es-keys-sub";
  sub.textContent =
    notice ?? t("Click a shortcut and type a new one. Esc — cancel, Backspace — disable.");
  if (notice) {
    sub.classList.add("es-notice");
  }
  pop.appendChild(sub);

  const list = document.createElement("div");
  list.className = "es-list es-keys";
  let group = "";
  for (const c of host.keyCommands()) {
    if (c.group !== group) {
      group = c.group;
      const gt = document.createElement("div");
      gt.className = "es-group";
      gt.textContent = group;
      list.appendChild(gt);
    }
    const row = document.createElement("div");
    row.className = "es-row";
    const name = document.createElement("span");
    name.className = "es-name";
    name.textContent = c.label;
    const hk = effectiveHotKey(c);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = hk ? "vkbd es-key-btn" : "vkbd es-key-btn es-key-off";
    btn.textContent = hk ? keyLabel(hk) : t("not assigned");
    if (isKeyOverridden(c.id)) {
      btn.classList.add("es-key-custom");
      btn.setAttribute("data-tip", t("Changed manually"));
    }
    btn.addEventListener("click", () => captureHotKey(c, btn, pop));
    row.append(name, btn);
    list.appendChild(row);
  }
  pop.appendChild(list);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "es-reset";
  reset.textContent = t("Reset all shortcuts");
  reset.disabled = Object.keys(keyOverrides()).length === 0;
  reset.addEventListener("click", () => {
    resetKeyOverrides();
    renderSettingsKeys(pop);
  });
  pop.appendChild(reset);
}

function captureHotKey(c: KeyCommand, btn: HTMLElement, pop: HTMLElement): void {
  endKeyCapture();
  btn.classList.add("capturing");
  btn.textContent = t("Press the keys…");
  const onKey = (e: KeyboardEvent): void => {
    // Suppressed in the capture phase: while the capture is running, neither the editor nor VS Code
    // must execute the pressed shortcut.
    claimKey(e);
    if (e.key === "Escape") {
      finish();
      renderSettingsKeys(pop);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      finish();
      assignHotKey(c.id, null);
      renderSettingsKeys(pop);
      return;
    }
    const hk = eventHotKey(e);
    if (!hk) {
      return; // waiting for Cmd/Ctrl + a letter, a digit or “\”
    }
    finish();
    const freed = assignHotKey(c.id, hk);
    renderSettingsKeys(
      pop,
      freed
        ? t("{0} was freed up from “{1}” — shortcuts are unique.", keyLabel(hk), freed)
        : undefined,
    );
  };
  const finish = (): void => {
    document.removeEventListener("keydown", onKey, true);
    cancelKeyCapture = null;
  };
  cancelKeyCapture = () => {
    finish();
    btn.classList.remove("capturing");
  };
  document.addEventListener("keydown", onKey, true);
}
