// @vitest-environment happy-dom
//
// The grid of the icon picker. Every icon of a set is reachable — 7 447 of them
// in Material alone — so the grid appends a page at a time as it is scrolled
// instead of cutting the list off. It used to show the first 180 and tell the
// author to refine the search.
//
// The SVGs are asked for a page at a time as well: the icons live in one pack
// beside the extension, not as files the webview could link to.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Picker = typeof import("../../webviews/visual/iconPicker");

let picker: Picker;
let asked: string[][];

/** A set big enough to need several pages. */
const MATERIAL = Array.from({ length: 300 }, (_, i) => `icon-${i}`);

async function fresh(): Promise<{ grid: HTMLElement; note: HTMLElement }> {
  vi.resetModules();
  document.body.innerHTML = "";
  asked = [];
  picker = await import("../../webviews/visual/iconPicker");
  picker.initIconPicker({
    iconNames: () => Promise.resolve({ material: MATERIAL }),
    iconSvgs: (codes) => {
      asked.push(codes);
      return Promise.resolve(
        Object.fromEntries(codes.map((c) => [c, `<svg data-code="${c}"></svg>`])),
      );
    },
    anchor: () => document.body,
    insertInline: () => {},
    markDirty: () => {},
    saveSelection: () => {},
    restoreSelection: () => {},
  });
  const grid = document.createElement("div");
  const note = document.createElement("div");
  document.body.append(grid, note);
  return { grid, note };
}

/** happy-dom reports no layout, so the geometry the grid reads is set by hand. */
function measure(grid: HTMLElement, scrollTop: number, scrollHeight: number): void {
  Object.defineProperty(grid, "scrollTop", { value: scrollTop, configurable: true });
  Object.defineProperty(grid, "clientHeight", { value: 300, configurable: true });
  Object.defineProperty(grid, "scrollHeight", { value: scrollHeight, configurable: true });
}

describe("the grid of a set", () => {
  beforeEach(() => vi.useRealTimers());

  it("starts with a page, not with the whole set", async () => {
    const { grid, note } = await fresh();
    const view = picker.createGridView(grid, note);
    // The names arrive before the grid is shown, the way the picker does it.
    await picker.loadIconNames();
    view.show("material", "");
    expect(view.shown()).toBe(120);
    expect(note.textContent).toBe("120 / 300");
  });

  it("appends the next page when the bottom comes near", async () => {
    const { grid, note } = await fresh();
    const view = picker.createGridView(grid, note);
    await picker.loadIconNames();
    view.show("material", "");

    measure(grid, 900, 1000); // scrolled to the end
    view.onScroll();
    expect(view.shown()).toBe(240);

    view.onScroll();
    expect(view.shown()).toBe(300); // the last, shorter page
    expect(note.textContent).toBe("300 / 300");
  });

  it("stops at the end instead of asking for pages that are not there", async () => {
    const { grid, note } = await fresh();
    const view = picker.createGridView(grid, note);
    await picker.loadIconNames();
    view.show("material", "");
    measure(grid, 900, 1000);
    for (let i = 0; i < 6; i++) {
      view.onScroll();
    }
    expect(view.shown()).toBe(300);
    expect(grid.querySelectorAll("button")).toHaveLength(300);
  });

  it("asks for the SVGs of the page it just drew, and only once", async () => {
    const { grid, note } = await fresh();
    const view = picker.createGridView(grid, note);
    await picker.loadIconNames();
    view.show("material", "");
    await Promise.resolve();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toHaveLength(120);
    expect(asked[0][0]).toBe("material-icon-0");

    // The same page again (a search cleared back to the same list) is free.
    view.show("material", "");
    await Promise.resolve();
    expect(asked).toHaveLength(1);
  });

  it("searches the whole set, not the page on screen", async () => {
    const { grid, note } = await fresh();
    const view = picker.createGridView(grid, note);
    await picker.loadIconNames();
    // icon-250 is far past the first page — a filtered grid must still find it.
    view.show("material", "icon-25");
    expect(note.textContent).toBe("11 / 11");
    expect(grid.querySelector("button")?.title).toBe(":material-icon-25:");
  });
});
