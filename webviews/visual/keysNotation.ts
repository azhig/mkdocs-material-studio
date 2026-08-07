// The pymdownx.keys notation (`++ctrl+alt+del++`) built from real key presses.
//
// A combination arrives as several events, not one: Ctrl+Alt+Del is three
// keydowns, and the first of them carries Ctrl alone. Reading the notation off
// a single event — as the popup used to — therefore recorded `++ctrl++` no
// matter what was pressed afterwards, because the modifier always comes first.
// So a press is either partial (only modifiers are down, more may follow) or
// complete (a named key arrived and nothing can be added to it).
//
// A modifier on its own is a legal combination — `++ctrl++` documents the Ctrl
// key — so the caller keeps the last partial and commits it when the user lets
// go, not the moment it appears.
//
// Only keys whose name is certain are recorded. pymdownx prints an unknown name
// as literal text, so guessing at the name of “,” would publish the word
// “comma” — or worse, the wrong word — into someone's documentation. The
// popup's text field stays there for those.
//
// DOM-free — covered by test/unit/keysNotation.test.ts.

/** The part of a KeyboardEvent a combination is read from. */
export interface KeyPress {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** KeyboardEvent.key — what the layout produced. */
  key: string;
  /** KeyboardEvent.code — the physical key, the fallback for a non-Latin layout. */
  code: string;
}

export interface KeysPress {
  /** Everything held at this moment: `++ctrl+alt++`, and then `++ctrl+alt+del++`. */
  notation: string;
  /** A named key arrived: the combination is finished. */
  complete: boolean;
}

/** Keys that have a name of their own in the notation. */
const NAMED = new Map<string, string>([
  [" ", "space"],
  ["Escape", "esc"],
  ["Enter", "enter"],
  ["Tab", "tab"],
  ["Backspace", "backspace"],
  ["Delete", "del"],
  ["Insert", "insert"],
  ["Home", "home"],
  ["End", "end"],
  ["PageUp", "page-up"],
  ["PageDown", "page-down"],
  ["ArrowUp", "arrow-up"],
  ["ArrowDown", "arrow-down"],
  ["ArrowLeft", "arrow-left"],
  ["ArrowRight", "arrow-right"],
  ["CapsLock", "caps-lock"],
]);

/** Held rather than pressed: these never finish a combination. */
const MODIFIER_KEYS = new Set(["Control", "Alt", "AltGraph", "Shift", "Meta", "OS"]);

/**
 * The name of the pressed key, or null when there is nothing to name yet — a
 * bare modifier, or a key the notation cannot spell.
 */
export function keyName(e: KeyPress): string | null {
  const named = NAMED.get(e.key);
  if (named !== undefined) {
    return named;
  }
  if (MODIFIER_KEYS.has(e.key)) {
    return null;
  }
  if (/^F([1-9]|1[0-2])$/.test(e.key)) {
    return e.key.toLowerCase();
  }
  // Prefer what is printed on the key: a reader of the page looks for that, and
  // on a QWERTZ keyboard the physical “KeyZ” is the letter Y.
  if (/^[A-Za-z0-9]$/.test(e.key)) {
    return e.key.toLowerCase();
  }
  // The layout produced something else — Cyrillic, Greek, or the “∫” that ⌥B
  // gives on macOS. Fall back to the physical key, which is always Latin.
  const physical = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit([0-9])$/.exec(e.code)?.[1];
  return physical === undefined ? null : physical.toLowerCase();
}

/** The modifiers held down, in the order Apple and Material both write them. */
function modifierNames(e: KeyPress, isMac: boolean): string[] {
  const names: string[] = [];
  if (e.ctrlKey) {
    names.push("ctrl");
  }
  if (e.altKey) {
    names.push("alt");
  }
  if (e.shiftKey) {
    names.push("shift");
  }
  // One physical key, two names: Cmd on a Mac and the Windows key elsewhere.
  if (e.metaKey) {
    names.push(isMac ? "cmd" : "win");
  }
  return names;
}

/**
 * One press of the recording. Null when it carries nothing at all — a key with
 * no name and no modifier under it, which the caller ignores and keeps waiting.
 */
export function pressToKeys(e: KeyPress, isMac: boolean): KeysPress | null {
  const parts = modifierNames(e, isMac);
  const name = keyName(e);
  if (name === null) {
    return parts.length > 0 ? { notation: wrap(parts), complete: false } : null;
  }
  parts.push(name);
  return { notation: wrap(parts), complete: true };
}

function wrap(parts: string[]): string {
  return `++${parts.join("+")}++`;
}
