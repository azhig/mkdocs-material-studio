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
