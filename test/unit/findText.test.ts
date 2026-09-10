// @vitest-environment happy-dom
//
// The page as text the finder can work on, and the way back from a match to
// the DOM. What is left out matters as much as what is collected: the copy
// button of a code block is not content, and the hidden carrier that holds the
// footnote definitions says everything the notes at the bottom of the page
// already say — counting it reported every footnote twice.

import { beforeEach, describe, expect, it } from "vitest";
import { findMatches } from "../../webviews/shared/findModel";
import {
  chunkTexts,
  collectChunks,
  rangeOfMatch,
  revealMatch,
} from "../../webviews/shared/findText";

let root: HTMLElement;

function build(html: string): void {
  document.body.innerHTML = `<div id="doc">${html}</div>`;
  root = document.getElementById("doc") as HTMLElement;
}

/** The text of the page as the finder sees it. */
function text(): string {
  return chunkTexts(collectChunks(root)).join("");
}

/** What the match covers in the DOM, read back through its range. */
function matched(query: string): string[] {
  const chunks = collectChunks(root);
  return findMatches(chunkTexts(chunks), query).map(
    (m) => rangeOfMatch(chunks, m)?.toString() ?? "",
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("collecting the text of a page", () => {
  it("keeps a sentence whole across the tags inside it", () => {
    build("<p>A <b>bold</b> word</p>");
    expect(text()).toBe("A bold word");
    expect(matched("a bold word")).toEqual(["A bold word"]);
  });

  it("separates blocks so no match can run between them", () => {
    build("<p>Read the</p><p>me first</p>");
    expect(matched("theme")).toEqual([]);
    expect(text()).toBe("Read the\nme first");
  });

  it("separates the cells of a table and the items of a list", () => {
    build("<table><tr><td>one</td><td>two</td></tr></table><ul><li>a</li><li>b</li></ul>");
    expect(matched("onetwo")).toEqual([]);
    expect(matched("ab")).toEqual([]);
  });

  it("leaves out the interface drawn around the content", () => {
    build(
      '<div class="highlight"><div class="md-code__nav"><button>Copy code</button></div>' +
        "<pre><code>print</code></pre></div>" +
        '<div class="isl-tools"><button>Edit</button></div>',
    );
    expect(text()).not.toContain("Copy");
    expect(text()).not.toContain("Edit");
    expect(text()).toContain("print");
  });

  it("leaves out a hidden carrier block", () => {
    // The footnote definitions live twice on the page: in this carrier, kept so
    // an edit cannot lose them, and in the notes drawn at the bottom.
    build(
      '<div class="footnote-defs" hidden><p>The note itself</p></div>' +
        "<ol><li>The note itself</li></ol>",
    );
    expect(matched("the note itself")).toEqual(["The note itself"]);
  });

  it("searches a folded call-out and an unopened tab all the same", () => {
    build(
      "<details><summary>Folded</summary><p>Hidden treasure</p></details>" +
        '<div class="tabbed-set"><input type="radio" name="__tabbed_1" checked><input type="radio" name="__tabbed_1">' +
        '<div class="tabbed-content"><div class="tabbed-block"><p>First tab</p></div>' +
        '<div class="tabbed-block"><p>Second tab</p></div></div></div>',
    );
    expect(matched("hidden treasure")).toEqual(["Hidden treasure"]);
    expect(matched("second tab")).toEqual(["Second tab"]);
  });
});

describe("the range of a match", () => {
  it("spans the text nodes the match is split across", () => {
    build("<p>sen<b>tence</b> ends</p>");
    const chunks = collectChunks(root);
    const range = rangeOfMatch(chunks, findMatches(chunkTexts(chunks), "sentence")[0]);
    expect(range?.toString()).toBe("sentence");
    expect(range?.startContainer.nodeValue).toBe("sen");
    expect(range?.endContainer.nodeValue).toBe("tence");
    expect(range?.endOffset).toBe(5);
  });
});

describe("opening what hides a match", () => {
  it("opens a folded call-out", () => {
    build("<details><summary>Folded</summary><p>Hidden treasure</p></details>");
    const target = root.querySelector("p")?.firstChild as Node;
    expect(revealMatch(target, root)).toBe(true);
    expect(root.querySelector("details")?.open).toBe(true);
    // Already open: nothing to change, and the editor must not be told a DOM
    // change happened when none did.
    expect(revealMatch(target, root)).toBe(false);
  });

  it("selects the tab a match sits in", () => {
    build(
      '<div class="tabbed-set"><input type="radio" name="__tabbed_1" checked><input type="radio" name="__tabbed_1">' +
        '<div class="tabbed-content"><div class="tabbed-block"><p>First tab</p></div>' +
        '<div class="tabbed-block"><p>Second tab</p></div></div></div>',
    );
    const second = root.querySelectorAll("p")[1].firstChild as Node;
    expect(revealMatch(second, root)).toBe(true);
    const inputs = root.querySelectorAll<HTMLInputElement>("input");
    expect(inputs[1].checked).toBe(true);
    expect(inputs[0].checked).toBe(false);
  });
});
