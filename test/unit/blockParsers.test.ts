import { describe, it, expect } from "vitest";
import { parseBlock } from "../../src/wizards/blockParsers";
import { getComponent } from "../../src/wizards/components";

function generate(id: string, values: Record<string, unknown>): string {
  const c = getComponent(id);
  if (!c) {
    throw new Error(`no of the component ${id}`);
  }
  return c.generate(values as never);
}

describe("reverse parsing of blocks (click-to-edit)", () => {
  it("admonition — plain, with a title", () => {
    const src = '!!! warning "Warning"\n    Text\n';
    const parsed = parseBlock(src, "admonition");
    expect(parsed).toEqual({
      id: "admonition",
      values: { type: "warning", title: "Warning", collapsible: "no", content: "Text" },
    });
    // round-trip: regeneration restores the source text
    expect(generate(parsed!.id, parsed!.values)).toBe(src);
  });

  it("admonition — expanded, no title, multiline", () => {
    const src = "???+ tip\n    line 1\n    line 2\n";
    const parsed = parseBlock(src, "admonition");
    expect(parsed!.values).toEqual({
      type: "tip",
      title: "",
      collapsible: "expanded",
      content: "line 1\nline 2",
    });
    expect(generate(parsed!.id, parsed!.values)).toBe(src);
  });

  it("admonition — collapsed (???)", () => {
    const parsed = parseBlock("??? note\n    x\n", "admonition");
    expect(parsed!.values.collapsible).toBe("collapsed");
  });

  it("admonition — with an inner blank line", () => {
    const src = "!!! note\n    paragraph 1\n\n    paragraph 2\n";
    const parsed = parseBlock(src, "admonition");
    expect(parsed!.values.content).toBe("paragraph 1\n\nparagraph 2");
    expect(generate(parsed!.id, parsed!.values)).toBe(src);
  });

  it("code — language, title, line numbers, highlighting", () => {
    const src = '```python title="app.py" linenums="1" hl_lines="2"\nx = 1\n```\n';
    const parsed = parseBlock(src, "code");
    expect(parsed).toEqual({
      id: "code",
      values: {
        language: "python",
        title: "app.py",
        linenums: true,
        hl_lines: "2",
        content: "x = 1",
      },
    });
    expect(generate(parsed!.id, parsed!.values)).toBe(src);
  });

  it("code — language only, multiline", () => {
    const src = "```js\nconsole.log(1)\nconsole.log(2)\n```\n";
    const parsed = parseBlock(src, "code");
    expect(parsed!.values).toEqual({
      language: "js",
      title: "",
      linenums: false,
      hl_lines: "",
      content: "console.log(1)\nconsole.log(2)",
    });
    expect(generate(parsed!.id, parsed!.values)).toBe(src);
  });

  it("code — mermaid is edited as code", () => {
    const src = "```mermaid\nflowchart TD\n  A --> B\n```\n";
    const parsed = parseBlock(src, "code");
    expect(parsed!.values.language).toBe("mermaid");
    expect(parsed!.values.content).toBe("flowchart TD\n  A --> B");
    expect(generate(parsed!.id, parsed!.values)).toBe(src);
  });
});

describe("reverse parsing — unsafe cases return undefined", () => {
  it("an indented (nested) admonition is not editable", () => {
    expect(parseBlock("    !!! note\n        x\n", "admonition")).toBeUndefined();
  });

  it("an admonition with several classes is not editable", () => {
    expect(parseBlock('!!! note inline "T"\n    x\n', "admonition")).toBeUndefined();
  });

  it("code with a ~~~ fence is not editable", () => {
    expect(parseBlock("~~~python\nx\n~~~\n", "code")).toBeUndefined();
  });

  it("code with a braced info string is not editable", () => {
    expect(parseBlock("```{ .python }\nx\n```\n", "code")).toBeUndefined();
  });

  it("unknown block type → undefined", () => {
    expect(parseBlock("any text", "paragraph")).toBeUndefined();
    expect(parseBlock("any text", undefined)).toBeUndefined();
  });
});
