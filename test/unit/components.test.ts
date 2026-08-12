import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { setBundle } from "../../src/core/i18nCore";
import { getComponent, componentMetas, components } from "../../src/wizards/components";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";

const md = buildMarkdownEngine({ resolveIcon: () => "<svg></svg>", readSnippet: () => undefined });

function gen(id: string, values: Record<string, unknown>): string {
  const c = getComponent(id);
  if (!c) {
    throw new Error(`no of the component ${id}`);
  }
  return c.generate(values as never);
}

/** Strips the snippet tab stops so the render can be checked. */
function strip(s: string): string {
  return s.replace(/\$\{?\d+(:[^}]*)?\}?/g, "");
}

describe("component generators", () => {
  it("admonition — plain", () => {
    const out = gen("admonition", {
      type: "warning",
      title: "Warning",
      collapsible: "no",
      content: "Text",
    });
    expect(out).toContain('!!! warning "Warning"');
    expect(out).toContain("    Text");
    expect(md.render(out)).toContain('class="admonition warning"');
  });

  it("admonition — collapsible, expanded", () => {
    const out = gen("admonition", {
      type: "tip",
      title: "",
      collapsible: "expanded",
      content: "x",
    });
    expect(out.startsWith("???+ tip")).toBe(true);
  });

  it("tabs — N tabs", () => {
    const out = gen("tabs", { count: 3 });
    expect((out.match(/=== "Tab/g) ?? []).length).toBe(3);
    expect(md.render(strip(out))).toContain("tabbed-set");
  });

  it("code — language, title, line numbers", () => {
    const out = gen("code", {
      language: "python",
      title: "app.py",
      linenums: true,
      hl_lines: "2",
      content: "x=1",
    });
    expect(out).toContain("```python");
    expect(out).toContain('title="app.py"');
    expect(out).toContain('linenums="1"');
    expect(out).toContain('hl_lines="2"');
  });

  it("grid cards", () => {
    const out = gen("grid-cards", { count: 2 });
    expect(out).toContain('<div class="grid cards" markdown>');
    expect((out.match(/Title/g) ?? []).length).toBe(2);
  });

  it("button — primary", () => {
    expect(gen("button", { label: "OK", url: "/x", primary: true })).toBe(
      "[OK](/x){ .md-button .md-button--primary }",
    );
  });

  it("table — dimensions", () => {
    const out = gen("table", { cols: 2, rows: 1 });
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(3); // header + separator + 1 row
    expect(lines[0].split("|").filter((s) => s.trim()).length).toBe(2);
  });

  it("image — alignment and width", () => {
    expect(gen("image", { path: "a.png", alt: "A", align: "right", width: "300" })).toContain(
      '![A](a.png){ align=right width="300" }',
    );
  });

  it("mermaid — diagram type", () => {
    const out = gen("mermaid", { kind: "sequence" });
    expect(out).toContain("```mermaid");
    expect(out).toContain("sequenceDiagram");
  });

  it("plantuml — diagram language", () => {
    const out = gen("mermaid", { language: "plantuml", kind: "sequence" });
    expect(out).toContain("```plantuml");
    expect(out).toContain("@startuml");
    expect(out).toContain("Alice -> Bob");
  });

  it("math — block and inline", () => {
    expect(gen("math", { mode: "block", latex: "x^2" })).toBe("$$\nx^2\n$$\n");
    expect(gen("math", { mode: "inline", latex: "x" })).toBe("$x$");
  });

  it("keys / footnote / abbr / snippet / icon", () => {
    expect(gen("keys", { keys: "ctrl+c" })).toBe("++ctrl+c++");
    expect(gen("footnote", { id: "2", text: "note" })).toContain("[^2]: note");
    expect(gen("abbr", { abbr: "HTML", full: "HyperText" })).toBe("*[HTML]: HyperText\n");
    expect(gen("snippet", { path: "inc.md" })).toBe('--8<-- "inc.md"\n');
    expect(gen("icon", { shortcode: "material-github" })).toBe(":material-github:");
  });
});

describe("registry", () => {
  it("componentMetas carries no generate function", () => {
    const metas = componentMetas();
    expect(metas.length).toBe(components().length);
    expect((metas[0] as unknown as Record<string, unknown>).generate).toBeUndefined();
  });

  it("every component has a unique id and a generate function", () => {
    const ids = new Set<string>();
    for (const c of components()) {
      expect(typeof c.generate).toBe("function");
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });
});

// The palette used to inject its translator through a setTranslator() hook that
// nothing ever called, so `t` stayed the identity function and every one of the
// ~95 labels came out English whatever `mkdocsStudio.language` said. The bundle
// is installed here — after the import, as it is during activation — which is
// exactly the situation that hid the defect.
describe("the component palette speaks the configured language", () => {
  beforeEach(() => {
    setBundle("de", {
      "Callout block": "Hinweisblock",
      Blocks: "Blöcke",
      "Admonition / callout": "Hinweis",
      Type: "Typ",
    });
  });

  afterEach(() => {
    setBundle("en", {});
  });

  it("translates the label, the category and the description", () => {
    const admonition = getComponent("admonition");
    expect(admonition?.label).toBe("Hinweisblock");
    expect(admonition?.category).toBe("Blöcke");
    expect(admonition?.description).toBe("Hinweis");
  });

  it("translates the field labels the form is built from", () => {
    const field = getComponent("admonition")?.fields.find((f) => f.name === "type");
    expect(field?.label).toBe("Typ");
  });

  it("translates what is sent to the webview, not only what stays here", () => {
    const meta = componentMetas().find((m) => m.id === "admonition");
    expect(meta?.label).toBe("Hinweisblock");
  });

  it("follows a language change without a reload", () => {
    expect(getComponent("admonition")?.label).toBe("Hinweisblock");
    setBundle("fr", { "Callout block": "Bloc d'information" });
    expect(getComponent("admonition")?.label).toBe("Bloc d'information");
  });

  it("leaves a label the bundle does not carry in English", () => {
    expect(getComponent("admonition")?.fields.find((f) => f.name === "title")?.label).toBe(
      "Title (optional)",
    );
  });
});
