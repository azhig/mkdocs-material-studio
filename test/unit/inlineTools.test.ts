// @vitest-environment happy-dom
//
// Inline formatting: what the bubble menu and the toolbar buttons do to the
// text under the selection. Everything here edits somebody's paragraph in
// place, and the mistakes are the quiet kind — a tag that Markdown cannot
// express disappears on the next save, and a list turns into one paragraph.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeTopBlock } from "../../webviews/visual/htmlToMd";

type Tools = typeof import("../../webviews/visual/inlineTools");

interface Harness {
  tools: Tools;
  docEl: HTMLElement;
  /** Blocks the tools asked to synchronize. */
  dirtied: number;
}

async function fresh(): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  document.body.append(docEl);

  const state = { dirtied: 0 };
  const tools: Tools = await import("../../webviews/visual/inlineTools");
  tools.initInlineTools({
    docEl,
    cmd: () => {},
    openLinkPopup: () => {},
    enclosingTag: (node, tagName) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest<HTMLElement>(tagName.toLowerCase()) ?? null;
    },
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    markDirtyAtSelection: () => {
      state.dirtied++;
    },
    bubbleEnabled: () => true,
  });
  return {
    tools,
    docEl,
    get dirtied() {
      return state.dirtied;
    },
  } as Harness;
}

/** Selects the text of an element, or a slice of its first text node. */
function select(el: Element, from?: number, to?: number): void {
  const range = document.createRange();
  if (from === undefined) {
    range.selectNodeContents(el);
  } else {
    const text = el.firstChild!;
    range.setStart(text, from);
    range.setEnd(text, to ?? from);
  }
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Puts the caret inside an element without selecting anything. */
function caretIn(el: Element, offset = 0): void {
  const range = document.createRange();
  range.setStart(el.firstChild ?? el, offset);
  range.collapse(true);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("inline code and underline", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("wraps the selected words", () => {
    h.docEl.innerHTML = "<p>run npm install now</p>";
    const p = h.docEl.firstElementChild!;
    select(p, 4, 15);
    h.tools.toggleInlineCode();
    expect(p.innerHTML).toBe("run <code>npm install</code> now");
  });

  it("underline is <ins>, never the browser's <u>", () => {
    // `^^text^^` (pymdownx.caret) renders as <ins>. A <u> cannot be written back
    // as Markdown, so it would vanish on the next save without a word.
    h.docEl.innerHTML = "<p>important words</p>";
    const p = h.docEl.firstElementChild!;
    select(p, 0, 9);
    h.tools.toggleUnderline();
    expect(p.querySelector("ins")?.textContent).toBe("important");
    expect(p.querySelector("u")).toBe(null);
  });

  it("the caret inside the formatting takes it off", () => {
    h.docEl.innerHTML = "<p>run <code>npm install</code> now</p>";
    const p = h.docEl.firstElementChild!;
    caretIn(p.querySelector("code")!, 3);
    h.tools.toggleInlineCode();
    expect(p.innerHTML).toBe("run npm install now");
  });

  it("selecting the whole formatted phrase takes it off too", () => {
    h.docEl.innerHTML = "<p><ins>underlined</ins></p>";
    const p = h.docEl.firstElementChild!;
    select(p);
    h.tools.toggleUnderline();
    expect(p.querySelector("ins")).toBe(null);
    expect(p.textContent).toBe("underlined");
  });

  it("an empty selection outside the formatting changes nothing", () => {
    h.docEl.innerHTML = "<p>plain text</p>";
    const p = h.docEl.firstElementChild!;
    caretIn(p, 3);
    h.tools.toggleInlineCode();
    expect(p.innerHTML).toBe("plain text");
  });

  it("a selection crossing element boundaries still ends up as one tag", () => {
    h.docEl.innerHTML = "<p><em>one</em> two</p>";
    const p = h.docEl.firstElementChild!;
    const range = document.createRange();
    range.setStart(p.querySelector("em")!.firstChild!, 1);
    range.setEnd(p.lastChild!, 3);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    h.tools.toggleInlineCode();
    expect(p.querySelectorAll("code")).toHaveLength(1);
    expect(p.textContent).toBe("one two");
  });
});

describe("the highlighter", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  /** Clicks a swatch of the open palette by its title. */
  function clickSwatch(title: string): void {
    const btn = document.querySelector<HTMLElement>(`.mark-palette [title="${title}"]`);
    if (!btn) {
      throw new Error(`no swatch “${title}” in the palette`);
    }
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("paints the selection with the chosen colour class", () => {
    h.docEl.innerHTML = "<p>colour these words</p>";
    const p = h.docEl.firstElementChild!;
    select(p, 7, 12);
    h.tools.openMarkPalette();
    clickSwatch("Green");
    const mark = p.querySelector("mark")!;
    expect(mark.textContent).toBe("these");
    expect(mark.className).toBe("hl-green");
  });

  it("repainting an existing highlight replaces the colour instead of stacking it", () => {
    h.docEl.innerHTML = '<p>a <mark class="hl-yellow">word</mark> here</p>';
    const p = h.docEl.firstElementChild!;
    select(p.querySelector("mark")!);
    h.tools.openMarkPalette();
    clickSwatch("Blue");
    expect(p.querySelectorAll("mark")).toHaveLength(1);
    expect(p.querySelector("mark")!.className).toBe("hl-blue");
  });

  it("the caret inside a highlight, with nothing selected, takes it off", () => {
    h.docEl.innerHTML = '<p>a <mark class="hl-yellow">word</mark> here</p>';
    const p = h.docEl.firstElementChild!;
    caretIn(p.querySelector("mark")!, 2);
    h.tools.openMarkPalette();
    expect(p.querySelector("mark")).toBe(null);
    expect(p.textContent).toBe("a word here");
  });

  it("the clear swatch removes the highlight and keeps the words", () => {
    h.docEl.innerHTML = '<p>a <mark class="hl-pink">word</mark> here</p>';
    const p = h.docEl.firstElementChild!;
    select(p.querySelector("mark")!);
    h.tools.openMarkPalette();
    clickSwatch("Remove highlight");
    expect(p.querySelector("mark")).toBe(null);
    expect(p.textContent).toBe("a word here");
  });

  it("a selection across list items highlights each item on its own", () => {
    // One <mark> around both would take the items with it and leave a single
    // paragraph where the list was.
    h.docEl.innerHTML = "<ul><li>first item</li><li>second item</li></ul>";
    const items = h.docEl.querySelectorAll("li");
    const range = document.createRange();
    range.setStart(items[0].firstChild!, 0);
    range.setEnd(items[1].firstChild!, 6);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    h.tools.openMarkPalette();
    clickSwatch("Yellow");
    expect(h.docEl.querySelectorAll("li")).toHaveLength(2);
    expect(items[0].querySelector("mark")?.textContent).toBe("first item");
    expect(items[1].querySelector("mark")?.textContent).toBe("second");
  });
});

describe("clearing formatting", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("takes the formatting off the selection and leaves the words", () => {
    h.docEl.innerHTML = "<p><strong>bold</strong> and <em>italic</em></p>";
    const p = h.docEl.firstElementChild!;
    select(p);
    h.tools.clearFormatting();
    expect(p.querySelector("strong")).toBe(null);
    expect(p.querySelector("em")).toBe(null);
    expect(p.textContent).toBe("bold and italic");
  });

  it("links and images survive — they are content, not decoration", () => {
    h.docEl.innerHTML =
      '<p><strong>see</strong> <a href="setup.md">setup</a> <img src="a.png" alt="a"></p>';
    const p = h.docEl.firstElementChild!;
    select(p);
    h.tools.clearFormatting();
    expect(p.querySelector("strong")).toBe(null);
    expect(p.querySelector('a[href="setup.md"]')?.textContent).toBe("setup");
    expect(p.querySelector("img")?.getAttribute("src")).toBe("a.png");
  });

  it("with no selection the whole block under the caret is cleared", () => {
    h.docEl.innerHTML = "<p><em>every</em> <strong>word</strong> of it</p>";
    const p = h.docEl.firstElementChild!;
    caretIn(p.querySelector("em")!, 2);
    h.tools.clearFormatting();
    expect(p.innerHTML).toBe("every word of it");
  });

  it("leaves code blocks and formulas alone", () => {
    h.docEl.innerHTML =
      '<pre class="vcode"><code><span class="hljs-kw">def</span> f()</code></pre>';
    const pre = h.docEl.firstElementChild!;
    const before = pre.innerHTML;
    select(pre.querySelector("code")!);
    h.tools.clearFormatting();
    expect(pre.innerHTML).toBe(before);
  });

  it("a selection across list items does not merge them", () => {
    h.docEl.innerHTML = "<ul><li><strong>first</strong></li><li><em>second</em></li></ul>";
    const items = h.docEl.querySelectorAll("li");
    const range = document.createRange();
    range.setStart(items[0].querySelector("strong")!.firstChild!, 0);
    range.setEnd(items[1].querySelector("em")!.firstChild!, 6);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    h.tools.clearFormatting();
    // The DOM may keep an emptied wrapper where the selection began inside one;
    // what matters is the file, and the serializer drops those. Asserting on the
    // Markdown is asserting on what the author will actually read back.
    expect(serializeTopBlock(h.docEl.firstElementChild!)).toBe("- first\n- second\n");
    expect(h.docEl.querySelectorAll("li")).toHaveLength(2);
  });
});
