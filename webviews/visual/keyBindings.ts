// The registry of commands with keyboard shortcuts.
//
// A single source of truth: the keyboard handler, the badges in the tooltips
// and the “Keyboard shortcuts” section in the settings all take the shortcut
// from here. The user can reassign any of them — the overrides are stored in
// `mkdocsStudio.keybindings` (command id → “mod+shift+alt+key”, an empty string
// = disabled) and survive a restart, like the other settings.
//
// The commands themselves are not here: every one of them runs something in the
// editor, and the list is handed in at startup. This module owns the rules
// around that list — which shortcut a command really has, that no two commands
// share one, and what the badges say.

import { formatHotKey, hotKeyToString, parseHotKey, type HotKey } from "./hotkeys";

export interface KeyCommand {
  id: string; // a stable identifier for the config
  group: string; // the section in the settings
  label: string;
  def: HotKey | null; // the default shortcut
  run: () => void;
}

/** Which platform's notation to speak — the shortcut badges and the Keys popup both ask. */
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** “⌘⇧8” on macOS, “Ctrl+Shift+8” elsewhere. */
export function keyLabel(hk: HotKey): string {
  return formatHotKey(hk, IS_MAC);
}

let commandSource: () => KeyCommand[] = () => [];
let persist: () => void = () => {};

/** Overrides from the settings and the derived indexes (reset when they change). */
let overrides: Record<string, string> = {};
let byId: Map<string, KeyCommand> | null = null;
let byHotKey: Map<string, KeyCommand> | null = null;

export function initKeyBindings(options: {
  /** The full command list — rebuilt on demand, because the insert commands
   *  come from the component palette and can change. */
  commands: () => KeyCommand[];
  /** Writes the overrides back to the extension's settings. */
  persistOverrides: () => void;
}): void {
  commandSource = options.commands;
  persist = options.persistOverrides;
}

/** The overrides as they go into the settings — only the differences from the defaults. */
export function keyOverrides(): Record<string, string> {
  return overrides;
}

/** Replaces the whole set, e.g. when the settings arrive from the extension. */
export function setKeyOverrides(next: Record<string, string>): void {
  overrides = next;
  invalidateKeyIndex();
}

function invalidateKeyIndex(): void {
  byId = null;
  byHotKey = null;
}

export function effectiveHotKey(c: KeyCommand): HotKey | null {
  const raw = overrides[c.id];
  return raw === undefined ? c.def : parseHotKey(raw);
}

/** Whether the user has changed this command's shortcut. */
export function isKeyOverridden(id: string): boolean {
  return overrides[id] !== undefined;
}

export function keyIndexes(): { byId: Map<string, KeyCommand>; byHotKey: Map<string, KeyCommand> } {
  if (!byId || !byHotKey) {
    byId = new Map();
    byHotKey = new Map();
    for (const c of commandSource()) {
      byId.set(c.id, c);
      const hk = effectiveHotKey(c);
      if (hk) {
        byHotKey.set(hotKeyToString(hk), c);
      }
    }
  }
  return { byId, byHotKey };
}

/** The command's effective shortcut (taking the override into account). */
export function hotKeyOf(id: string): HotKey | null {
  const c = keyIndexes().byId.get(id);
  return c ? effectiveHotKey(c) : null;
}

/** The command's shortcut label for the badge; an empty string means not assigned. */
export function hotKeyTextOf(id: string): string {
  const hk = hotKeyOf(id);
  return hk ? keyLabel(hk) : "";
}

/** Records an override (if it matches the default, the override is removed). */
function setKeyOverride(c: KeyCommand, hk: HotKey | null): void {
  const same =
    hk && c.def ? hotKeyToString(hk) === hotKeyToString(c.def) : hk === null && c.def === null;
  if (same) {
    delete overrides[c.id];
  } else {
    overrides[c.id] = hk ? hotKeyToString(hk) : "";
  }
}

/**
 * Assigns a shortcut to a command, freeing it from its previous owner, and
 * returns that owner's name so the settings can say what happened. A shortcut
 * belongs to one command: two owners would make which one runs depend on the
 * order of the registry.
 */
export function assignHotKey(id: string, hk: HotKey | null): string | null {
  const command = keyIndexes().byId.get(id);
  if (!command) {
    return null;
  }
  let freed: string | null = null;
  if (hk) {
    const taken = keyIndexes().byHotKey.get(hotKeyToString(hk));
    if (taken && taken.id !== id) {
      setKeyOverride(taken, null);
      freed = taken.label;
    }
  }
  setKeyOverride(command, hk);
  invalidateKeyIndex();
  refreshHotkeyLabels();
  persist();
  return freed;
}

/** Puts every command back on its default shortcut. */
export function resetKeyOverrides(): void {
  overrides = {};
  invalidateKeyIndex();
  refreshHotkeyLabels();
  persist();
}

/**
 * Updates the shortcut badges on all elements bound to commands (toolbar
 * buttons, pinned components, the bubble menu). Called at startup and after
 * every change to the bindings.
 */
export function refreshHotkeyLabels(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-key-command]")) {
    const text = hotKeyTextOf(el.getAttribute("data-key-command") ?? "");
    if (text) {
      el.setAttribute("data-tip-key", text);
    } else {
      el.removeAttribute("data-tip-key");
    }
  }
}
