// @vitest-environment happy-dom
//
// What the visual editor counts as a block of the document.
//
// After every edit the editor lines the fresh render up against the blocks on
// screen, one for one, and patches only what changed — the block holding the
// caret is left alone, which is what keeps the caret alive. If the two lists
// disagree on how many blocks there are, it gives up and redraws the page from
// scratch, and the caret goes to the top of the document.
//
// So the counts have to agree, and they only do while every block the engine
// produces either carries a source line (it came from the file) or is one of
// the engine's own service blocks, which the editor knows to leave out. A page
// with a single footnote used to break exactly that: the footnote separator and
// the list of notes have no source line, so the lists were off by two for the
// life of the document and every keystroke redrew the whole page.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

/** The classes the editor recognises as the engine's own tail (editorCore). */
const SERVICE = ["footnotes-sep", "footnotes"];

function topBlocks(src: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return Array.from(host.children) as HTMLElement[];
}

function classify(src: string): { fromFile: string[]; service: string[]; stray: string[] } {
  const out = { fromFile: [] as string[], service: [] as string[], stray: [] as string[] };
  for (const el of topBlocks(src)) {
    const name = `${el.tagName.toLowerCase()}.${el.className || "-"}`;
    if (SERVICE.some((cls) => el.classList.contains(cls))) {
      out.service.push(name);
    } else if (el.hasAttribute("data-src-line")) {
      out.fromFile.push(name);
    } else {
      out.stray.push(name);
    }
  }
  return out;
}

describe("every rendered block is either the file's or the engine's own", () => {
  it("a page of ordinary blocks is all from the file", () => {
    const { fromFile, service, stray } = classify(
      "# Title\n\nA paragraph.\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
    expect(stray).toEqual([]);
    expect(service).toEqual([]);
    expect(fromFile.length).toBe(4);
  });

  it("a footnote adds a tail the editor knows to leave out", () => {
    // The two blocks below are drawn from the definitions, not written where
    // they appear. Counting them as document blocks is what redrew the page on
    // every keystroke of every page that has a note.
    const { service, stray } = classify("Text with a note[^1].\n\n[^1]: The note itself.\n");
    expect(service).toEqual(["hr.footnotes-sep", "section.footnotes"]);
    expect(stray).toEqual([]);
  });

  it.each([
    ["an abbreviation", "The HTML spec.\n\n*[HTML]: HyperText Markup Language\n"],
    ["a call-out", '!!! note "Title"\n\n    Body.\n'],
    ["content tabs", '=== "One"\n\n    First.\n\n=== "Two"\n\n    Second.\n'],
    ["a diagram", "```mermaid\nflowchart LR\n  A --> B\n```\n"],
    ["a definition list", "Term\n\n:   The definition.\n"],
    ["a task list", "- [x] done\n- [ ] not done\n"],
    ["a quote with a nested list", "> Quoted:\n>\n> - one\n> - two\n"],
    ["an image with attributes", '![Alt](pic.png){ width="300" }\n'],
    ["a formula", "$$\n\\frac{1}{2}\n$$\n"],
    ["a footnote and an abbreviation together", "HTML[^1]\n\n*[HTML]: Markup\n\n[^1]: Note.\n"],
  ])("%s leaves nothing the editor cannot account for", (_name, src) => {
    expect(classify(src).stray).toEqual([]);
  });
});
