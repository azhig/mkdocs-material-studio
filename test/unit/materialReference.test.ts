// @vitest-environment happy-dom
//
// Coverage audit of the MkDocs Material reference
// (https://squidfunk.github.io/mkdocs-material/reference/): one
// describe per Reference page. Every fixture is syntax taken from that page;
// we check the engine render and the serializer round-trip.
//
// Two levels of support:
//   expectRoundTrip  — editable in the visual editor, byte-for-byte serialization;
//   expectRendered   — renders to the expected HTML (structural check).
// Blocks that are safe only as text are checked via canSerialize(...)===false.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock, canSerialize } from "../../webviews/visual/htmlToMd";

const md = buildMarkdownEngine({
  resolveIcon: (code) =>
    code.startsWith("material-") || code.startsWith("octicons-") || code.startsWith("fontawesome-")
      ? `<svg data-icon="${code}"><path d="M0"/></svg>`
      : undefined,
  readSnippet: () => undefined,
});

function renderBlocks(src: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return Array.from(host.children) as HTMLElement[];
}

/** Every top-level block serializes back to the exact source slice. */
function expectRoundTrip(src: string): void {
  const lines = src.split("\n");
  const blocks = renderBlocks(src);
  expect(blocks.length).toBeGreaterThan(0);
  for (const el of blocks) {
    const startAttr = el.getAttribute("data-src-line");
    expect(startAttr, `no data-src-line on <${el.tagName.toLowerCase()}>`).not.toBeNull();
    const start = Number(startAttr);
    const end = Number(el.getAttribute("data-src-end"));
    const slice = lines.slice(start, end).join("\n").replace(/\n+$/, "") + "\n";
    expect(serializeTopBlock(el), `block <${el.tagName.toLowerCase()}> @${start}`).toBe(slice);
  }
}

/** Plain check that the render produces the expected HTML. */
function expectRendered(src: string, ...htmlIncludes: string[]): void {
  const html = md.render(src);
  for (const frag of htmlIncludes) {
    expect(html).toContain(frag);
  }
}

// ---------------------------------------------------------------------------
// 1. Admonitions — reference/admonitions/
// ---------------------------------------------------------------------------
describe("reference/admonitions", () => {
  it("basic admonition", () => {
    expectRoundTrip("!!! note\n    Lorem ipsum dolor sit amet.\n");
  });

  it("custom title", () => {
    expectRoundTrip('!!! note "Phasellus posuere in sem ut cursus"\n    Lorem ipsum.\n');
  });

  it("without a title", () => {
    expectRoundTrip('!!! note ""\n    Lorem ipsum.\n');
  });

  it("nested admonitions", () => {
    expectRoundTrip(
      '!!! note "Outer"\n    Text outside.\n\n    !!! tip "Inner"\n        Text inside.\n',
    );
  });

  it("triple-nested admonitions with a code block inside", () => {
    expectRoundTrip(
      '!!! note "Level 1"\n    Text.\n\n    !!! warning "Level 2"\n        Text.\n\n' +
        "        ```python\n        x = 1\n        ```\n\n" +
        '        !!! tip "Level 3"\n            Text.\n',
    );
  });

  it("collapsible (???) and expanded (???+)", () => {
    expectRoundTrip("??? note\n    Collapsed.\n");
    expectRoundTrip("???+ note\n    Expanded.\n");
  });

  it("inline blocks (inline / inline end)", () => {
    expectRoundTrip('!!! info inline "On the left"\n    Lorem ipsum.\n');
    expectRoundTrip('!!! info inline end "On the right"\n    Lorem ipsum.\n');
  });

  it("every standard type renders with the right class", () => {
    const types = [
      "note",
      "abstract",
      "info",
      "tip",
      "success",
      "question",
      "warning",
      "failure",
      "danger",
      "bug",
      "example",
      "quote",
    ];
    for (const t of types) {
      expectRendered(`!!! ${t}\n    Text.\n`, `class="admonition ${t}"`);
      expectRoundTrip(`!!! ${t}\n    Text.\n`);
    }
  });

  it("custom type (custom admonition)", () => {
    expectRendered('!!! pied-piper "Pied Piper"\n    Text.\n', 'class="admonition pied-piper"');
    expectRoundTrip('!!! pied-piper "Pied Piper"\n    Text.\n');
  });
});

// ---------------------------------------------------------------------------
// 2. Annotations — reference/annotations/
// ---------------------------------------------------------------------------
describe("reference/annotations", () => {
  it("a paragraph with { .annotate } and a list of notes", () => {
    expectRoundTrip(
      "Lorem ipsum dolor sit amet, (1) consectetur adipiscing elit.\n" +
        "{ .annotate }\n\n1. A note with **markup**.\n",
    );
  });

  it("annotate in an admonition (!!! note annotate)", () => {
    expectRoundTrip('!!! note annotate "A remark (1)"\n    Text.\n\n1. A note.\n');
  });

  it("annotate in content tabs", () => {
    expectRoundTrip(
      '=== "Tab"\n\n    Text with a marker. (1)\n    { .annotate }\n\n    1. A note.\n',
    );
  });

  // Nested annotations: `{ .annotate }` inside a list item belongs to the
  // item's paragraph (python-markdown semantics) — markdown-it-attrs would
  // lift it onto the enclosing list, where neither the decoration nor the
  // serializer would find it.
  it("a nested annotation round-trips", () => {
    expectRoundTrip("1. An outer note.(1)\n    { .annotate }\n\n    1. Nested.\n");
  });

  it("a nested annotation two levels deep round-trips", () => {
    expectRoundTrip(
      "1. Outer.(1)\n    { .annotate }\n\n    1. Middle.(1)\n        { .annotate }\n\n        1. Deep.\n",
    );
  });

  // The docs example verbatim (minus the two-space marker padding the editor
  // normalizes away). python-markdown does no smart typography — with the
  // typographer on, serializing baked `’` into sources written with `'`.
  it("straight apostrophes and emoji shortcodes survive the round-trip", () => {
    expectRoundTrip(
      "Lorem ipsum dolor sit amet, (1) consectetur adipiscing elit.\n{ .annotate }\n\n" +
        "1. :man_raising_hand: I'm an annotation! (1)\n    { .annotate }\n\n" +
        "    1. :woman_raising_hand: I'm an annotation as well!\n",
    );
    expectRendered(":man_raising_hand:\n", "🙋‍♂️");
  });

  // Enter inside an annotation window splits the note into paragraphs — they
  // must stay inside the item (indented), not become sibling annotations.
  it("a multi-paragraph annotation round-trips", () => {
    expectRoundTrip("Text (1) here.\n{ .annotate }\n\n1. First part.\n\n    Second paragraph.\n");
  });

  it("a multi-paragraph annotation keeps its nested list", () => {
    expectRoundTrip(
      "Text (1) here.\n{ .annotate }\n\n1. Beginning.\n\n    A tail with a marker. (1)\n" +
        "    { .annotate }\n\n    1. Nested.\n",
    );
  });

  // What the annotation window produces when the note's body is turned into a
  // list: the note keeps its `1. ` marker, its content nests one level in, and
  // a nested annotation's plumbing moves along with the paragraph it belongs to.
  it("a note whose body is a list round-trips", () => {
    expectRoundTrip("1. - One\n    - Two\n");
  });

  it("a note with a list body keeps its nested annotation", () => {
    const src = "1. - A note. (1)\n        { .annotate }\n\n        1. Nested.\n";
    expectRoundTrip(src);
    const p = renderBlocks(src)[0].querySelector("li li > p");
    expect(p?.classList.contains("annotate")).toBe(true);
  });

  it("the annotate class lands on the paragraph inside the item", () => {
    const blocks = renderBlocks("1. Outer.(1)\n    { .annotate }\n\n    1. Nested.\n");
    const p = blocks[0].querySelector("li > p");
    expect(p?.classList.contains("annotate")).toBe(true);
    // …and not on the list, where markdown-it-attrs would have put it.
    expect(blocks[0].classList.contains("annotate")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Buttons — reference/buttons/
// ---------------------------------------------------------------------------
describe("reference/buttons", () => {
  it("plain button", () => {
    expectRoundTrip("[Subscribe to the newsletter](#){ .md-button }\n");
    expectRendered("[A button](#){ .md-button }\n", 'class="md-button"');
  });

  it("primary button", () => {
    expectRoundTrip("[Subscribe](#){ .md-button .md-button--primary }\n");
  });

  it("button with an icon", () => {
    expectRoundTrip("[Send :fontawesome-solid-paper-plane:](#){ .md-button }\n");
  });
});

// ---------------------------------------------------------------------------
// 4. Code blocks — reference/code-blocks/
// ---------------------------------------------------------------------------
describe("reference/code-blocks", () => {
  it("plain block and block with a title", () => {
    expectRoundTrip("```py\nimport tensorflow as tf\n```\n");
    expectRoundTrip('```py title="bubble_sort.py"\ndef bubble_sort(items):\n    pass\n```\n');
  });

  it("line numbers and line highlighting", () => {
    expectRoundTrip('```py linenums="1"\nx = 1\ny = 2\n```\n');
    expectRoundTrip('```py hl_lines="2 3"\na\nb\nc\n```\n');
    expectRoundTrip('```py hl_lines="3-5"\na\nb\nc\nd\ne\nf\n```\n');
  });

  it("code with the `(1)!` annotation is kept as is", () => {
    expectRoundTrip(
      "```yaml\ntheme:\n  features:\n    - content.code.annotate # (1)!\n```\n\n1. A note.\n",
    );
  });

  it("braced info string with extra classes (.copy/.select/.no-copy)", () => {
    expectRoundTrip("```{ .yaml .copy }\nkey: value\n```\n");
    expectRoundTrip("```{ .yaml .no-copy }\nkey: value\n```\n");
    expectRendered("```{ .yaml .copy }\nkey: value\n```\n", 'class="highlight copy"');
  });

  it("inline highlighting `#!python ...`", () => {
    expectRoundTrip("The function `#!python range()` generates a sequence.\n");
    expectRendered(
      "Code `#!python range()` here.\n",
      'data-inline-lang="python"',
      'class="highlight language-python"',
    );
  });

  it("including a file inside a code block (--8<--)", () => {
    const engine = buildMarkdownEngine({
      resolveIcon: () => undefined,
      readSnippet: (p) => (p === ".browserslistrc" ? "last 4 years\n" : undefined),
    });
    const src = '```title=".browserslistrc"\n--8<-- ".browserslistrc"\n```\n';
    const host = document.createElement("div");
    host.innerHTML = engine.render(src);
    const block = host.firstElementChild as HTMLElement;
    // The render shows the file contents…
    expect(block.textContent).toContain("last 4 years");
    // …while serialization gives back the include marker.
    expect(serializeTopBlock(block)).toBe(src);
  });

  it("a block snippet outside code is an island and serializes back to its marker", () => {
    const engine = buildMarkdownEngine({
      resolveIcon: () => undefined,
      readSnippet: (p) => (p === "include.md" ? "# Included heading\n\nParagraph.\n" : undefined),
    });
    const host = document.createElement("div");
    host.innerHTML = engine.render('Before.\n\n--8<-- "include.md"\n\nAfter.\n');
    const island = host.querySelector(".snippet-include") as HTMLElement;
    expect(island).not.toBeNull();
    expect(island.getAttribute("data-block-type")).toBe("snippet");
    expect(island.textContent).toContain("Included heading");
    // Inner blocks do not pretend to be lines of the document.
    expect(island.querySelector("[data-src-line]")).toBeNull();
    expect(serializeTopBlock(island)).toBe('--8<-- "include.md"\n');
  });

  it("an include whose file is missing is the same island, not a new block", () => {
    // The notice used to be bare HTML with no source range: the editor took it
    // for content of its own and wrote the warning into the document, once per
    // touch, while the --8<-- line stayed where it was.
    const engine = buildMarkdownEngine({
      resolveIcon: () => undefined,
      readSnippet: () => undefined,
    });
    const host = document.createElement("div");
    host.innerHTML = engine.render('--8<-- "no.md"\n');
    const island = host.querySelector(".snippet-include") as HTMLElement;
    expect(island).not.toBeNull();
    expect(island.getAttribute("data-src-line")).toBe("0");
    expect(island.textContent).toContain("Snippet not found");
    expect(serializeTopBlock(island)).toBe('--8<-- "no.md"\n');
  });
});

// ---------------------------------------------------------------------------
// 5. Content tabs — reference/content-tabs/
// ---------------------------------------------------------------------------
describe("reference/content-tabs", () => {
  it("tabs with code blocks", () => {
    expectRoundTrip(
      '=== "C"\n\n    ```c\n    #include <stdio.h>\n    ```\n\n=== "C++"\n\n    ```cpp\n    #include <iostream>\n    ```\n',
    );
  });

  it("tabs with other content (lists)", () => {
    expectRoundTrip(
      '=== "Bulleted"\n\n    - item 1\n    - item 2\n\n=== "Numbered"\n\n    1. item 1\n    2. item 2\n',
    );
  });

  it("tabs inside an admonition", () => {
    expectRoundTrip(
      '!!! example\n    === "Tab 1"\n\n        Content 1.\n\n    === "Tab 2"\n\n        Content 2.\n',
    );
  });

  it("tabs inside a blockquote", () => {
    expectRoundTrip(
      '> A quote with tabs:\n>\n> === "A"\n>\n>     Text A.\n>\n> === "B"\n>\n>     Text B.\n',
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Data tables — reference/data-tables/
// (sorting is the third-party tablesort, CSV import is a third-party plugin; outside
// the built-in render)
// ---------------------------------------------------------------------------
describe("reference/data-tables", () => {
  it("basic table with code and icons in cells", () => {
    expectRoundTrip(
      "| Method | What it does |\n| --- | --- |\n| `GET` | :material-check: Fetch a resource |\n| `DELETE` | :material-close: Delete a resource |\n",
    );
  });

  it("left/center/right alignment", () => {
    expectRoundTrip("| A | B | C |\n| :--- | :---: | ---: |\n| a | b | c |\n");
  });
});

// ---------------------------------------------------------------------------
// 7. Diagrams — reference/diagrams/
// (mermaid is drawn in the webview; the engine must emit pre.mermaid
// with the source text and preserve it on serialization)
// ---------------------------------------------------------------------------
describe("reference/diagrams", () => {
  const samples: Record<string, string> = {
    flowchart: "graph LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Action]",
    sequence: "sequenceDiagram\n  A->>B: Message\n  B-->>A: Response",
    state: "stateDiagram-v2\n  [*] --> S1\n  S1 --> [*]",
    class: "classDiagram\n  C1 <|-- C2\n  C1 : attr",
    er: "erDiagram\n  E1 ||--o{ E2 : relates",
  };

  for (const [name, body] of Object.entries(samples)) {
    it(`mermaid: ${name}`, () => {
      const src = "```mermaid\n" + body + "\n```\n";
      expectRendered(src, '<pre class="mermaid"');
      expectRoundTrip(src);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Footnotes — reference/footnotes/
// (the marker carries its label in data-fn-label and serializes back as
// `[^label]`; the definition lines survive in a hidden carrier block)
// ---------------------------------------------------------------------------
describe("reference/footnotes", () => {
  it("markers and a single-line definition render", () => {
    expectRendered(
      "Text with a footnote[^1].\n\n[^1]: A note.\n",
      'class="footnote-ref"',
      'class="footnotes"',
      'data-fn-label="1"',
    );
  });

  it("a multiline definition renders", () => {
    expectRendered("Text[^2].\n\n[^2]:\n    First line,\n    second line.\n", 'class="footnotes"');
  });

  it("a block with a footnote marker serializes back exactly", () => {
    const blocks = renderBlocks("Text with a footnote[^1].\n\n[^1]: A note.\n");
    const para = blocks.find((b) => b.tagName === "P");
    expect(para).toBeDefined();
    expect(serializeTopBlock(para as Element)).toBe("Text with a footnote[^1].\n");
  });

  it("a multiline definition round-trips through the carrier", () => {
    const blocks = renderBlocks("Text[^2].\n\n[^2]: First line,\n    second line.\n");
    const defs = blocks.find((b) => b.classList.contains("footnote-defs"));
    expect(defs).toBeDefined();
    expect(serializeTopBlock(defs as Element)).toBe("[^2]: First line,\n    second line.\n");
  });
});

// ---------------------------------------------------------------------------
// 9. Formatting — reference/formatting/
// ---------------------------------------------------------------------------
describe("reference/formatting", () => {
  it("critic: addition", () => {
    expectRendered("Text {++added++} here.\n", '<ins class="critic">added</ins>');
    expectRoundTrip("Text {++added++} here.\n");
  });

  it("critic: deletion", () => {
    expectRendered("Text {--removed--} here.\n", '<del class="critic">removed</del>');
    expectRoundTrip("Text {--removed--} here.\n");
  });

  it("critic: substitution", () => {
    expectRendered(
      "Text {~~before~>after~~} here.\n",
      '<span class="critic subst"><del class="critic">before</del><ins class="critic">after</ins></span>',
    );
    expectRoundTrip("Text {~~before~>after~~} here.\n");
  });

  it("critic: highlight and comment", () => {
    expectRendered(
      "A {==highlighted==} B {>>a note in the margin<<} C.\n",
      '<mark class="critic">highlighted</mark>',
      '<span class="critic comment">a note in the margin</span>',
    );
    expectRoundTrip("A {==highlighted==} B {>>a note in the margin<<} C.\n");
  });

  it("highlight, insert, strikethrough", () => {
    expectRoundTrip("Here ==highlighted==, ^^inserted^^ and ~~struck out~~.\n");
  });

  it("colored highlight (attr_list class) round-trip", () => {
    expectRoundTrip("Text ==highlighted=={ .hl-green } here.\n");
    expectRoundTrip("Text ==important=={ .hl-pink } here.\n");
    expectRendered("A word ==colour=={ .hl-blue } here.\n", '<mark class="hl-blue">');
  });

  it("subscript and superscript", () => {
    expectRoundTrip("Water H~2~O and matrix A^T^A.\n");
  });

  it("keyboard shortcuts", () => {
    expectRoundTrip("Press ++ctrl+alt+del++ to reboot.\n");
    expectRendered("Hit ++ctrl+c++.\n", "<kbd");
  });
});

// ---------------------------------------------------------------------------
// 10. Grids — reference/grids/ (md_in_html)
// ---------------------------------------------------------------------------
describe("reference/grids", () => {
  it("card grid as a list", () => {
    const src =
      '<div class="grid cards" markdown>\n\n' +
      "- :fontawesome-brands-html5: **HTML** for the content\n" +
      "- :fontawesome-brands-css3: **CSS** for the styling\n\n" +
      "</div>\n";
    expectRendered(src, 'class="grid cards"');
    expectRoundTrip(src);
  });

  it("expanded cards with separators and links", () => {
    const src =
      '<div class="grid cards" markdown>\n\n' +
      "-   :material-clock-fast:{ .lg .middle } __Up and running in 5 minutes__\n\n" +
      "    ---\n\n" +
      "    Install `mkdocs-material` and get to work.\n\n" +
      "    [:octicons-arrow-right-24: Getting started](#)\n\n" +
      "</div>\n";
    expectRendered(src, 'class="grid cards"');
  });

  it("block grid with .card and a blockquote", () => {
    const src =
      '<div class="grid" markdown>\n\n' +
      ":fontawesome-brands-html5: **HTML** for the structure\n" +
      "{ .card }\n\n" +
      "> A quote in the grid.\n\n" +
      "</div>\n";
    expectRendered(src, 'class="grid"', 'class="card"');
    expectRoundTrip(src);
  });

  it("generic grid with content tabs", () => {
    const src =
      '<div class="grid" markdown>\n\n' +
      '=== "Bulleted"\n\n    - item\n\n=== "Numbered"\n\n    1. item\n\n' +
      "</div>\n";
    expectRendered(src, 'class="grid"', "tabbed-set");
    expectRoundTrip(src);
  });
});

// ---------------------------------------------------------------------------
// 11. Icons, Emojis — reference/icons-emojis/
// ---------------------------------------------------------------------------
describe("reference/icons-emojis", () => {
  it("emoji shortcodes", () => {
    expectRoundTrip("Splendid :smile: that worked!\n");
  });

  it("icon shortcodes", () => {
    expectRoundTrip("Look at :material-star: and :fontawesome-brands-youtube: here.\n");
    expectRendered("An icon :octicons-heart-fill-24: here.\n", 'class="twemoji"');
  });

  it("icon with color/animation (attr_list class)", () => {
    expectRendered(
      "A video :fontawesome-brands-youtube:{ .youtube } from the channel.\n",
      'class="twemoji youtube"',
    );
    expectRoundTrip("A video :fontawesome-brands-youtube:{ .youtube } from the channel.\n");
    expectRoundTrip("A heart :octicons-heart-fill-24:{ .heart } beats.\n");
  });
});

// ---------------------------------------------------------------------------
// 12. Images — reference/images/
// ---------------------------------------------------------------------------
describe("reference/images", () => {
  it("left/right alignment", () => {
    expectRoundTrip("![Heading](img.png){ align=left }\n");
    expectRoundTrip("![Heading](img.png){ align=right }\n");
    expectRendered("![X](img.png){ align=left }\n", 'align="left"');
  });

  it("lazy loading (loading=lazy)", () => {
    expectRoundTrip("![Heading](img.png){ loading=lazy }\n");
    expectRendered("![X](img.png){ loading=lazy }\n", 'loading="lazy"');
  });

  it("width and height", () => {
    expectRoundTrip('![Heading](img.png){ width="300" }\n');
    expectRoundTrip('![Heading](img.png){ width="300" height="150" }\n');
  });

  it("images for light/dark theme (#only-light / #only-dark)", () => {
    expectRoundTrip("![Heading](img.png#only-light)\n");
    expectRoundTrip("![Heading](img.png#gh-dark-mode-only)\n");
  });

  it("caption via <figure markdown> (method A) renders", () => {
    const src =
      '<figure markdown="span">\n  ![Heading](img.png){ width="300" }\n  <figcaption>Caption</figcaption>\n</figure>\n';
    expectRendered(src, "<figure", "<figcaption>Caption</figcaption>", 'src="img.png"');
  });

  it("caption via /// caption (method B) renders into a figure", () => {
    const src = '![Heading](img.png){ width="300" }\n/// caption\nCaption\n///\n';
    expectRendered(src, "<figure", "<figcaption", "Caption", 'src="img.png"');
  });

  it("caption blocks are safe in the visual editor (edited as text)", () => {
    const a = renderBlocks(
      '<figure markdown="span">\n  ![Heading](img.png)\n  <figcaption>Caption</figcaption>\n</figure>\n',
    );
    expect(a.some((b) => b.tagName === "FIGURE" && !canSerialize(b))).toBe(true);
    const b = renderBlocks("![Heading](img.png)\n/// caption\nCaption\n///\n");
    expect(b.some((x) => x.tagName === "FIGURE" && !canSerialize(x))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. Lists — reference/lists/
// ---------------------------------------------------------------------------
describe("reference/lists", () => {
  it("bulleted list", () => {
    expectRoundTrip("- Item one\n- Item two\n- Item three\n");
  });

  it("ordered list", () => {
    expectRoundTrip("1. First\n2. Second\n3. Third\n");
  });

  it("nested lists", () => {
    expectRoundTrip("- parent\n    - child\n    - second\n- sibling\n");
    expectRoundTrip("1. first\n    1. nested\n    2. more\n2. second\n");
  });

  it("task list (checkboxes)", () => {
    expectRoundTrip("- [x] Done\n- [ ] In progress\n");
    expectRendered("- [x] Done\n", 'type="checkbox"', "checked");
  });

  it("nested task list", () => {
    expectRoundTrip("- [x] Parent\n    - [ ] Child\n    - [x] Second\n");
  });

  it("task list with block content in an item", () => {
    // A “loose” item: the checkbox moves inside <p>, but [x] must survive.
    expectRoundTrip("- [x] A task\n\n    A note about the task.\n");
    expectRoundTrip("- [ ] A task\n\n    ```python\n    x = 1\n    ```\n");
  });

  it("definition list", () => {
    expectRoundTrip("Term name\n:   Text of the definition.\n");
  });

  it("definition list with several definitions", () => {
    expectRoundTrip("Term\n:   First definition.\n:   Second definition.\n");
  });

  it("definition list in loose form (blank line before :)", () => {
    // Both forms render the same — the form is restored from the source lines.
    expectRoundTrip("Term\n\n:   Definition.\n");
    expectRoundTrip("Term\n\n:   First.\n\n:   Second.\n");
  });
});

// ---------------------------------------------------------------------------
// 14. Math — reference/math/
// ---------------------------------------------------------------------------
describe("reference/math", () => {
  it("block formula $$…$$", () => {
    expectRoundTrip("$$\nE = mc^2\n$$\n");
    expectRendered("$$\nE = mc^2\n$$\n", 'class="arithmatex"', "katex");
  });

  it("block formula \\[…\\]", () => {
    expectRoundTrip("\\[\nE = mc^2\n\\]\n");
    expectRendered("\\[\nE = mc^2\n\\]\n", 'data-math-delim="bracket"');
  });

  it("inline formula $…$", () => {
    expectRoundTrip("Let $f$ and $e_G$ be given.\n");
    expectRendered("The function $f$ here.\n", 'class="arithmatex"');
  });

  it("inline formula \\(…\\)", () => {
    expectRoundTrip("Let \\(f\\) and \\(e_G\\) be given.\n");
    expectRendered("The function \\(f\\) here.\n", 'data-math-delim="paren"');
  });
});

// ---------------------------------------------------------------------------
// 15. Tooltips — reference/tooltips/
// ---------------------------------------------------------------------------
describe("reference/tooltips", () => {
  it("tooltip on a link (title attribute)", () => {
    expectRoundTrip('[Hover](https://example.com "I am a tooltip!")\n');
    expectRendered('[Hover](https://ex.com "a tooltip")\n', 'title="a tooltip"');
  });

  it("tooltip on an icon (title via attr_list)", () => {
    expectRendered(
      ':material-information-outline:{ title="Important information" }\n',
      'title="Important information"',
      'class="twemoji"',
    );
    expectRoundTrip(':material-information-outline:{ title="Important information" }\n');
  });

  it("abbreviations (*[HTML]: …) are wrapped in <abbr>", () => {
    const src =
      "HTML and W3C technology today.\n\n*[HTML]: Hyper Text Markup Language\n*[W3C]: World Wide Web Consortium\n";
    expectRendered(
      src,
      '<abbr title="Hyper Text Markup Language">HTML</abbr>',
      '<abbr title="World Wide Web Consortium">W3C</abbr>',
    );
    expectRoundTrip(src);
  });

  it("an abbreviation does not match inside a word", () => {
    // “HTMLElement” must not be wrapped (there is no word boundary).
    const html = md.render(
      "The HTMLElement class lives here.\n\n*[HTML]: Hyper Text Markup Language\n",
    );
    expect(html).not.toContain("<abbr");
  });
});

// ---------------------------------------------------------------------------
// Matrix of components nested into each other (Material standard)
// ---------------------------------------------------------------------------
// Containers (blocks can be nested, +4 indent per level): admonition,
// content tabs, lists, blockquotes, grids. Leaves (no blocks inside): code,
// tables, diagrams, formulas. Here: a byte-for-byte round-trip for the combinations
// allowed by the standard.
describe("reference/nesting — component nesting", () => {
  // Admonition as a container
  it("admonition ⊃ table", () => {
    expectRoundTrip('!!! note "N"\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |\n');
  });
  it("admonition ⊃ list", () => {
    expectRoundTrip('!!! note "N"\n    - one\n    - two\n');
  });
  it("admonition ⊃ tabs", () => {
    expectRoundTrip('!!! note "N"\n    === "T1"\n\n        A\n\n    === "T2"\n\n        B\n');
  });
  it("admonition ⊃ code", () => {
    expectRoundTrip('!!! note "N"\n    ```python\n    x = 1\n    ```\n');
  });
  it("admonition ⊃ mermaid", () => {
    expectRoundTrip('!!! note "N"\n    ```mermaid\n    graph TD\n        A --> B\n    ```\n');
  });
  it("admonition ⊃ formula ($$)", () => {
    expectRoundTrip('!!! note "N"\n    $$\n    E = mc^2\n    $$\n');
  });

  // Content tabs as a container
  it("tabs ⊃ admonition", () => {
    expectRoundTrip('=== "T1"\n\n    !!! note "N"\n        Text.\n\n=== "T2"\n\n    Text.\n');
  });
  it("tabs ⊃ nested tabs", () => {
    expectRoundTrip(
      '=== "O1"\n\n    === "I1"\n\n        A\n\n    === "I2"\n\n        B\n\n=== "O2"\n\n    B\n',
    );
  });
  it("tabs ⊃ table", () => {
    expectRoundTrip(
      '=== "T1"\n\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |\n\n=== "T2"\n\n    Text.\n',
    );
  });
  it("tabs ⊃ list", () => {
    expectRoundTrip('=== "T1"\n\n    - one\n    - two\n\n=== "T2"\n\n    Text.\n');
  });

  // Lists and blockquotes as containers
  it("list ⊃ code", () => {
    expectRoundTrip("- Item\n\n    ```python\n    x = 1\n    ```\n");
  });
  it("list ⊃ admonition", () => {
    expectRoundTrip('- Item\n\n    !!! note "N"\n        Text.\n');
  });
  it("blockquote ⊃ code", () => {
    expectRoundTrip("> A quote:\n>\n> ```python\n> x = 1\n> ```\n");
  });

  // Deep nesting (3 levels)
  it("admonition ⊃ tabs ⊃ code", () => {
    expectRoundTrip(
      '!!! note "N"\n    === "T1"\n\n        ```python\n        x = 1\n        ```\n\n    === "T2"\n\n        B\n',
    );
  });
  it("tabs ⊃ admonition ⊃ code", () => {
    expectRoundTrip(
      '=== "T1"\n\n    !!! note "N"\n        ```python\n        x = 1\n        ```\n\n=== "T2"\n\n    B\n',
    );
  });
  it("admonition ⊃ admonition ⊃ table", () => {
    expectRoundTrip(
      '!!! note "O"\n    !!! tip "I"\n        | A | B |\n        | --- | --- |\n        | 1 | 2 |\n',
    );
  });
});
