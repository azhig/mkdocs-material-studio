// @vitest-environment happy-dom
//
// The rules around the command registry. A shortcut belongs to exactly one
// command: with two owners, which one runs would depend on the order of the
// registry, and the user would see a key work or not depending on nothing they
// can observe. Assigning a taken shortcut therefore takes it away from its
// previous owner and says so.
//
// The other rule is that an override equal to the default is not an override —
// otherwise `mkdocsStudio.keybindings` fills up with entries that change
// nothing and pin the defaults against ever being improved.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignHotKey,
  consumeHotKey,
  effectiveHotKey,
  hotKeyOf,
  hotKeyTextOf,
  initKeyBindings,
  isKeyOverridden,
  keyIndexes,
  keyLabel,
  keyOverrides,
  refreshHotkeyLabels,
  resetKeyOverrides,
  setKeyOverrides,
  type KeyCommand,
} from "../../webviews/visual/keyBindings";

const ran: string[] = [];

function command(id: string, label: string, def: KeyCommand["def"]): KeyCommand {
  return { id, group: "Test", label, def, run: () => ran.push(id) };
}

const COMMANDS: KeyCommand[] = [
  command("format.bold", "Bold", { key: "B" }),
  command("format.italic", "Italic", { key: "I" }),
  command("edit.undo", "Undo", { key: "Z" }),
  command("style.h1", "Heading 1", { key: "1", alt: true }),
  command("insert.table", "Table", null),
];

const persistOverrides = vi.fn();

beforeEach(() => {
  ran.length = 0;
  persistOverrides.mockClear();
  initKeyBindings({ commands: () => COMMANDS, persistOverrides });
  setKeyOverrides({});
  document.body.innerHTML = "";
});

describe("what shortcut a command really has", () => {
  it("is its default when nothing was changed", () => {
    expect(hotKeyOf("format.bold")).toMatchObject({ key: "B" });
    expect(isKeyOverridden("format.bold")).toBe(false);
  });

  it("is the override once one is stored", () => {
    setKeyOverrides({ "format.bold": "mod+shift+b" });
    expect(effectiveHotKey(COMMANDS[0])).toMatchObject({ key: "B", shift: true });
  });

  it("is nothing when the override disables it", () => {
    setKeyOverrides({ "format.bold": "" });
    expect(hotKeyOf("format.bold")).toBeNull();
    expect(hotKeyTextOf("format.bold")).toBe("");
  });

  it("is nothing for a command that never had one", () => {
    expect(hotKeyOf("insert.table")).toBeNull();
  });

  it("is nothing for a command that is not in the registry", () => {
    expect(hotKeyOf("no.such.command")).toBeNull();
  });
});

describe("assigning a shortcut", () => {
  it("stores it and writes the settings out", () => {
    expect(assignHotKey("insert.table", { key: "T" })).toBeNull();
    expect(hotKeyOf("insert.table")).toMatchObject({ key: "T" });
    expect(persistOverrides).toHaveBeenCalledTimes(1);
  });

  it("takes it away from the command that had it, and names that command", () => {
    const freed = assignHotKey("insert.table", { key: "B" });
    expect(freed).toBe("Bold");
    expect(hotKeyOf("insert.table")).toMatchObject({ key: "B" });
    // Bold is not left sharing it: it is disabled, not back on its default.
    expect(hotKeyOf("format.bold")).toBeNull();
  });

  it("leaves the lookup by keystroke with one owner", () => {
    assignHotKey("insert.table", { key: "B" });
    expect(keyIndexes().byHotKey.get("mod+b")?.id).toBe("insert.table");
  });

  it("says nothing was freed when the shortcut was unclaimed", () => {
    expect(assignHotKey("insert.table", { key: "Q" })).toBeNull();
  });

  it("re-assigning a command its own shortcut frees nothing", () => {
    expect(assignHotKey("format.bold", { key: "B" })).toBeNull();
    expect(hotKeyOf("format.bold")).toMatchObject({ key: "B" });
  });

  it("clears the shortcut when handed nothing", () => {
    assignHotKey("format.bold", null);
    expect(hotKeyOf("format.bold")).toBeNull();
    expect(keyIndexes().byHotKey.has("mod+b")).toBe(false);
  });

  it("does nothing for a command that is not in the registry", () => {
    expect(assignHotKey("no.such.command", { key: "Q" })).toBeNull();
    expect(persistOverrides).not.toHaveBeenCalled();
  });
});

describe("what ends up in the settings", () => {
  it("is nothing when a command is put back on its default", () => {
    assignHotKey("format.bold", { key: "Q" });
    expect(isKeyOverridden("format.bold")).toBe(true);
    assignHotKey("format.bold", { key: "B" });
    expect(isKeyOverridden("format.bold")).toBe(false);
    expect(keyOverrides()).not.toHaveProperty("format.bold");
  });

  it("is an empty string for a shortcut the user switched off", () => {
    assignHotKey("format.bold", null);
    expect(keyOverrides()["format.bold"]).toBe("");
  });

  it("is nothing when a command with no default is cleared", () => {
    // It had none to begin with: recording “disabled” would be a lie.
    assignHotKey("insert.table", null);
    expect(isKeyOverridden("insert.table")).toBe(false);
  });

  it("is empty again after a reset", () => {
    assignHotKey("format.bold", { key: "Q" });
    assignHotKey("edit.undo", null);
    resetKeyOverrides();
    expect(keyOverrides()).toEqual({});
    expect(hotKeyOf("format.bold")).toMatchObject({ key: "B" });
    expect(hotKeyOf("edit.undo")).toMatchObject({ key: "Z" });
  });
});

describe("the badges on the buttons", () => {
  it("carry the shortcut of the command a button is bound to", () => {
    document.body.innerHTML = '<button data-key-command="format.bold"></button>';
    refreshHotkeyLabels();
    const button = document.querySelector("button") as HTMLElement;
    expect(button.getAttribute("data-tip-key")).toBe(hotKeyTextOf("format.bold"));
    expect(button.getAttribute("data-tip-key")).toBeTruthy();
  });

  it("disappear when the shortcut does", () => {
    document.body.innerHTML = '<button data-key-command="format.bold"></button>';
    refreshHotkeyLabels();
    assignHotKey("format.bold", null);
    expect(document.querySelector("button")?.hasAttribute("data-tip-key")).toBe(false);
  });

  it("are not put on a button bound to nothing we know", () => {
    document.body.innerHTML = '<button data-key-command="no.such.command"></button>';
    refreshHotkeyLabels();
    expect(document.querySelector("button")?.hasAttribute("data-tip-key")).toBe(false);
  });
});

// VS Code's webview preload forwards keydown to the extension host from
// `window`, on the bubble phase, without ever looking at `defaultPrevented`.
// A keystroke we handled and only cancelled therefore ran twice — Ctrl+B made
// text bold in here and collapsed the side bar out there. Refusing to bubble is
// what stops that, and it has to be as narrow as the registry: everything VS
// Code owns and we do not — saving, the command palette, find — must still
// leave the webview untouched.
describe("a keystroke the editor answers for", () => {
  function press(
    code: string,
    mods: { shift?: boolean; alt?: boolean; mod?: boolean } = {},
  ): {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    code: string;
    cancelled: boolean;
    kept: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  } {
    return {
      metaKey: false,
      ctrlKey: mods.mod ?? true,
      shiftKey: mods.shift ?? false,
      altKey: mods.alt ?? false,
      code,
      cancelled: false,
      kept: false,
      preventDefault(): void {
        this.cancelled = true;
      },
      stopPropagation(): void {
        this.kept = true;
      },
    };
  }

  it("runs its command and never reaches VS Code", () => {
    const e = press("KeyB");
    expect(consumeHotKey(e)).toBe(true);
    expect(ran).toEqual(["format.bold"]);
    expect(e.cancelled).toBe(true);
    expect(e.kept).toBe(true);
  });

  it("is told apart by the physical key, so a non-Latin layout still works", () => {
    // In a Greek layout the B key types “β”: the event reports key “β”, code KeyB.
    expect(consumeHotKey(press("KeyB"))).toBe(true);
    expect(ran).toEqual(["format.bold"]);
  });

  it("leaves a keystroke bound to nothing alone", () => {
    // Ctrl+S is VS Code's, and has to stay VS Code's: stopping it here would
    // mean the file could no longer be saved from the visual editor.
    const e = press("KeyS");
    expect(consumeHotKey(e)).toBe(false);
    expect(e.cancelled).toBe(false);
    expect(e.kept).toBe(false);
    expect(ran).toEqual([]);
  });

  it("leaves plain typing alone", () => {
    const e = press("KeyB", { mod: false });
    expect(consumeHotKey(e)).toBe(false);
    expect(e.kept).toBe(false);
  });

  it("leaves a shortcut the user switched off alone", () => {
    assignHotKey("format.bold", null);
    const e = press("KeyB");
    expect(consumeHotKey(e)).toBe(false);
    expect(e.kept).toBe(false);
  });

  it("follows a reassignment, in both directions", () => {
    assignHotKey("format.bold", { key: "B", shift: true });
    const moved = press("KeyB", { shift: true });
    expect(consumeHotKey(moved)).toBe(true);
    expect(moved.kept).toBe(true);
    // …and the key it left is handed back to VS Code, with no list to maintain.
    const freed = press("KeyB");
    expect(consumeHotKey(freed)).toBe(false);
    expect(freed.kept).toBe(false);
  });
});

describe("how a shortcut is spelled", () => {
  it("follows the platform", () => {
    // Cmd/Ctrl is part of every combination — without it we would be stealing
    // plain typing from contenteditable. happy-dom reports a non-Mac user
    // agent, so the spelled-out form is the one used here.
    expect(keyLabel({ key: "B" })).toBe("Ctrl+B");
    expect(keyLabel({ key: "1", alt: true })).toBe("Ctrl+Alt+1");
    expect(keyLabel({ key: "B", shift: true })).toBe("Ctrl+Shift+B");
  });
});
