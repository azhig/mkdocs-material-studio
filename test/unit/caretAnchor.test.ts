// @vitest-environment happy-dom
//
// The caret has to survive a full render. Until this module existed it did not:
// an edit made outside the editor redrew every block, the selection was left at
// the start of #doc, and the next keystroke went into the first paragraph of
// the file — with the page scrolled to the top under it.
//
// happy-dom measures nothing (every rectangle is zero), so the scroll half is
// checked in the harness; what is checked here is the half that decides where
// the caret lands.

import { beforeEach, describe, expect, it } from "vitest";
import { restoreCaretAnchor, takeCaretAnchor } from "../../webviews/visual/caretAnchor";

let docEl: HTMLElement;

/** The editor with a rendered document in it. */
function render(html: string): void {
  docEl.innerHTML = html;
}

/** Puts the caret `offset` characters into the text of the n-th block. */
function caretInto(index: number, offset: number): void {
  const block = docEl.children[index];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let seen = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (seen + node.data.length >= offset) {
      const range = document.createRange();
      range.setStart(node, offset - seen);
      range.collapse(true);
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return;
    }
    seen += node.data.length;
  }
  throw new Error(`block ${index} has fewer than ${offset} characters`);
}

/** Where the caret is now: the block's position and the text before it. */
function caretAt(): { index: number; before: string } | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  const range = sel.getRangeAt(0);
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== docEl) {
    node = node.parentNode;
  }
  if (!(node instanceof HTMLElement)) {
    return null;
  }
  const upToCaret = document.createRange();
  upToCaret.selectNodeContents(node);
  upToCaret.setEnd(range.startContainer, range.startOffset);
  return {
    index: Array.prototype.indexOf.call(docEl.children, node),
    before: upToCaret.toString(),
  };
}

const PAGE =
  '<h1 data-src-line="0">Title</h1>' +
  '<p data-src-line="2">The first paragraph of the page.</p>' +
  '<p data-src-line="4">The second one, where the caret is.</p>';

beforeEach(() => {
  document.body.innerHTML = "";
  docEl = document.createElement("div");
  docEl.id = "doc";
  docEl.setAttribute("contenteditable", "true");
  document.body.appendChild(docEl);
  document.getSelection()?.removeAllRanges();
});

describe("the caret across a full render", () => {
  it("comes back to the same place in the same block", () => {
    render(PAGE);
    caretInto(2, 15);
    const anchor = takeCaretAnchor(docEl);

    render(PAGE); // the extension sent the document again

    expect(restoreCaretAnchor(docEl, anchor)).toBe(true);
    expect(caretAt()).toEqual({ index: 2, before: "The second one," });
  });

  it("follows its block when a render puts another one above it", () => {
    render(PAGE);
    caretInto(2, 15);
    const anchor = takeCaretAnchor(docEl);

    // Someone added a paragraph at the top of the file. Every block below it
    // moved down a place AND got a new source line — the line the author was in
    // is recognised by what it says.
    render(
      '<p data-src-line="0">Added from outside.</p>' +
        '<h1 data-src-line="2">Title</h1>' +
        '<p data-src-line="4">The first paragraph of the page.</p>' +
        '<p data-src-line="6">The second one, where the caret is.</p>',
    );

    expect(restoreCaretAnchor(docEl, anchor)).toBe(true);
    expect(caretAt()).toEqual({ index: 3, before: "The second one," });
  });

  it("picks the repeated line nearest to where the caret was", () => {
    // A document says the same short thing in several places; only position
    // tells the author's line from its twin.
    const twins = (from: number): string =>
      `<h1 data-src-line="${from}">Title</h1>` +
      `<p data-src-line="${from + 2}">See the note below.</p>` +
      `<h2 data-src-line="${from + 4}">Second part</h2>` +
      `<p data-src-line="${from + 6}">Some other paragraph entirely.</p>` +
      `<p data-src-line="${from + 8}">See the note below.</p>`;
    render(twins(0));
    caretInto(1, 4); // the first of the twins
    const anchor = takeCaretAnchor(docEl);

    render('<p data-src-line="0">Added from outside.</p>' + twins(2));

    expect(restoreCaretAnchor(docEl, anchor)).toBe(true);
    expect(caretAt()).toEqual({ index: 2, before: "See " });
  });

  it("stays in its block when the render rewrote the line itself", () => {
    render(PAGE);
    caretInto(2, 15);
    const anchor = takeCaretAnchor(docEl);

    // A formatter ran over the file on save: the block is where it was, but
    // nothing of its text matches any more.
    render(
      '<h1 data-src-line="0">Title</h1>' +
        '<p data-src-line="2">The first paragraph of the page.</p>' +
        '<p data-src-line="4">Wrapped by a formatter, every word different.</p>',
    );

    expect(restoreCaretAnchor(docEl, anchor)).toBe(true);
    expect(caretAt()).toEqual({ index: 2, before: "Wrapped by a fo" });
  });

  it("counts only the text the author typed, not what the engine drew", () => {
    const line = (keys: string): string =>
      '<p data-src-line="0">Press ' +
      `<span contenteditable="false" data-keys="Cmd+S">${keys}</span>` +
      " to save.</p>";
    render(line("<kbd>Cmd</kbd>+<kbd>S</kbd>"));
    // Three characters past the drawn combination: “Press ” + “ to”.
    const tail = docEl.querySelector("p")?.lastChild as Text;
    const range = document.createRange();
    range.setStart(tail, 3);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    const anchor = takeCaretAnchor(docEl);
    expect(anchor?.offset).toBe(9); // not 14 — the <kbd>s are not the author's text

    // The same line with the combination drawn differently: what the engine put
    // there changed, what the author typed did not.
    render(line("<kbd>⌘</kbd><kbd>S</kbd>"));

    expect(restoreCaretAnchor(docEl, anchor)).toBe(true);
    const after = document.getSelection()?.getRangeAt(0);
    expect((after?.startContainer as Text).data).toBe(" to save.");
    expect(after?.startOffset).toBe(3);
  });

  it("lands at the end of a block that came back shorter", () => {
    render(PAGE);
    caretInto(2, 30);
    const anchor = takeCaretAnchor(docEl);

    render(
      '<h1 data-src-line="0">Title</h1>' +
        '<p data-src-line="2">The first paragraph of the page.</p>' +
        '<p data-src-line="4">Cut.</p>',
    );

    expect(restoreCaretAnchor(docEl, anchor)).toBe(true);
    expect(caretAt()).toEqual({ index: 2, before: "Cut." });
  });

  it("keeps out of the way when the caret was not in the document", () => {
    render(PAGE);
    expect(takeCaretAnchor(docEl)).toBeNull();
    expect(restoreCaretAnchor(docEl, null)).toBe(false);
    expect(caretAt()).toBeNull();
  });

  it("keeps out of the way when the caret was in another editor", () => {
    render(PAGE);
    const outside = document.createElement("div");
    outside.textContent = "A note being edited over the page.";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.setStart(outside.firstChild as Text, 3);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    expect(takeCaretAnchor(docEl)).toBeNull();
  });
});
