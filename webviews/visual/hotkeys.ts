/**
 * Visual editor hot keys: parsing, writing and matching against a keyboard
 * event. A pure module with no DOM — covered by test/unit/hotkeys.test.ts.
 *
 * The Cmd/Ctrl modifier is mandatory for every combination: without it we would
 * be stealing plain typing from contenteditable. In the config a combination is
 * written as “mod+shift+alt+t” (`mod` is Cmd on macOS and Ctrl elsewhere); in
 * the UI it is shown in the platform's own notation.
 */

export interface HotKey {
  shift?: boolean;
  alt?: boolean;
  key: string; // a Latin letter, a digit or “\” — whatever is printed on the key
}

/** The part of an event a combination is recognized by (for DOM-free tests). */
export interface HotKeyEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  code: string;
}

/** “⌘⇧8” on macOS, “Ctrl+Shift+8” elsewhere. */
export function formatHotKey(hk: HotKey, isMac: boolean): string {
  if (isMac) {
    return `⌘${hk.shift ? "⇧" : ""}${hk.alt ? "⌥" : ""}${hk.key}`;
  }
  return `Ctrl+${hk.shift ? "Shift+" : ""}${hk.alt ? "Alt+" : ""}${hk.key}`;
}

/** The canonical notation for the config: “mod+shift+alt+t”. */
export function hotKeyToString(hk: HotKey): string {
  return `mod+${hk.shift ? "shift+" : ""}${hk.alt ? "alt+" : ""}${hk.key.toLowerCase()}`;
}

/**
 * Parses the notation from the config. Without `mod`, and for multi-character
 * keys, returns null — such a combination counts as disabled (so does an empty
 * string).
 */
export function parseHotKey(text: string): HotKey | null {
  const parts = text
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key || key.length !== 1 || !parts.includes("mod")) {
    return null;
  }
  return { shift: parts.includes("shift"), alt: parts.includes("alt"), key: key.toUpperCase() };
}

/**
 * The combination from an event — or null if it is not an assignable one.
 * We recognize it by `code` (the physical key) rather than by `key`: in a
 * Cyrillic layout `key` yields “and”/“w”, and with ⌥ on macOS — special
 * characters.
 */
export function eventHotKey(e: HotKeyEvent): HotKey | null {
  if (!e.metaKey && !e.ctrlKey) {
    return null;
  }
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit([0-9])$/.exec(e.code)?.[1];
  const key = letter ?? (e.code === "Backslash" ? "\\" : null);
  return key === null ? null : { shift: e.shiftKey, alt: e.altKey, key };
}
