import { describe, it, expect } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";

const md = buildMarkdownEngine({
  resolveIcon: (code) => (code === "material-check" ? "<svg data-code></svg>" : undefined),
  readSnippet: (rel) => (rel === "inc.md" ? "# Enabled\n" : undefined),
});

function render(src: string): string {
  return md.render(src);
}

describe("admonition", () => {
  it("renders !!! note with a title", () => {
    const html = render('!!! note "A remark"\n    Text inside.\n');
    expect(html).toContain('<div class="admonition note"');
    expect(html).toContain('class="admonition-title"');
    expect(html).toContain("A remark");
    expect(html).toContain("Text inside.");
    expect(html).toContain('data-block-type="admonition"');
  });

  it("renders ??? as details (collapsed)", () => {
    const html = render('??? tip "Tip"\n    Hidden text.\n');
    expect(html).toContain('<details class="admonition tip"');
    expect(html).toContain("<summary");
    expect(html).not.toContain('<details class="admonition tip" open');
  });

  it("renders ???+ as open details", () => {
    const html = render('???+ warning "W"\n    body\n');
    expect(html).toMatch(/<details class="admonition warning"[^>]*open/);
  });

  it("falls back to the default title taken from the type", () => {
    const html = render("!!! danger\n    body\n");
    expect(html).toMatch(/class="admonition-title"[^>]*>Danger</);
  });
});

describe("content tabs", () => {
  it("groups consecutive tabs into a set", () => {
    const html = render('=== "A"\n    aaa\n\n=== "B"\n    bbb\n');
    expect(html).toContain('class="tabbed-set tabbed-alternate"');
    expect(html).toContain('data-tabs="1:2"');
    expect(html).toContain("<label"); // labels
    expect(html).toContain("aaa");
    expect(html).toContain("bbb");
    // The first tab is marked checked.
    expect(html).toContain("checked");
  });
});

describe("superfences", () => {
  it("highlights a plain code block", () => {
    const html = render("```python\nprint('hi')\n```\n");
    expect(html).toContain('class="highlight"');
    expect(html).toContain("hljs");
    // M6: the code wrapper carries the source-line markers and the block type
    expect(html).toMatch(/data-src-line="\d+"[^>]*data-block-type="code"/);
  });

  it("mermaid → pre.mermaid", () => {
    const html = render("```mermaid\ngraph TD; A-->B;\n```\n");
    expect(html).toContain('<pre class="mermaid"');
    expect(html).toContain('data-block-type="code"');
    expect(html).toContain("A--&gt;B");
  });

  it("plantuml and puml → pre.plantuml", () => {
    for (const language of ["plantuml", "puml"]) {
      const html = render(`\`\`\`${language}\n@startuml\nAlice -> Bob\n@enduml\n\`\`\`\n`);
      expect(html).toContain('<pre class="plantuml"');
      expect(html).toContain('data-block-type="code"');
      expect(html).toContain("Alice -&gt; Bob");
    }
  });

  it("title and linenums", () => {
    const html = render('```python title="app.py" linenums="1"\nx = 1\n```\n');
    expect(html).toContain('class="filename">app.py<');
    expect(html).toContain("linenums");
  });

  it("hl_lines marks lines", () => {
    const html = render('```python hl_lines="2"\na\nb\nc\n```\n');
    expect(html).toContain('class="hll"');
  });
});

describe("keys / math / icons / snippets", () => {
  it("keys ++ctrl+alt++", () => {
    const html = render("Press ++ctrl+alt+del++.");
    // data-keys stores the source notation for serialization in the visual editor.
    expect(html).toContain('<span class="keys" data-keys="++ctrl+alt+del++">');
    expect(html).toContain("<kbd");
    expect(html).toContain("Ctrl");
  });

  it("draws every key the Keys popup can record", () => {
    // The recorder and this table have to agree: a name the popup writes but the
    // renderer does not know comes out as the word “page-up” on the page.
    const html = render("++f5++ ++page-up++ ++arrow-left++ ++caps-lock++ ++insert++");
    expect(html).toContain(">F5<");
    expect(html).toContain(">Page Up<");
    expect(html).toContain(">←<");
    expect(html).toContain(">Caps Lock<");
    expect(html).toContain(">Insert<");
  });

  it("does not read a key name off Object's prototype", () => {
    // The name comes from the document: on a plain lookup table ++constructor++
    // printed the source of Object into the page.
    const html = render("++constructor++");
    expect(html).not.toContain("native code");
    expect(html).toContain("<kbd>constructor</kbd>");
  });

  it("inline math via katex", () => {
    const html = render("Formula $a^2+b^2$ here.");
    expect(html).toContain("katex");
  });

  it("block math $$", () => {
    const html = render("$$\n\\int x\\,dx\n$$\n");
    expect(html).toContain("katex");
  });

  it("Material icon via the resolver", () => {
    const html = render("Done :material-check: exactly.");
    // data-emoji stores the shortcode for serialization in the visual editor.
    expect(html).toContain('<span class="twemoji" data-emoji=":material-check:"><svg data-code>');
  });

  it("an unknown shortcode stays plain text", () => {
    const html = render("Text :unknown_thing: further.");
    expect(html).toContain(":unknown_thing:");
  });

  it("a snippet inlines the file contents", () => {
    const html = render('--8<-- "inc.md"\n');
    expect(html).toContain("Enabled");
  });

  it("a missing snippet → warning", () => {
    const html = render('--8<-- "no.md"\n');
    expect(html).toContain("Snippet not found");
  });
});

describe("source line mapping", () => {
  it("sets data-src-line on blocks", () => {
    const html = render("# Heading\n\nParagraph.\n");
    expect(html).toMatch(/data-src-line="0"/);
    expect(html).toMatch(/data-src-line="2"/);
  });
});

describe("standard pymdownx extensions", () => {
  it("task list", () => {
    const html = render("- [x] done\n- [ ] no\n");
    expect(html).toContain('type="checkbox"');
  });

  it("mark / sub / sup / caret-ins", () => {
    expect(render("==important==")).toContain("<mark>");
    expect(render("H~2~O")).toContain("<sub>");
    expect(render("x^2^")).toContain("<sup>");
    expect(render("^^insert^^")).toContain("<ins>");
  });

  it("footnotes", () => {
    const html = render("Text[^1].\n\n[^1]: Note.\n");
    expect(html).toContain("footnote");
  });

  it("definition list", () => {
    const html = render("Term\n:   Definition\n");
    expect(html).toContain("<dl");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
    expect(html).toContain("Definition");
  });
});
