// @vitest-environment happy-dom
//
// “Clear formatting”: stripping inline styling from a selection. We test it
// against the real engine render — exactly what the editor sees — and through
// serialization back to Markdown.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock } from "../../webviews/visual/htmlToMd";
import { clearRangePiece, stripInlineFormatting } from "../../webviews/visual/inlineFormat";

const md = buildMarkdownEngine({
  resolveIcon: () => undefined,
  readSnippet: () => undefined,
});

function renderBlocks(src: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  document.body.appendChild(host); // closest() and Range need an attached DOM
  return Array.from(host.children) as HTMLElement[];
}

/** Leaf block (paragraph, heading, list item, cell) inside an element. */
function leaf(el: HTMLElement, selector = "p, h1, h2, h3, h4, h5, h6, li, td, th"): HTMLElement {
  return (el.matches(selector) ? el : el.querySelector<HTMLElement>(selector)) as HTMLElement;
}

/** Clear a whole block and return its Markdown. */
function clearWhole(src: string, pick: (blocks: HTMLElement[]) => HTMLElement): string {
  const blocks = renderBlocks(src);
  const block = pick(blocks);
  const range = document.createRange();
  range.selectNodeContents(block);
  clearRangePiece(range, block);
  const top = blocks.find((b) => b === block || b.contains(block)) as HTMLElement;
  return serializeTopBlock(top);
}

describe("clearing formatting", () => {
  it("strips bold, italic, strikethrough, code, highlight and underline", () => {
    const src = "Here **bold**, *italic*, ~~struck out~~, `code`, ==mark== and ^^insert^^.\n";
    expect(clearWhole(src, (b) => leaf(b[0]))).toBe(
      "Here bold, italic, struck out, code, mark and insert.\n",
    );
  });

  it("keeps links and images — that is content, not styling", () => {
    const src = "Text with **[a link](http://a.b)** and ![a picture](i.png).\n";
    expect(clearWhole(src, (b) => leaf(b[0]))).toBe(
      "Text with [a link](http://a.b) and ![a picture](i.png).\n",
    );
  });

  it("leaves CriticMarkup edits and emojis alone", () => {
    const src =
      "Edits {++insert++}, {--removal--}, {==highlight==} and :smile: next to with **bold**.\n";
    expect(clearWhole(src, (b) => leaf(b[0]))).toBe(
      "Edits {++insert++}, {--removal--}, {==highlight==} and :smile: next to with bold.\n",
    );
  });

  it("does not destroy a footnote (its <sup> is a link to the definition, not styling)", () => {
    // The editor does not serialize a paragraph with a footnote (the label cannot be restored), but
    // clearing must not break it in the DOM either.
    const [p] = renderBlocks("Text with a footnote[^1] and **bold**.\n\n[^1]: A note.\n");
    const range = document.createRange();
    range.selectNodeContents(p);
    clearRangePiece(range, p);
    expect(p.querySelector("sup.footnote-ref a")).not.toBeNull();
    expect(p.querySelector("strong")).toBeNull();
  });

  it("clears a list item without breaking the structure", () => {
    const src = "- First **item**\n- Second *item*\n";
    const [list] = renderBlocks(src);
    for (const li of Array.from(list.querySelectorAll("li"))) {
      const range = document.createRange();
      range.selectNodeContents(li);
      clearRangePiece(range, li);
    }
    expect(serializeTopBlock(list)).toBe("- First item\n- Second item\n");
  });

  it("a selection partly inside markup: the wrapper is split at the edges", () => {
    const [p] = renderBlocks("A word **bold whole** here.\n");
    const strong = p.querySelector("strong") as HTMLElement;
    const text = strong.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 8);
    clearRangePiece(range, p);
    expect(serializeTopBlock(p)).toBe("A word **bo**ld who**le** here.\n");
  });

  it("nested styling is removed completely", () => {
    const src = "Text ***bold italic*** and **bold with `code`**.\n";
    expect(clearWhole(src, (b) => leaf(b[0]))).toBe("Text bold italic and bold with code.\n");
  });

  it("in a table cell only that cell is cleared", () => {
    const src = "| A | B |\n| --- | --- |\n| **bold** | *italic* |\n";
    const [table] = renderBlocks(src);
    const td = table.querySelector("td") as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(td);
    clearRangePiece(range, td);
    expect(serializeTopBlock(table)).toBe("| A | B |\n| --- | --- |\n| bold | *italic* |\n");
  });

  it("stripInlineFormatting removes contenteditable junk", () => {
    const host = document.createElement("p");
    host.innerHTML = '<span style="font-weight:700">bold</span><font color="red">colour</font>';
    stripInlineFormatting(host);
    expect(host.innerHTML).toBe("<span>bold</span>colour");
  });
});
