// @vitest-environment happy-dom
//
// A block written as HTML with the markdown attribute — `<details markdown="1">`
// around a table is the common one in documentation, next to Material's own
// `<div class="grid cards" markdown>`.
//
// Two things have to hold for such a block, and both were broken for
// `<details>`: the Markdown inside it has to be rendered (otherwise a table
// shows up as the pipes and dashes it is written with), and the block has to
// carry the source line it came from. The line is what tells the editor this is
// the author's block: a block without one is taken for something the engine
// drew by itself, which is left out of the file — and, before that was
// understood, threw the block count off and made every edit redraw the page.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock } from "../../webviews/visual/htmlToMd";

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

function blocks(src: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return Array.from(host.children) as HTMLElement[];
}

const COLLAPSIBLE_TABLE = `Before.

<details markdown="1">
<summary>Show the table</summary>

| Code | What it means |
| ---- | ------------- |
| 11 | Nothing found |

</details>

After.
`;

describe("a collapsible section written as HTML", () => {
  it("renders the Markdown inside it", () => {
    const details = blocks(COLLAPSIBLE_TABLE)[1];
    expect(details.tagName).toBe("DETAILS");
    expect(details.querySelector("summary")?.textContent).toBe("Show the table");
    expect(details.querySelector("table")).not.toBeNull();
    expect(details.textContent).not.toContain("| ----");
  });

  it("carries the lines of the file it came from", () => {
    // Without this the editor takes it for a block of the engine's own making:
    // not the author's, not written back, and not counted as part of the page.
    const details = blocks(COLLAPSIBLE_TABLE)[1];
    expect(details.getAttribute("data-src-line")).toBe("2");
    expect(details.getAttribute("data-src-end")).toBe("10");
  });

  it("goes back into the file as the author wrote it", () => {
    const details = blocks(COLLAPSIBLE_TABLE)[1];
    expect(serializeTopBlock(details)).toBe(
      '<details markdown="1">\n' +
        "<summary>Show the table</summary>\n" +
        "\n" +
        "| Code | What it means |\n" +
        "| ---- | ------------- |\n" +
        "| 11 | Nothing found |\n" +
        "\n" +
        "</details>\n",
    );
  });

  it("keeps the opening tag it was written with, attributes and all", () => {
    const src = '<details class="tight" open markdown="1">\n\nText.\n\n</details>\n';
    expect(serializeTopBlock(blocks(src)[0]).split("\n")[0]).toBe(
      '<details class="tight" open markdown="1">',
    );
  });

  it.each([
    ["section", '<section markdown="1">\n\n# Inside\n\n</section>\n'],
    ["article", '<article markdown="1">\n\nText.\n\n</article>\n'],
    ["aside", '<aside markdown="1">\n\nText.\n\n</aside>\n'],
  ])("works for <%s> as well, closing with its own tag", (tag, src) => {
    const el = blocks(src)[0];
    expect(el.tagName.toLowerCase()).toBe(tag);
    expect(el.getAttribute("data-src-line")).toBe("0");
    expect(serializeTopBlock(el).trimEnd().split("\n").at(-1)).toBe(`</${tag}>`);
  });

  it("leaves HTML without the attribute as the raw HTML it is", () => {
    // Nothing claims to understand it: no source line, and the editor treats it
    // as a block of the engine's — shown, kept, and never written back.
    const el = blocks("<details>\n<summary>Plain</summary>\nText\n</details>\n")[0];
    expect(el.tagName).toBe("DETAILS");
    expect(el.hasAttribute("data-src-line")).toBe(false);
  });
});
