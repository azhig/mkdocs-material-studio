// @vitest-environment happy-dom
//
// How the page itself is laid out: the width of the canvas, the “On this page”
// panel, and which toolbar buttons look pressed. Two of these outlive the
// editor — reopening a page must not undo the way the author set it up.

import { beforeEach, describe, expect, it, vi } from "vitest";

type View = typeof import("../../webviews/visual/viewState");

interface Harness {
  view: View;
  docEl: HTMLElement;
  /** The webview's own little store, as VS Code hands it over. */
  stored: Record<string, unknown> | undefined;
}

const TOOLBAR = ["tbWidth", "tbToc", "tbSiteHead", "tbSiteNav", "tbTheme"];

async function fresh(saved?: Record<string, unknown>): Promise<Harness> {
  vi.resetModules();
  document.body.className = "";
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  const toc = document.createElement("div");
  toc.id = "vtoc";
  document.body.append(docEl, toc);
  for (const id of TOOLBAR) {
    const b = document.createElement("button");
    b.id = id;
    document.body.appendChild(b);
  }

  const state = { stored: saved };
  const core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl: document.createElement("span"),
    post: () => {},
    topBlockOf: () => null,
    caretInBlock: () => false,
    inSub: () => false,
    renderSub: () => {},
  });
  const view: View = await import("../../webviews/visual/viewState");
  view.initView({
    getState: () => state.stored,
    setState: (next) => {
      state.stored = next;
    },
  });
  return {
    view,
    docEl,
    get stored() {
      return state.stored;
    },
  } as Harness;
}

/** The labels of the table of contents, in order. */
function tocLabels(): string[] {
  return Array.from(document.querySelectorAll("#vtoc .vtoc-item")).map(
    (el) => el.textContent ?? "",
  );
}

describe("the width of the canvas", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("toggles and is remembered", () => {
    h.view.toggleWidth();
    expect(document.body.classList.contains("vwide")).toBe(true);
    expect(h.stored).toMatchObject({ vwide: true });

    h.view.toggleWidth();
    expect(document.body.classList.contains("vwide")).toBe(false);
    expect(h.stored).toMatchObject({ vwide: false });
  });

  it("the toolbar button follows it", () => {
    h.view.toggleWidth();
    expect(document.getElementById("tbWidth")!.classList.contains("on")).toBe(true);
  });
});

describe("the “On this page” panel", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h.docEl.innerHTML = "<h1>Getting started</h1><p>text</p><h2>Installing</h2><h3>Linux</h3>";
  });

  it("is built from the headings of the document, with their depth", () => {
    h.view.toggleToc();
    expect(tocLabels()).toEqual(["Getting started", "Installing", "Linux"]);
    const items = document.querySelectorAll("#vtoc .vtoc-item");
    expect(items[0].className).toContain("vtoc-l1");
    expect(items[2].className).toContain("vtoc-l3");
  });

  it("is not built while the panel is hidden — there is nothing to look at", () => {
    h.view.refreshToc();
    expect(tocLabels()).toEqual([]);
  });

  it("says so when the page has no headings", () => {
    h.docEl.innerHTML = "<p>just a paragraph</p>";
    h.view.toggleToc();
    expect(document.querySelector("#vtoc .vtoc-empty")?.textContent).toBe("No headings");
    expect(tocLabels()).toEqual([]);
  });

  it("follows the document: a new heading appears on the next refresh", () => {
    h.view.toggleToc();
    h.docEl.insertAdjacentHTML("beforeend", "<h2>Upgrading</h2>");
    h.view.refreshToc();
    expect(tocLabels()).toEqual(["Getting started", "Installing", "Linux", "Upgrading"]);
  });

  it("an untitled heading still gets an entry", () => {
    h.docEl.innerHTML = "<h1></h1>";
    h.view.toggleToc();
    expect(tocLabels()).toEqual(["(untitled)"]);
  });

  it("is remembered like the width", () => {
    h.view.toggleToc();
    expect(h.stored).toMatchObject({ vtoc: true });
  });
});

describe("reopening a page", () => {
  it("brings back the width and the panel the author left on", async () => {
    const h = await fresh({ vwide: true, vtoc: true, theme: null });
    h.docEl.innerHTML = "<h1>Title</h1>";
    h.view.restoreViewState();
    expect(document.body.classList.contains("vwide")).toBe(true);
    expect(document.body.classList.contains("vtoc")).toBe(true);
    // The panel was on, so its contents come back with it.
    expect(tocLabels()).toEqual(["Title"]);
  });

  it("a first opening has nothing stored and starts plain", async () => {
    const h = await fresh(undefined);
    h.view.restoreViewState();
    expect(document.body.classList.contains("vwide")).toBe(false);
    expect(document.body.classList.contains("vtoc")).toBe(false);
  });

  it("restoring does not overwrite what was stored", async () => {
    const h = await fresh({ vwide: true, vtoc: false, theme: null });
    h.view.restoreViewState();
    expect(h.stored).toMatchObject({ vwide: true, vtoc: false });
  });
});

describe("the toolbar mirrors the page", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("the site header and navigation buttons follow their classes", () => {
    document.body.classList.add("vhead", "vnav");
    h.view.syncViewButtons();
    expect(document.getElementById("tbSiteHead")!.classList.contains("on")).toBe(true);
    expect(document.getElementById("tbSiteNav")!.classList.contains("on")).toBe(true);

    document.body.classList.remove("vnav");
    h.view.syncViewButtons();
    expect(document.getElementById("tbSiteNav")!.classList.contains("on")).toBe(false);
  });

  it("the theme button explains what a click will do", () => {
    h.view.syncViewButtons();
    const btn = document.getElementById("tbTheme")!;
    expect(btn.title).toBe("Light theme — switch to dark");
  });
});
