import { describe, it, expect } from "vitest";
import {
  eventHotKey,
  formatHotKey,
  hotKeyToString,
  parseHotKey,
  type HotKey,
} from "../../webviews/visual/hotkeys";

/** Event template: by default only Cmd is pressed. */
function ev(code: string, mods: Partial<Record<"meta" | "ctrl" | "shift" | "alt", boolean>> = {}) {
  return {
    metaKey: mods.meta ?? true,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    code,
  };
}

describe("hot keys: config notation", () => {
  it("writes modifiers in a fixed order", () => {
    expect(hotKeyToString({ key: "B" })).toBe("mod+b");
    expect(hotKeyToString({ shift: true, key: "S" })).toBe("mod+shift+s");
    expect(hotKeyToString({ alt: true, key: "T" })).toBe("mod+alt+t");
    expect(hotKeyToString({ shift: true, alt: true, key: "T" })).toBe("mod+shift+alt+t");
  });

  it("parses its own notation back without loss", () => {
    const keys: HotKey[] = [
      { shift: false, alt: false, key: "K" },
      { shift: true, alt: false, key: "9" },
      { shift: false, alt: true, key: "0" },
      { shift: true, alt: true, key: "T" },
      { shift: true, alt: false, key: "\\" },
    ];
    for (const hk of keys) {
      expect(parseHotKey(hotKeyToString(hk))).toEqual(hk);
    }
  });

  it("treats an empty string and a binding without Cmd/Ctrl as disabled", () => {
    expect(parseHotKey("")).toBeNull();
    expect(parseHotKey("shift+s")).toBeNull(); // without mod we would steal ordinary typing
    expect(parseHotKey("alt+t")).toBeNull();
    expect(parseHotKey("mod+enter")).toBeNull(); // single-character keys only
    expect(parseHotKey("junk")).toBeNull();
  });
});

describe("hot keys: label", () => {
  it("renders differently on macOS and elsewhere", () => {
    const hk: HotKey = { shift: true, alt: true, key: "T" };
    expect(formatHotKey(hk, true)).toBe("⌘⇧⌥T");
    expect(formatHotKey(hk, false)).toBe("Ctrl+Shift+Alt+T");
    expect(formatHotKey({ key: "B" }, true)).toBe("⌘B");
    expect(formatHotKey({ key: "B" }, false)).toBe("Ctrl+B");
  });
});

describe("hot keys: matching an event", () => {
  it("takes the key from code — the layout does not matter", () => {
    // In a Cyrillic layout the same key would give key === "and".
    expect(eventHotKey(ev("KeyB"))).toEqual({ shift: false, alt: false, key: "B" });
    expect(eventHotKey(ev("Digit8", { shift: true }))).toEqual({
      shift: true,
      alt: false,
      key: "8",
    });
    expect(eventHotKey(ev("Backslash", { shift: true }))).toEqual({
      shift: true,
      alt: false,
      key: "\\",
    });
  });

  it("accepts both Ctrl (Windows/Linux) and Cmd (macOS)", () => {
    expect(eventHotKey(ev("KeyK", { meta: false, ctrl: true }))?.key).toBe("K");
  });

  it("ignores presses without a modifier and service keys", () => {
    expect(eventHotKey(ev("KeyB", { meta: false }))).toBeNull();
    expect(eventHotKey(ev("Enter"))).toBeNull();
    expect(eventHotKey(ev("Tab"))).toBeNull();
    expect(eventHotKey(ev("ShiftLeft", { shift: true }))).toBeNull();
  });

  it("produces a key matching the config entry", () => {
    const hk = eventHotKey(ev("KeyT", { alt: true, shift: true }));
    expect(hk && hotKeyToString(hk)).toBe("mod+shift+alt+t");
  });
});
