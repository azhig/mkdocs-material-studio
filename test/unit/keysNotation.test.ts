// Recording a key combination for `++ctrl+alt+del++`.
//
// The defect this file was written for: the popup read the notation off a
// single keydown and stopped there, so the very first modifier ended the
// recording — Ctrl+Alt+Del came out as `++ctrl++`, and so did every other
// combination, because a modifier is always pressed first.

import { describe, expect, it } from "vitest";
import { keyName, pressToKeys, type KeyPress } from "../../webviews/visual/keysNotation";

/** A keydown as the browser reports it: modifiers are already set on their own press. */
function press(key: string, opts: Partial<KeyPress> = {}): KeyPress {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ...opts,
  };
}

/** The sequence of presses of one combination, as pressToKeys sees it. */
function record(presses: KeyPress[], isMac = false): { shown: string[]; done: string | null } {
  const shown: string[] = [];
  for (const p of presses) {
    const result = pressToKeys(p, isMac);
    if (!result) {
      continue;
    }
    if (result.complete) {
      return { shown, done: result.notation };
    }
    shown.push(result.notation);
  }
  // Nothing but modifiers — the popup commits the last one when the keys are released.
  return { shown, done: shown.length > 0 ? shown[shown.length - 1] : null };
}

describe("a combination is recorded across presses, not from the first one", () => {
  it("records Ctrl+Alt+Del in full", () => {
    const { shown, done } = record([
      press("Control", { ctrlKey: true }),
      press("Alt", { ctrlKey: true, altKey: true }),
      press("Delete", { ctrlKey: true, altKey: true }),
    ]);
    // Each modifier only moves the recording along and is shown as it goes.
    expect(shown).toEqual(["++ctrl++", "++ctrl+alt++"]);
    expect(done).toBe("++ctrl+alt+del++");
  });

  it("does not treat a held modifier as the answer", () => {
    // The whole defect in one assertion: Ctrl is not a finished combination.
    const ctrl = pressToKeys(press("Control", { ctrlKey: true }), false);
    expect(ctrl).toEqual({ notation: "++ctrl++", complete: false });
  });

  it("finishes on the named key and ignores what comes after", () => {
    const { done } = record([
      press("Shift", { shiftKey: true }),
      press("K", { shiftKey: true }),
      press("L"),
    ]);
    expect(done).toBe("++shift+k++");
  });

  it("keeps a modifier-only combination — ++ctrl++ documents the Ctrl key", () => {
    const { done } = record([press("Control", { ctrlKey: true })]);
    expect(done).toBe("++ctrl++");
  });

  it("has nothing to record for a press with neither a modifier nor a name", () => {
    expect(pressToKeys(press("Dead", { code: "Backquote" }), false)).toBeNull();
  });
});

describe("the name of a key", () => {
  it("spells the modifiers in the order Apple and Material write them", () => {
    const all = press("X", { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true });
    expect(pressToKeys(all, true)?.notation).toBe("++ctrl+alt+shift+cmd+x++");
  });

  it("calls the Meta key by the name of the platform it is on", () => {
    const meta = press("Meta", { metaKey: true });
    expect(pressToKeys(meta, true)?.notation).toBe("++cmd++");
    expect(pressToKeys(meta, false)?.notation).toBe("++win++");
  });

  it("takes the letter that is printed on the key, not the physical one", () => {
    // A QWERTZ keyboard: the key at the physical Z position prints Y.
    expect(keyName(press("y", { code: "KeyZ" }))).toBe("y");
  });

  it("falls back to the physical key when the layout is not Latin", () => {
    // Greek: `key` is “κ”, which the notation cannot spell, but `code` is KeyK.
    expect(keyName(press("κ", { code: "KeyK" }))).toBe("k");
    // macOS with Option held turns B into “∫”.
    expect(keyName(press("∫", { code: "KeyB", altKey: true }))).toBe("b");
  });

  it("lower-cases a shifted letter and keeps shift as a modifier", () => {
    expect(pressToKeys(press("A", { shiftKey: true, code: "KeyA" }), false)?.notation).toBe(
      "++shift+a++",
    );
  });

  it("names the keys that have names", () => {
    const named: Array<[string, string]> = [
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
      ["F5", "f5"],
      ["F12", "f12"],
      ["7", "7"],
    ];
    expect(named.map(([key]) => keyName(press(key)))).toEqual(named.map(([, name]) => name));
  });

  it("refuses a key it cannot spell rather than inventing a name for it", () => {
    // pymdownx prints an unknown name as literal text, so a guess at “,” would
    // publish the guess. The popup's text field is the way in for those.
    expect(keyName(press(",", { code: "Comma" }))).toBeNull();
    expect(keyName(press("F13", { code: "F13" }))).toBeNull();
  });

  it("does not mistake an inherited property for a key name", () => {
    expect(keyName(press("constructor"))).toBeNull();
    expect(keyName(press("toString"))).toBeNull();
  });
});
