// @vitest-environment happy-dom
//
// The preview is read-only, yet a webview gets VS Code's stock context menu —
// Cut, Copy, Paste — regardless. The preview suppresses the stock menu and
// shows a Copy-only one of its own, and only when there is a selection worth
// copying. What is asserted here: the suppression itself (defaultPrevented),
// the selection gate, and that Copy actually reaches the host.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initReadOnlyMenu } from "../../webviews/preview/contextMenu";

const copySelection = vi.fn();
initReadOnlyMenu({ copySelection });

function rightClick(target: Element): MouseEvent {
  const e = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 30,
  });
  target.dispatchEvent(e);
  return e;
}

function selectText(el: Element): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

function menu(): HTMLElement | null {
  return document.querySelector(".mv-ctx");
}

beforeEach(() => {
  document.body.innerHTML = "<p id='text'>Readable text.</p>";
  document.getSelection()?.removeAllRanges();
  menu()?.remove();
  copySelection.mockClear();
});

describe("the read-only context menu", () => {
  it("suppresses the stock menu even with nothing selected", () => {
    const e = rightClick(document.getElementById("text")!);
    expect(e.defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
  });

  it("offers Copy when text is selected", () => {
    const p = document.getElementById("text")!;
    selectText(p);
    const e = rightClick(p);
    expect(e.defaultPrevented).toBe(true);
    const buttons = Array.from(menu()?.querySelectorAll("button") ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(["Copy"]);
  });

  it("Copy reaches the host and closes the menu", () => {
    const p = document.getElementById("text")!;
    selectText(p);
    rightClick(p);
    menu()!.querySelector("button")!.click();
    expect(copySelection).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("a click elsewhere closes the menu without copying", () => {
    const p = document.getElementById("text")!;
    selectText(p);
    rightClick(p);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu()).toBeNull();
    expect(copySelection).not.toHaveBeenCalled();
  });

  it("Escape closes the menu", () => {
    const p = document.getElementById("text")!;
    selectText(p);
    rightClick(p);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu()).toBeNull();
  });
});
