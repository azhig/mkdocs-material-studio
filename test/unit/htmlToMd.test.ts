// @vitest-environment happy-dom
//
// Visual editor round-trip: markdown → engine render → DOM →
// serializeTopBlock → markdown. For canonical fixtures serialization must
// restore the source slice byte for byte; for the rest it must be render-equivalent.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock, canSerialize, overrideTitle } from "../../webviews/visual/htmlToMd";
import { splitHighlightedLines } from "../../webviews/visual/codeLive";

const md = buildMarkdownEngine({
  resolveIcon: (code) => (code === "material-star" ? '<svg><path d="M0"/></svg>' : undefined),
  readSnippet: () => undefined,
});

/** Renders markdown and returns the top-level elements. */
function renderBlocks(src: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return Array.from(host.children) as HTMLElement[];
}

/**
 * Checks that every top-level block serializes back to the exact source slice
 * (per data-src-line/data-src-end).
 */
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
    const serialized = serializeTopBlock(el);
    expect(serialized, `block <${el.tagName.toLowerCase()}> @${start}`).toBe(slice);
  }
}

describe("htmlToMd: canonical round-trip", () => {
  it("headings and paragraphs", () => {
    expectRoundTrip("# Heading\n\nPlain paragraph text.\n\n## Second level\n\nMore paragraph.\n");
  });

  it("inline formatting", () => {
    expectRoundTrip("Here **bold**, *italic*, ~~struck out~~, ==highlighted== and `code`.\n");
  });

  it("editing heading text does not turn an auto anchor into an explicit one", () => {
    // the id is set by markdown-it-anchor from the old text; after an edit it
    // goes stale and without the data-auto-id marker would land in the file as { #... }.
    for (const [src, edited, expected] of [
      ["# Heading\n", "Heading an edit", "# Heading an edit\n"],
      ["## Heading\n", "Heading edited", "## Heading edited\n"],
    ]) {
      const [el] = renderBlocks(src);
      const host = el.querySelector(".header-anchor") ?? el;
      host.textContent = edited;
      expect(serializeTopBlock(el)).toBe(expected);
    }
  });

  it("an explicit heading anchor survives a text edit", () => {
    const [el] = renderBlocks("# Heading { #custom }\n");
    const host = el.querySelector(".header-anchor") ?? el;
    host.textContent = "Heading an edit";
    expect(serializeTopBlock(el)).toBe("# Heading an edit { #custom }\n");
  });

  it("insert, subscript and superscript", () => {
    expectRoundTrip("Formulas H~2~O and x^2^, insert ^^of the new^^ text.\n");
  });

  it("links and images", () => {
    expectRoundTrip("See [the documentation](https://example.com/docs).\n");
    expectRoundTrip("![Diagram](images/pic.png)\n");
  });

  it("Material button (attrs)", () => {
    expectRoundTrip("[Read more](#){ .md-button }\n");
  });

  it("image with alignment (attrs)", () => {
    expectRoundTrip('![Logo](logo.png){ align=left width="300" }\n');
  });

  it("bulleted and ordered lists", () => {
    expectRoundTrip("- one\n- two\n- three\n");
    expectRoundTrip("1. first\n2. second\n");
  });

  it("annotations: (1) marker + .annotate class + companion list", () => {
    expectRoundTrip(
      "Paragraph with an annotation (1)\n{ .annotate }\n\n1. A note to annotations\n",
    );
  });

  it("annotations in code: # (1)! marker + companion list", () => {
    expectRoundTrip('```python\nprint("hello")\n# (1)!\n```\n\n1. A note to line\n');
  });

  it("annotations: the decorative “plus” marker serializes back to (n)", () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<p class="annotate"><span class="md-annotation" data-annotation-index="1">1</span> text</p>';
    expect(serializeTopBlock(host.firstElementChild as HTMLElement)).toBe(
      "(1) text\n{ .annotate }\n",
    );
  });

  it("annotations: the hidden companion list serializes without the service class", () => {
    const host = document.createElement("div");
    host.innerHTML = '<ol class="annotation-list"><li>A note</li></ol>';
    expect(serializeTopBlock(host.firstElementChild as HTMLElement)).toBe("1. A note\n");
  });

  it("nested list", () => {
    expectRoundTrip("- parent\n    - child\n    - second\n- sibling\n");
  });

  it("task list", () => {
    expectRoundTrip("- [x] Done\n- [ ] In progress\n");
  });

  it("blockquote", () => {
    expectRoundTrip("> Line of the quote\n> and continuation.\n");
  });

  it("horizontal rule", () => {
    expectRoundTrip("---\n");
  });

  it("table with alignment", () => {
    expectRoundTrip(
      "| Name | Value | Right |\n| --- | :---: | ---: |\n| a | b | c |\n| d | e | f |\n",
    );
  });

  it("table whose alignment row is spelled the author's way", () => {
    expectRoundTrip("| a | b |\n|:----------|----------:|\n| 1 | 2 |\n");
  });

  it("changing a column's alignment rewrites the alignment row", () => {
    // The menu writes the alignment onto the cells; the authored row said
    // something else, and it is the cells that are now right.
    const [table] = renderBlocks("| a | b |\n| :--- | :---: |\n| 1 | 2 |\n");
    for (const cell of table.querySelectorAll("tr > *:first-child")) {
      cell.setAttribute("style", "text-align:right");
    }
    expect(serializeTopBlock(table)).toBe("| a | b |\n| ---: | :---: |\n| 1 | 2 |\n");
  });

  it("code block with options", () => {
    expectRoundTrip(
      '```python title="app.py" linenums="1" hl_lines="2-3"\nx = 1\ny = 2\nz = 3\n```\n',
    );
  });

  it("plain code block", () => {
    expectRoundTrip("```js\nconsole.log(1);\n```\n");
  });

  it("mermaid", () => {
    expectRoundTrip("```mermaid\ngraph TD\n    A --> B\n```\n");
  });

  it("admonition", () => {
    expectRoundTrip('!!! note "Important"\n    Text notes.\n');
    expectRoundTrip("!!! tip\n    Tip without heading.\n");
    expectRoundTrip('!!! warning ""\n    Without heading at all.\n');
  });

  it("collapsible admonition (details)", () => {
    expectRoundTrip('??? info "Collapsed"\n    Content.\n');
    expectRoundTrip('???+ info "Expanded"\n    Content.\n');
  });

  it("admonition with a nested list and code", () => {
    expectRoundTrip(
      '!!! example "Worked example"\n    Input:\n\n    - item\n    - more\n\n    ```py\n    print(1)\n    ```\n',
    );
  });

  it("content tabs", () => {
    expectRoundTrip('=== "Linux"\n\n    apt install foo\n\n=== "macOS"\n\n    brew install foo\n');
  });

  it("formulas", () => {
    expectRoundTrip("$$\nE = mc^2\n$$\n");
    expectRoundTrip("Inline $a^2 + b^2 = c^2$ formula.\n");
  });

  it("keys", () => {
    expectRoundTrip("Press ++ctrl+alt+del++ to reboot.\n");
  });

  it("emojis and icons", () => {
    expectRoundTrip("Splendid :smile: it worked :material-star: today.\n");
  });

  it("definition list", () => {
    expectRoundTrip("Term\n:   Definition of the term.\n");
  });
});

describe("htmlToMd: render-equivalent round-trip", () => {
  /** serialize(render(src)) renders to the same HTML as src. */
  function expectRenderEquivalent(src: string): void {
    const blocks = renderBlocks(src);
    const serialized = blocks.map((el) => serializeTopBlock(el)).join("\n");
    const normalize = (html: string): string =>
      html.replace(/ data-src-(line|end)="\d+"/g, "").replace(/ id="__tabbed[^"]*"/g, "");
    expect(normalize(md.render(serialized))).toBe(normalize(md.render(src)));
  }

  it("escaping of special characters in text", () => {
    expectRenderEquivalent("Multiplication 2 * 3 and variable a_b_c.\n");
  });

  it("non-canonical list markers are normalized without losing meaning", () => {
    expectRenderEquivalent("* one\n* two\n");
  });

  it("highlight mark: inside list items and with a space before the next word", () => {
    // A highlight spanning several items produces one mark per item.
    expectRoundTrip("- ==One=={ .hl-yellow }\n- ==Two=={ .hl-yellow }\n");
    expectRoundTrip("- ==Formatting: *italic*, `code`=={ .hl-yellow }\n");
    // The attr_list class binds only right next to “==”, the space comes after.
    expectRoundTrip("First ==item=={ .hl-yellow } of the list\n");
    expectRoundTrip("==Beginning=={ .hl-green } and ==the end=={ .hl-cyan }\n");
  });

  it("indented code becomes a fence", () => {
    const blocks = renderBlocks("Paragraph:\n\n    code line\n");
    const pre = blocks.find((b) => b.tagName === "PRE");
    expect(pre).toBeDefined();
    expect(serializeTopBlock(pre as Element)).toBe("```\ncode line\n```\n");
  });
});

describe("htmlToMd: image insertion (paste/drop → auto-save)", () => {
  it("a pasted <img> with a relative src serializes to ![](…)", () => {
    const [p] = renderBlocks("Text up to the picture.\n");
    const img = document.createElement("img");
    img.setAttribute("src", "assets/image.png");
    img.setAttribute("alt", "");
    p.appendChild(document.createTextNode(" "));
    p.appendChild(img);
    expect(serializeTopBlock(p)).toBe("Text up to the picture. ![](assets/image.png)\n");
  });

  it("an image shown through the webview writes the author's path back", () => {
    // src points at the file through the webview (see rewriteHtmlAssetUrls);
    // data-md-src holds the path as it stands in the document.
    const [p] = renderBlocks("Diagram:\n");
    const img = document.createElement("img");
    img.setAttribute("src", "https://file%2B.vscode-resource.test/doc/assets/logo.svg");
    img.setAttribute("data-md-src", "doc/assets/logo.svg");
    img.setAttribute("alt", "Logo");
    p.appendChild(document.createTextNode(" "));
    p.appendChild(img);
    expect(serializeTopBlock(p)).toBe("Diagram: ![Logo](doc/assets/logo.svg)\n");
  });
});

describe("htmlToMd: inserting an icon/emoji from the picker", () => {
  it("a “live” icon (viemoji-live) serializes to :shortcode: without the service class", () => {
    const [p] = renderBlocks("An icon here.\n");
    const span = document.createElement("span");
    span.className = "twemoji viemoji-live";
    span.setAttribute("data-emoji", ":material-star:");
    p.appendChild(document.createTextNode(" "));
    p.appendChild(span);
    expect(serializeTopBlock(p)).toBe("An icon here. :material-star:\n");
  });

  it("an emoji character serializes to :shortcode:", () => {
    const [p] = renderBlocks("A rocket.\n");
    const span = document.createElement("span");
    span.setAttribute("data-emoji", ":rocket:");
    span.textContent = "🚀";
    p.appendChild(document.createTextNode(" "));
    p.appendChild(span);
    expect(serializeTopBlock(p)).toBe("A rocket. :rocket:\n");
  });
});

describe("htmlToMd: editor service elements do not leak into Markdown", () => {
  it(".isl-tools buttons inside an admonition are ignored", () => {
    const src = '!!! tip "Handy"\n    Text notes.\n';
    const [block] = renderBlocks(src);
    const tools = document.createElement("div");
    tools.className = "isl-tools";
    tools.innerHTML = "<button>✎ Once text</button><button>🗑</button>";
    block.appendChild(tools);
    block.setAttribute("data-vtools", "");
    expect(serializeTopBlock(block)).toBe(src);
  });

  it("inline tab controls (“×” on a label, “+” at the end) are not part of the title", () => {
    const src = '=== "Linux"\n\n    apt install foo\n\n=== "macOS"\n\n    brew install foo\n';
    const [set] = renderBlocks(src);
    // Mimic decorate: “×” in every label, “+” at the end of the row.
    const labelsBox = set.querySelector(".tabbed-labels") as HTMLElement;
    for (const label of Array.from(labelsBox.querySelectorAll("label"))) {
      const x = document.createElement("button");
      x.className = "vtab-x";
      x.textContent = "×";
      label.appendChild(x);
    }
    const add = document.createElement("button");
    add.className = "vtab-add";
    add.textContent = "+";
    labelsBox.appendChild(add);
    expect(serializeTopBlock(set)).toBe(src);
  });

  it("tab order is taken from the DOM (after a label was dragged)", () => {
    const [set] = renderBlocks(
      '=== "A"\n\n    body A\n\n=== "B"\n\n    body B\n\n=== "C"\n\n    body C\n',
    );
    const labelsBox = set.querySelector(".tabbed-labels")!;
    const content = set.querySelector(".tabbed-content")!;
    const labels = Array.from(labelsBox.querySelectorAll("label"));
    const blocks = Array.from(content.querySelectorAll(".tabbed-block"));
    // Move C (idx 2) to the front — the way moveTab does.
    labelsBox.insertBefore(labels[2], labels[0]);
    content.insertBefore(blocks[2], blocks[0]);
    expect(serializeTopBlock(set)).toBe(
      '=== "C"\n\n    body C\n\n=== "A"\n\n    body A\n\n=== "B"\n\n    body B\n',
    );
  });

  it("a single tab is allowed (Material permits it)", () => {
    expectRoundTrip('=== "One"\n\n    only one\n');
  });

  it("a fresh empty tab (a paragraph with only <br>) serializes without a body", () => {
    const [set] = renderBlocks('=== "A"\n\n    body A\n\n=== "B"\n\n    body B\n');
    // Add a third empty tab the way addTab does.
    const inputs = set.querySelectorAll('input[type="radio"]');
    const input = document.createElement("input");
    input.type = "radio";
    input.id = "__tabbed_1_3";
    input.name = "__tabbed_1";
    inputs[inputs.length - 1].after(input);
    const label = document.createElement("label");
    label.setAttribute("for", "__tabbed_1_3");
    label.textContent = "Tab 3";
    set.querySelector(".tabbed-labels")!.appendChild(label);
    const block = document.createElement("div");
    block.className = "tabbed-block";
    block.innerHTML = "<p><br></p>";
    set.querySelector(".tabbed-content")!.appendChild(block);
    expect(serializeTopBlock(set)).toBe(
      '=== "A"\n\n    body A\n\n=== "B"\n\n    body B\n\n=== "Tab 3"\n',
    );
  });

  it("inline grid card controls (handle, “×”, “+ A card”) do not reach Markdown", () => {
    const src =
      '<div class="grid cards" markdown>\n\n- **A**\n\n    body A.\n\n- **B**\n\n    body B.\n\n</div>\n';
    const [grid] = renderBlocks(src);
    // Mimic decorate: a handle + “×” in every card, “+ A card” at the end.
    for (const li of Array.from(grid.querySelectorAll(":scope > ul > li"))) {
      const grip = document.createElement("span");
      grip.className = "vgctl vcard-grip";
      grip.textContent = "⠿";
      const x = document.createElement("button");
      x.className = "vgctl vcard-x";
      x.textContent = "×";
      li.prepend(grip);
      li.appendChild(x);
    }
    const add = document.createElement("button");
    add.className = "vgctl vcard-add";
    add.textContent = "+ A card";
    grid.appendChild(add);
    expect(serializeTopBlock(grid)).toBe(src);
  });

  it("a fresh card with an empty body (<p><br></p>) serializes without “dangling” spaces", () => {
    const [grid] = renderBlocks(
      '<div class="grid cards" markdown>\n\n- **A**\n\n    body A.\n\n</div>\n',
    );
    // Add a card the way addCard does: a title + an empty body.
    const ul = grid.querySelector(":scope > ul")!;
    const li = document.createElement("li");
    li.innerHTML = "<p><strong>A card 2</strong></p><p><br></p>";
    ul.appendChild(li);
    expect(serializeTopBlock(grid)).toBe(
      '<div class="grid cards" markdown>\n\n- **A**\n\n    body A.\n\n- **A card 2**\n\n</div>\n',
    );
  });

  it("card order is taken from the DOM (after dragging)", () => {
    const [grid] = renderBlocks(
      '<div class="grid cards" markdown>\n\n- **A**\n\n    body A.\n\n- **B**\n\n    body B.\n\n- **C**\n\n    body C.\n\n</div>\n',
    );
    const ul = grid.querySelector(":scope > ul")!;
    const cards = Array.from(ul.querySelectorAll(":scope > li"));
    // Move C (idx 2) to the front — the way moveCard does.
    ul.insertBefore(cards[2], cards[0]);
    expect(serializeTopBlock(grid)).toBe(
      '<div class="grid cards" markdown>\n\n- **C**\n\n    body C.\n\n- **A**\n\n    body A.\n\n- **B**\n\n    body B.\n\n</div>\n',
    );
  });
});

describe("codeLive: splitting highlighted code into lines", () => {
  it("plain lines without tags", () => {
    expect(splitHighlightedLines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("a span crossing a newline is closed and reopened", () => {
    const html = '<span class="hljs-comment">/* line1\nline2 */</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-comment">/* line1</span>',
      '<span class="hljs-comment">line2 */</span>',
    ]);
  });

  it("HTML entities are preserved, nested spans stay balanced", () => {
    const html = '<span class="hljs-string">"a &lt; b"</span>\nx';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-string">"a &lt; b"</span>',
      "x",
    ]);
  });
});

describe("htmlToMd: overrideTitle", () => {
  it("replaces an existing title (plain)", () => {
    expect(overrideTitle('python title="app.py"', "main.py")).toBe('python title="main.py"');
  });

  it("replaces an existing title (braced)", () => {
    expect(overrideTitle('{ .python .copy title="a" }', "b")).toBe('{ .python .copy title="b" }');
  });

  it("removes the title when the text is empty", () => {
    expect(overrideTitle('python title="app.py"', "")).toBe("python");
    expect(overrideTitle('{ .python title="a" }', "  ")).toBe("{ .python }");
  });

  it("adds a title when there was none", () => {
    expect(overrideTitle("python", "app.py")).toBe('python title="app.py"');
    expect(overrideTitle("{ .python }", "app.py")).toBe('{ .python title="app.py" }');
  });
});

describe("htmlToMd: inline code editor (.cl lines, inline title)", () => {
  /** Builds the inline code editor DOM: `.cl` lines + an optional `.filename`. */
  function inlineCode(info: string, lines: string[], filename?: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "highlight vcode";
    el.setAttribute("data-src-line", "0");
    el.setAttribute("data-src-end", String(lines.length + 2));
    el.setAttribute("data-block-type", "code");
    el.setAttribute("data-fence-info", info);
    const cls = lines.map((l) => `<span class="cl">${l}</span>`).join("");
    el.innerHTML =
      (filename !== undefined ? `<span class="filename">${filename}</span>` : "") +
      `<pre><code class="language-python">${cls}</code></pre>`;
    return el;
  }

  it("assembles the code text from .cl lines", () => {
    const el = inlineCode("python", ["x = 1", "y = 2"]);
    expect(serializeTopBlock(el)).toBe("```python\nx = 1\ny = 2\n```\n");
  });

  it("the inline title overrides the title from data-fence-info", () => {
    const el = inlineCode('python title="app.py"', ["x = 1"], "renamed.py");
    expect(serializeTopBlock(el)).toBe('```python title="renamed.py"\nx = 1\n```\n');
  });

  it("an annotation marker in a .cl line serializes as comment text", () => {
    const el = inlineCode("python", ["print(1)  # (1)!", "y = 2"]);
    expect(serializeTopBlock(el)).toBe("```python\nprint(1)  # (1)!\ny = 2\n```\n");
  });
});

describe("htmlToMd: unsafe blocks are rejected", () => {
  it("a raw HTML block is not serialized", () => {
    const host = document.createElement("div");
    host.innerHTML = '<div class="grid cards"><p>x</p></div>';
    expect(canSerialize(host.children[0])).toBe(false);
  });

  it("a named footnote marker round-trips via data-fn-label", () => {
    const blocks = renderBlocks("Text with a footnote[^note].\n\n[^note]: A note.\n");
    const para = blocks.find((b) => b.tagName === "P");
    expect(para).toBeDefined();
    expect(serializeTopBlock(para as Element)).toBe("Text with a footnote[^note].\n");
  });

  it("the hidden carrier returns the definition lines", () => {
    const blocks = renderBlocks("Text with a footnote[^1].\n\n[^1]: A note.\n");
    const defs = blocks.find((b) => b.classList.contains("footnote-defs"));
    expect(defs).toBeDefined();
    expect(serializeTopBlock(defs as Element)).toBe("[^1]: A note.\n");
  });

  it("an inline footnote (^[…]) has no label and is not serialized", () => {
    const blocks = renderBlocks("Text^[right in line].\n");
    const para = blocks.find((b) => b.tagName === "P");
    expect(para).toBeDefined();
    expect(canSerialize(para as Element)).toBe(false);
  });

  it("a formula without data-tex is not serialized", () => {
    const host = document.createElement("div");
    host.innerHTML = '<p><span class="katex">broken</span></p>';
    expect(canSerialize(host.children[0])).toBe(false);
  });
});
