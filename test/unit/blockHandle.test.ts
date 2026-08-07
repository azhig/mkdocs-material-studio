// @vitest-environment happy-dom
//
// The rules the block handle answers before it draws anything: which block a
// click belongs to, which blocks that one may be reordered among, where a drop
// would land, and what the block is called in the menu header.
//
// The documents are rendered by the real Markdown engine, so the DOM here is
// the DOM the editor gets — nesting, class names and all.

import { beforeAll, describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import {
  blockAncestors,
  blockTypeName,
  dropTargetAt,
  handleBlockOf,
  initBlockHandle,
  movableSiblings,
} from "../../webviews/visual/blockHandle";

const md = buildMarkdownEngine({
  resolveIcon: () => undefined,
  readSnippet: () => undefined,
});

const docEl = document.createElement("div");
docEl.id = "doc";

beforeAll(() => {
  document.body.appendChild(docEl);
  initBlockHandle({
    docEl,
    topBlockOf: (node) => (node instanceof Element ? node.closest("#doc > *") : null),
    rangedAncestor: (el) => el?.closest<HTMLElement>("[data-src-line]") ?? null,
    indentOfLine: () => "",
    replaceLines: () => {},
    insertMarkdownBlock: () => {},
    openIslandEditor: () => {},
    hideTip: () => {},
    renderQuickMenu: () => {},
    isInlineCode: () => false,
    codeMenuItems: () => [],
    fenceInfoOf: (block) => ({ lang: block.getAttribute("data-lang") ?? "" }),
  });
});

/** Renders Markdown into the document the handle works on. */
function load(src: string): HTMLElement[] {
  docEl.innerHTML = md.render(src);
  // The renders in the editor carry line numbers; the handle uses them to tell
  // a block with a place in the file from a wrapper that has none.
  let line = 0;
  for (const el of Array.from(docEl.querySelectorAll<HTMLElement>("*"))) {
    if (!el.closest("table, li") || el.tagName === "TABLE") {
      el.setAttribute("data-src-line", String(line++));
    }
  }
  return Array.from(docEl.children) as HTMLElement[];
}

/** The first element matching the selector. */
function pick(selector: string): HTMLElement {
  const el = docEl.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector} in the rendered document`);
  return el;
}

describe("which block a node belongs to", () => {
  it("is the top-level block for text in the document", () => {
    load("First paragraph.\n\nSecond paragraph.\n");
    const second = docEl.children[1];
    expect(handleBlockOf(second.firstChild)).toBe(second);
  });

  it("is the nested block inside a call-out, not the call-out", () => {
    load('!!! note "Title"\n\n    Body of the note.\n');
    const body = pick(".admonition p:not(.admonition-title)");
    expect(handleBlockOf(body.firstChild)).toBe(body);
  });

  it("stops at the table: rows and cells are the table menu's business", () => {
    load("| a | b |\n| - | - |\n| 1 | 2 |\n");
    const cell = pick("td");
    expect(handleBlockOf(cell.firstChild)).toBe(pick("table"));
  });

  it("stops at the table even when a cell holds a block that would qualify", () => {
    // A quote inside a cell: its paragraph sits directly in a container the
    // handle normally enters, so without the table short-circuit the handle
    // would offer to move a paragraph out of a table cell.
    load("Text.\n");
    const table = document.createElement("table");
    table.setAttribute("data-src-line", "1");
    table.innerHTML =
      '<tbody><tr><td><blockquote data-src-line="2"><p data-src-line="2">Quoted.</p></blockquote></td></tr></tbody>';
    docEl.appendChild(table);
    const inner = pick("td p");
    expect(handleBlockOf(inner.firstChild)).toBe(table);
  });

  it("does not descend into a list item", () => {
    load("- one\n- two\n");
    const item = pick("li");
    expect(handleBlockOf(item.firstChild)).toBe(pick("ul"));
  });

  it("is nothing for a node outside the document", () => {
    load("Text.\n");
    const stray = document.createElement("p");
    document.body.appendChild(stray);
    expect(handleBlockOf(stray)).toBeNull();
    stray.remove();
  });
});

describe("what a block can be reordered among", () => {
  it("is its own siblings at the top level", () => {
    const blocks = load("One.\n\nTwo.\n\nThree.\n");
    expect(movableSiblings(blocks[1])).toEqual(blocks);
  });

  it("is the neighbours inside the call-out, never the document's blocks", () => {
    load("Before.\n\n!!! note\n\n    First.\n\n    Second.\n\nAfter.\n");
    const inside = Array.from(
      docEl.querySelectorAll<HTMLElement>(".admonition > p:not(.admonition-title)"),
    );
    expect(inside).toHaveLength(2);
    expect(movableSiblings(inside[0])).toEqual(inside);
  });

  it("leaves the call-out's own title out: it is not a block that moves", () => {
    load('!!! note "Title"\n\n    Body.\n');
    const body = pick(".admonition p:not(.admonition-title)");
    expect(movableSiblings(body).some((el) => el.classList.contains("admonition-title"))).toBe(
      false,
    );
  });

  it("is empty inside a container the handle does not enter", () => {
    load("- one\n- two\n");
    expect(movableSiblings(pick("li"))).toEqual([]);
  });

  it("skips the footnote separator and the footnote list", () => {
    load("Text with a note.[^1]\n\n[^1]: The note.\n");
    const paragraph = docEl.children[0] as HTMLElement;
    const siblings = movableSiblings(paragraph);
    expect(siblings).toContain(paragraph);
    expect(siblings.some((el) => el.classList.contains("footnotes"))).toBe(false);
    expect(siblings.some((el) => el.classList.contains("footnotes-sep"))).toBe(false);
  });
});

describe("where a drop lands", () => {
  /** A stand-in for laid-out blocks: happy-dom gives every element a zero box. */
  function boxed(tops: number[]): HTMLElement[] {
    return tops.map((top) => {
      const el = document.createElement("p");
      el.getBoundingClientRect = () =>
        ({ top, height: 20, bottom: top + 20 }) as unknown as DOMRect;
      return el;
    });
  }

  it("is before the block whose upper half the pointer is over", () => {
    const blocks = boxed([0, 40, 80]);
    expect(dropTargetAt(blocks, 45)).toBe(blocks[1]);
  });

  it("is the next block once the pointer passes the midpoint", () => {
    const blocks = boxed([0, 40, 80]);
    expect(dropTargetAt(blocks, 51)).toBe(blocks[2]);
  });

  it("is the end of the list below everything", () => {
    expect(dropTargetAt(boxed([0, 40, 80]), 500)).toBeNull();
  });

  it("is the first block above everything", () => {
    const blocks = boxed([0, 40, 80]);
    expect(dropTargetAt(blocks, -100)).toBe(blocks[0]);
  });
});

describe("what the menu calls a block", () => {
  it.each([
    ["# Heading\n", "h1", "Heading 1"],
    ["Text.\n", "p", "Paragraph"],
    ["- one\n", "ul", "Bulleted list"],
    ["1. one\n", "ol", "Numbered list"],
    ["- [ ] task\n", "ul", "Task list"],
    ["> quoted\n", "blockquote", "Quote"],
    ["| a |\n| - |\n", "table", "Table"],
    ["---\n\ntext\n", "hr", "Divider"],
  ])("names %s as “%s”", (src, selector, expected) => {
    load(src);
    expect(blockTypeName(pick(selector))).toBe(expected);
  });

  it("names a call-out by its kind", () => {
    load("!!! warning\n\n    Careful.\n");
    expect(blockTypeName(pick(".admonition"))).toBe("Call-out: Warning");
  });

  it("names a code block by its language", () => {
    load("Text.\n");
    const block = document.createElement("div");
    block.className = "highlight";
    block.setAttribute("data-lang", "python");
    expect(blockTypeName(block)).toBe("Code block: python");
  });

  it("names a code block without a language plainly", () => {
    const block = document.createElement("div");
    block.className = "highlight";
    expect(blockTypeName(block)).toBe("Code block");
  });

  it("calls a paragraph that holds only an image an image", () => {
    load("![alt](a.png)\n");
    expect(blockTypeName(docEl.children[0] as HTMLElement)).toBe("Image");
  });
});

describe("the containers around a block", () => {
  it("are listed from the nearest outwards", () => {
    load("> !!! note\n>\n>     Deep.\n");
    const deep = pick(".admonition p:not(.admonition-title)");
    expect(blockAncestors(deep)).toEqual([pick(".admonition"), pick("blockquote")]);
  });

  it("are none for a block at the top level", () => {
    const blocks = load("Alone.\n");
    expect(blockAncestors(blocks[0])).toEqual([]);
  });
});
