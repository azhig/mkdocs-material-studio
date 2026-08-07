// @vitest-environment happy-dom
//
// What the two drop-down buttons of the toolbar say about the caret. Both
// labels are read off the DOM the engine produced, and both have cases where
// the obvious answer is wrong: the engine wraps quote text in a paragraph, so
// the caret in a quote sits in a `<p>`; and a task list is a `<ul>` like any
// other until you look at its items.

import { beforeAll, describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import {
  applyList,
  caretListItem,
  currentStyleTag,
  initParagraphStyle,
  toolbarListKind,
} from "../../webviews/visual/paragraphStyle";

const md = buildMarkdownEngine({
  resolveIcon: () => undefined,
  readSnippet: () => undefined,
});

const docEl = document.createElement("div");
docEl.id = "doc";

/** What an operation asked the editor to write back. */
const replaced: Array<{ start: number; end: number; lines: string[] }> = [];

beforeAll(() => {
  document.body.appendChild(docEl);
  initParagraphStyle({
    docEl,
    cmd: () => {},
    currentBlock: () => null,
    caretIntoBlock: () => {},
    rangedAncestor: (el) => el?.closest<HTMLElement>("[data-src-line]") ?? null,
    enclosingTag: (node, tagName) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest<HTMLElement>(tagName) ?? null;
    },
    indentOfLine: () => "",
    replaceLines: (start, end, lines) => replaced.push({ start, end, lines }),
    selectionLines: () => [],
    // The whole rendered document, so an operation on the selection has
    // somewhere to land instead of bailing out.
    selectionRange: () => ({ start: 0, end: 1 }),
  });
});

/** Renders Markdown and puts the caret inside the first element matching. */
function caretIn(src: string, selector: string): void {
  docEl.innerHTML = md.render(src);
  const el = docEl.querySelector(selector);
  if (!el) throw new Error(`no ${selector} in ${JSON.stringify(src)}`);
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe("what the style button says", () => {
  it.each([
    ["Text.\n", "p", "p"],
    ["# Title\n", "h1", "h1"],
    ["### Third\n", "h3", "h3"],
    ["###### Sixth\n", "h6", "h6"],
  ])("for %s", (src, selector, expected) => {
    caretIn(src, selector);
    expect(currentStyleTag()).toBe(expected);
  });

  it("says quote for the paragraph the engine wrapped the quote text in", () => {
    // The caret is in a <p>; answering “p” would offer to turn a quote into a
    // paragraph by doing nothing visible.
    caretIn("> Quoted.\n", "blockquote p");
    expect(currentStyleTag()).toBe("blockquote");
  });

  it("says normal text when the caret is outside the document", () => {
    // A heading, so that ignoring the boundary would visibly answer “h2”.
    docEl.innerHTML = "<p>Inside.</p>";
    const stray = document.createElement("h2");
    stray.textContent = "Outside.";
    document.body.appendChild(stray);
    const range = document.createRange();
    range.selectNodeContents(stray);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(currentStyleTag()).toBe("p");
    stray.remove();
  });
});

describe("what the list button would make", () => {
  it("sees the item the caret is in", () => {
    caretIn("- one\n- two\n", "li");
    expect(caretListItem()?.textContent).toContain("one");
  });

  it("sees no item outside a list", () => {
    caretIn("Text.\n", "p");
    expect(caretListItem()).toBeNull();
  });

  it("sees no item in a list that is not in the document", () => {
    caretIn("Text.\n", "p");
    const stray = document.createElement("ul");
    stray.innerHTML = "<li>Elsewhere.</li>";
    document.body.appendChild(stray);
    const range = document.createRange();
    range.selectNodeContents(stray.querySelector("li") as HTMLElement);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(caretListItem()).toBeNull();
    stray.remove();
  });

  it.each([
    ["- one\n", "ul"],
    ["1. one\n", "ol"],
    ["- [ ] one\n", "task"],
  ])("reads %s as %s", (src, expected) => {
    caretIn(src, "li");
    expect(toolbarListKind()).toBe(expected);
  });

  it("outside a list, offers the kind last applied — not the last one seen", () => {
    // Visiting a task list does not make the button offer task lists: the
    // memory is of what the author chose, not of where the caret wandered.
    caretIn("- [x] done\n", "li");
    expect(toolbarListKind()).toBe("task");
    caretIn("Just text.\n", "p");
    expect(toolbarListKind()).toBe("ul");

    applyList("ol");
    caretIn("Still text.\n", "p");
    expect(toolbarListKind()).toBe("ol");
  });
});
