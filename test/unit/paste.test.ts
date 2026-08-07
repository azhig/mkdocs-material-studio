// @vitest-environment happy-dom
//
// Clipboard paste: a fragment copied from a page in the browser arrives
// together with the styling of the source. We check that the structure survives while foreign
// styles and service nodes do not, and that a document with duplicate `{ #id }`
// (a typical consequence of such a paste) renders at all.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { fragmentHasContent, sanitizePastedHtml } from "../../webviews/shared/pasteSanitize";
import { serializeTopBlock } from "../../webviews/visual/htmlToMd";

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

function html(fragment: DocumentFragment): string {
  const host = document.createElement("div");
  host.appendChild(fragment);
  return host.innerHTML;
}

// The fragment exactly as the browser puts it on the clipboard when copying from an
// MkDocs Material page in dark theme (theme color and font, the “¶” anchor, Apple quirks).
const FROM_BROWSER = `
<h3 style="color: rgba(226, 228, 233, 0.82); font-family: Roboto;">Validation<a class="headerlink" href="https://example.com/#validation" title="Permanent link">¶</a></h3>
<ul style="caret-color: rgba(226, 228, 233, 0.82); color: rgba(226, 228, 233, 0.82);">
  <li><p>Validation for most Python<span class="Apple-converted-space"> </span><strong>data types</strong>, including:</p>
    <ul><li>JSON objects (<code style="display: inline-block; outline: medium;">dict</code>).</li></ul>
  </li>
</ul>`;

describe("sanitizing pasted HTML", () => {
  it("strips foreign styles but keeps the structure", () => {
    const out = html(sanitizePastedHtml(FROM_BROWSER, document));
    expect(out).not.toContain("style=");
    expect(out).not.toContain("rgba(226");
    expect(out).not.toContain("Roboto");
    // The structure is the whole point of pasting.
    expect(out).toContain("<h3>");
    expect(out).toContain("<ul>");
    expect(out).toContain("<strong>data types</strong>");
    expect(out).toContain("<code>dict</code>");
  });

  it("cuts out the “¶” anchor of a Material page together with its link", () => {
    const out = html(sanitizePastedHtml(FROM_BROWSER, document));
    expect(out).not.toContain("¶");
    expect(out).not.toContain("headerlink");
    expect(out).not.toContain("Permanent link");
  });

  it("keeps the meaningful attributes of links and images", () => {
    const out = html(
      sanitizePastedHtml(
        '<p class="x"><a href="/docs" class="md-link" data-md="1">doc</a>' +
          '<img src="a.png" alt="Diagram" width="800" loading="lazy"></p>',
        document,
      ),
    );
    expect(out).toContain('<a href="/docs">doc</a>');
    expect(out).toContain('src="a.png"');
    expect(out).toContain('alt="Diagram"');
    expect(out).not.toContain("width=");
    expect(out).not.toContain("loading=");
    expect(out).not.toContain("class=");
  });

  it("unwraps unknown tags without losing text", () => {
    const out = html(
      sanitizePastedHtml("<div><section>Text <span>inside</span></section></div>", document),
    );
    expect(out).not.toContain("<div");
    expect(out).not.toContain("<span");
    expect(out).toContain("Text inside");
  });

  it("drops scripts and hidden content", () => {
    const out = html(
      sanitizePastedHtml(
        "<p>ok</p><script>alert(1)</script><span hidden>a secret</span>",
        document,
      ),
    );
    expect(out).not.toContain("alert");
    expect(out).not.toContain("a secret");
    expect(out).toContain("ok");
  });

  // Copying a block inside the editor itself goes through the same clipboard path.
  // Without the structural classes an admonition would collapse into flat text.
  it("keeps the Material block classes", () => {
    const adm = html(
      sanitizePastedHtml(
        '<div class="admonition tip vfocus" data-src-line="3" contenteditable="true">' +
          '<p class="admonition-title">Tip</p><p>Text.</p></div>',
        document,
      ),
    );
    expect(adm).toContain('class="admonition tip"');
    expect(adm).toContain('class="admonition-title"');
    expect(adm).not.toContain("vfocus"); // editor service class
    expect(adm).not.toContain("data-src-line"); // source lines are irrelevant here
    expect(adm).not.toContain("contenteditable");
  });

  it("keeps the language and the per-line markup of a code block", () => {
    const code = html(
      sanitizePastedHtml(
        '<div class="highlight linenums" data-fence-info="py title=&quot;a.py&quot;">' +
          '<span class="filename">a.py</span><pre><code class="language-py">' +
          '<span class="cl">x = 1</span><span class="cl hll">y = 2</span></code></pre></div>',
        document,
      ),
    );
    expect(code).toContain('class="language-py"');
    expect(code).toContain('class="cl"'); // otherwise lines glue together: `.cl` has no “\n”
    expect(code).toContain('class="filename"');
    expect(code).not.toContain("data-fence-info"); // the serializer will build the info string
  });

  it("does not turn a foreign `note` class into an admonition", () => {
    const out = html(
      sanitizePastedHtml('<div class="note">Just paragraph of the site</div>', document),
    );
    expect(out).not.toContain("class=");
    expect(out).toContain("Just paragraph of the site");
  });

  it("keeps the text of a heading copied from our own preview", () => {
    // markdown-it-anchor wraps the whole heading text in the anchor, unlike
    // Material's “¶”: dropping the element would delete the heading itself.
    const out = html(
      sanitizePastedHtml(
        '<h2 id="quick-start"><a class="header-anchor" href="#quick-start">Quick start</a></h2>',
        document,
      ),
    );
    expect(out).toContain("Quick start");
    expect(out).not.toContain("header-anchor");
    expect(out).not.toContain("<a");
  });

  it("reports that there is nothing to paste", () => {
    expect(fragmentHasContent(sanitizePastedHtml("<p>  </p>", document))).toBe(false);
    expect(fragmentHasContent(sanitizePastedHtml("<p>text</p>", document))).toBe(true);
    expect(fragmentHasContent(sanitizePastedHtml('<p><img src="a.png"></p>', document))).toBe(true);
  });
});

describe("duplicate user anchor `{ #id }`", () => {
  const SRC = "### Validation { #validation }\n\ntext\n\n### Validation { #validation }\n";

  it("does not break the render: the id is made unique, as in MkDocs", () => {
    const out = md.render(SRC);
    expect(out).toContain('id="validation"');
    expect(out).toContain('id="validation_1"');
  });

  it("the author's anchor goes back to the file, not the uniquified one", () => {
    const host = document.createElement("div");
    host.innerHTML = md.render(SRC);
    const heads = Array.from(host.querySelectorAll("h3"));
    expect(heads).toHaveLength(2);
    for (const h of heads) {
      expect(serializeTopBlock(h)).toBe("### Validation { #validation }\n");
    }
  });

  it("an auto id still does not reach the file", () => {
    const host = document.createElement("div");
    host.innerHTML = md.render("## One\n\n## One\n");
    const heads = Array.from(host.querySelectorAll("h2"));
    expect(heads.map((h) => h.getAttribute("id"))).toEqual(["one", "one_1"]);
    expect(serializeTopBlock(heads[1])).toBe("## One\n");
  });
});

describe("cut and paste of the editor's own blocks", () => {
  /** The rendered block, decorated with the editor's own chrome, as a cut copies it. */
  function editorClipboard(markdown: string): string {
    const host = document.createElement("div");
    host.innerHTML = md.render(markdown);
    for (const label of Array.from(host.querySelectorAll(".tabbed-labels > label"))) {
      const x = document.createElement("button");
      x.className = "vtab-x";
      x.textContent = "×";
      label.appendChild(x);
    }
    const labels = host.querySelector(".tabbed-labels");
    if (labels) {
      const add = document.createElement("button");
      add.className = "vtab-add";
      add.textContent = "+";
      labels.appendChild(add);
    }
    for (const li of Array.from(host.querySelectorAll(".grid > ul > li"))) {
      const grip = document.createElement("span");
      grip.className = "vgctl vcard-grip";
      grip.textContent = "⠿";
      li.prepend(grip);
    }
    return host.innerHTML;
  }

  it("a tab set round-trips: sanitize keeps the labels, the serializer gets its markers back", () => {
    const clip = editorClipboard('=== "Tab 1"\n\n    Body one.\n\n=== "Tab 2"\n\n    Body two.\n');
    const box = document.createElement("div");
    box.appendChild(sanitizePastedHtml(clip, document));
    const set = box.querySelector(".tabbed-set")!;
    expect(serializeTopBlock(set)).toBe(
      '=== "Tab 1"\n\n    Body one.\n\n=== "Tab 2"\n\n    Body two.\n',
    );
  });

  it("the editor's tab chrome does not leak into the titles", () => {
    const clip = editorClipboard('=== "Tab 1"\n\n    Body one.\n');
    const box = document.createElement("div");
    box.appendChild(sanitizePastedHtml(clip, document));
    expect(box.textContent).not.toContain("×");
    expect(box.textContent).not.toContain("+");
  });

  it("a card grid round-trips without the grip glyph", () => {
    const src = '<div class="grid cards" markdown>\n\n- **One**\n\n    Text one.\n\n</div>\n';
    const clip = editorClipboard(src);
    const box = document.createElement("div");
    box.appendChild(sanitizePastedHtml(clip, document));
    expect(box.textContent).not.toContain("⠿");
    const grid = box.querySelector(".grid")!;
    expect(serializeTopBlock(grid)).toBe(src);
  });

  it("the clipboard's own md_in_html opening tag is not trusted into the file", () => {
    const clip =
      '<div class="grid cards" data-md-html-open="&lt;div onclick=evil()&gt;" markdown><ul><li>A</li></ul></div>';
    const box = document.createElement("div");
    box.appendChild(sanitizePastedHtml(clip, document));
    const grid = box.querySelector(".grid")!;
    expect(grid.getAttribute("data-md-html-open")).toBe('<div class="grid cards" markdown>');
  });

  it("a rendered diagram keeps its Mermaid source through the sanitizer", () => {
    const clip = '<pre class="mermaid" data-mermaid-src="graph TD;A-->B;"><svg>drawn</svg></pre>';
    const box = document.createElement("div");
    box.appendChild(sanitizePastedHtml(clip, document));
    const pre = box.querySelector(".mermaid")!;
    expect(pre.getAttribute("data-mermaid-src")).toBe("graph TD;A-->B;");
    expect(serializeTopBlock(pre)).toContain("graph TD;A-->B;");
  });

  it("inline islands keep the source attributes the serializer reads", () => {
    // Keys, an icon, an inline formula, a footnote marker: what they SHOW is
    // the render, what goes back into Markdown lives in the data attribute.
    // (The icon is spelled out by hand — this engine resolves no icons.)
    const clip =
      md.render("Press ++ctrl+alt++ for $E=mc^2$, see[^1].\n\n[^1]: Note.\n") +
      '<p><span class="twemoji" data-emoji=":material-check:"><svg data-code></svg></span></p>';
    const out = html(sanitizePastedHtml(clip, document));
    expect(out).toContain('data-keys="++ctrl+alt++"');
    expect(out).toContain('data-emoji=":material-check:"');
    expect(out).toContain('data-tex="E=mc^2"');
    expect(out).toContain('data-fn-label="1"');
  });

  it("a snippet island round-trips to its marker, not to the expanded text", () => {
    const clip = '<div class="snippet-include" data-snippet-path="inc.md"><p>Expanded.</p></div>';
    const box = document.createElement("div");
    box.appendChild(sanitizePastedHtml(clip, document));
    expect(serializeTopBlock(box.querySelector(".snippet-include")!)).toBe('--8<-- "inc.md"\n');
  });
});
