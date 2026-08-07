// @vitest-environment happy-dom
//
// Documents written BY HAND (not by our editor): we check that opening
// and editing do not rewrite someone else's formatting. The guarantee is per-block — the editor
// re-serializes only the changed blocks, so what matters here is which blocks
// come back byte for byte and which are canonicalized (deliberately).

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock, canSerialize } from "../../webviews/visual/htmlToMd";

const md = buildMarkdownEngine({
  resolveIcon: (code) => (code.startsWith("material-") ? '<svg><path d="M0"/></svg>' : undefined),
  readSnippet: () => undefined,
});

/** Top-level blocks and their source slices. */
function blocks(src: string): Array<{ el: HTMLElement; slice: string }> {
  const lines = src.split("\n");
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return (Array.from(host.children) as HTMLElement[])
    .filter((el) => el.hasAttribute("data-src-line"))
    .map((el) => {
      const start = Number(el.getAttribute("data-src-line"));
      const end = Number(el.getAttribute("data-src-end"));
      return { el, slice: lines.slice(start, end).join("\n").replace(/\n+$/, "") + "\n" };
    });
}

/** Every block is restored byte for byte (“opened and left untouched”). */
function expectStable(src: string): void {
  for (const { el, slice } of blocks(src)) {
    if (!canSerialize(el)) {
      continue; // the block is editable only as text — the editor never rewrites it
    }
    expect(serializeTopBlock(el), `<${el.tagName.toLowerCase()}>`).toBe(slice);
  }
}

/** HTML without service markup — for the “the page looks the same” comparison. */
function renderNormalized(src: string): string {
  return md
    .render(src)
    .replace(
      / data-(src-line|src-end|block-type|marker|setext|fence|delim-row|auto-id)="[^"]*"/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The main guarantee: even if the source form is canonicalized, the PAGE does not change —
 * the document reassembled from blocks renders to the same HTML.
 */
function expectSamePage(src: string): void {
  const rebuilt = blocks(src)
    .map(({ el, slice }) => (canSerialize(el) ? serializeTopBlock(el) : slice))
    .join("\n");
  expect(renderNormalized(rebuilt), "page changed after a rebuild").toBe(renderNormalized(src));
}

describe("handwritten markdown: the page does not change after reassembly", () => {
  const samples = [
    "* an asterisk\n* second\n",
    "1) once\n2) two\n",
    "Heading setext\n===\n",
    "~~~python\nx = 1\n~~~\n",
    "| A | B |\n|:--|--:|\n| 1 | 2 |\n",
    "| Parameter | Value |\n|:---------|---------:|\n| `debug`  |    false |\n",
    "Entities: &amp; &lt; &gt; and characters < > in text.\n",
    "Variable snake_case_name, path some_dir/file.md.\n",
    "Text with \\*an asterisk\\* and \\_an underscore\\_.\n",
    "> A quote.\n>\n> - item\n> - second\n",
    '!!! danger "Watch out"\n    Text with `code`.\n',
    '=== "First"\n\n    Text.\n\n=== "Second"\n\n    | A |\n    | --- |\n    | 1 |\n',
    "- parent\n    - child\n        - grandchild\n- sibling\n",
    "Term\n\n:   Definition.\n",
    "- [x] done\n- [ ] no\n",
  ];
  for (const src of samples) {
    it(`page matches: ${JSON.stringify(src.slice(0, 34))}…`, () => {
      expectSamePage(src);
    });
  }
});

describe("handwritten markdown: opened and left untouched — the file does not change", () => {
  it("lists with different markers and indents", () => {
    expectStable("* an asterisk\n* second\n");
    expectStable("+ plus\n+ second\n");
    expectStable("1) round bracket\n2) second\n");
    expectStable("- one\n\n- free list\n\n- third\n");
  });

  it("headings, including ones with an anchor and without blank lines around", () => {
    expectStable("# Heading\nText at once under heading.\n");
    expectStable("## Section { #custom-anchor }\n\nText.\n");
    expectStable("Heading in the style setext\n===\n\nText.\n");
  });

  it("code: tildes, long fences, inner indentation", () => {
    expectStable("~~~python\nx = 1\n~~~\n");
    expectStable("````\n```\nnested a fence\n```\n````\n");
    expectStable("```js\nfunction f() {\n    return 1;\n}\n```\n");
  });

  it("tables with alignment and “ragged” columns", () => {
    expectStable("| A | B |\n|:--|--:|\n| 1 | 2 |\n");
    expectStable("| Heading | More |\n| --- | --- |\n| a long cell | to |\n");
  });

  it("blockquotes, nested blockquotes and a blockquote with a list", () => {
    expectStable("> A quote.\n>\n> Second paragraph of the quote.\n");
    expectStable("> Outer\n>\n> > Nested\n");
    expectStable("> - item in the quote\n> - second\n");
  });

  it("admonition: different types, collapsed, without a title", () => {
    expectStable('!!! danger "Watch out"\n    Text.\n');
    expectStable("??? info\n    Collapsed.\n");
    expectStable('!!! note ""\n    Without heading.\n');
    expectStable("???+ tip\n    Expanded.\n");
  });

  it("content tabs, grids and raw HTML", () => {
    expectStable('=== "First"\n\n    Text.\n\n=== "Second"\n\n    Text.\n');
    expectStable('<div class="grid cards" markdown>\n\n- A card\n\n</div>\n');
  });

  it("inline: footnotes, abbreviations, critic, keys, icons", () => {
    expectStable("Text with ==a highlight== and `code`, ~~struck out~~.\n");
    expectStable("Press ++ctrl+alt+del++ to reboot.\n");
    expectStable("An icon :material-star: in text.\n");
    expectStable("A link [text](https://example.com/a_b_c) and *italic*.\n");
  });

  it("escaping and special characters are not distorted", () => {
    expectStable("An asterisk \\* and an underscore \\_ escaped.\n");
    expectStable("Variable snake_case_name and path some_dir/file_name.md.\n");
    expectStable("Characters < and > in text.\n");
  });

  it("HTML entities are expanded into characters (same render)", () => {
    // Deliberate canonicalization: `&lt;` → `\<`. Both forms give the same
    // text on the page; only the edited block is touched.
    const [{ el }] = blocks("Entities: &amp; &lt; &gt; in text.\n");
    expect(serializeTopBlock(el)).toBe("Entities: & < > in text.\n");
  });

  it("formulas and diagrams", () => {
    expectStable("$$\nE = mc^2\n$$\n");
    expectStable("```mermaid\ngraph TD\n    A --> B\n```\n");
  });

  it("table cells padded with spaces", () => {
    // Column widths collapse only in the EDITED table: the neighbouring
    // blocks are not re-serialized, so the rest of the page markup is unharmed.
    const src = "| Parameter | Value |\n|:---------|---------:|\n| `debug`  |    false |\n";
    const [{ el }] = blocks(src);
    expect(serializeTopBlock(el)).toBe(
      "| Parameter | Value |\n|:---------|---------:|\n| `debug` | false |\n",
    );
  });

  it("a whole mixed document", () => {
    expectStable(
      [
        "# Guide",
        "",
        "Introductory text with a link on [section](#anchor).",
        "",
        "## Installation",
        "",
        "1) Install package:",
        "",
        "    ```bash",
        "    pip install mkdocs-material",
        "    ```",
        "",
        "2) Run server.",
        "",
        '!!! warning "Careful now"',
        "    Check the version Python.",
        "",
        "> Tip from the author.",
        "",
        "| Parameter | Value |",
        "|:---------|---------:|",
        "| `debug` | false |",
        "",
      ].join("\n"),
    );
  });
});
