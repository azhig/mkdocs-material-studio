// @vitest-environment happy-dom
//
// The info string of a code fence. The editor reads it, the menu changes one
// thing in it, and it is written back — so what matters is that nothing the
// editor does not understand gets lost on the way through.

import { describe, expect, it } from "vitest";
import {
  buildFenceInfo,
  defaultTitleFor,
  hlSpec,
  parseFence,
  type FenceParts,
} from "../../webviews/visual/codeFence";

const fence = (info: string, ...body: string[]) => ["```" + info, ...body, "```"];

describe("parseFence", () => {
  it("reads a plain language", () => {
    const p = parseFence(fence("python", "print(1)"));
    expect(p.lang).toBe("python");
    expect(p.body).toEqual(["print(1)"]);
    expect(p.title).toBe("");
    expect(p.linenums).toBe(false);
  });

  it("reads the title, the numbering and the highlighted lines", () => {
    const p = parseFence(fence('py title="app.py" linenums="1" hl_lines="2 4-6"', "a", "b"));
    expect(p.title).toBe("app.py");
    expect(p.linenums).toBe(true);
    expect([...p.hl].sort((a, b) => a - b)).toEqual([2, 4, 5, 6]);
  });

  it("reads the brace form pymdownx uses", () => {
    const p = parseFence(fence('{ .python .copy title="app.py" hl_lines="1" }'));
    expect(p.lang).toBe("python");
    expect(p.extra).toEqual(["copy"]);
    expect(p.title).toBe("app.py");
  });

  it("keeps the attributes it has no opinion about", () => {
    const p = parseFence(fence('{ .js data-foo="bar" }'));
    expect(p.attrs).toEqual(['data-foo="bar"']);
  });

  it("an empty fence has no language and no body", () => {
    const p = parseFence(["```", "```"]);
    expect(p.lang).toBe("");
    expect(p.body).toEqual([]);
  });
});

describe("buildFenceInfo", () => {
  const parts = (over: Partial<FenceParts> = {}): FenceParts => ({
    lang: "python",
    title: "",
    linenums: false,
    hl: new Set<number>(),
    body: [],
    extra: [],
    attrs: [],
    ...over,
  });

  it("writes the plain form while it can", () => {
    expect(buildFenceInfo(parts())).toBe("python");
    expect(buildFenceInfo(parts({ title: "app.py", linenums: true }))).toBe(
      'python title="app.py" linenums="1"',
    );
  });

  it("switches to braces as soon as pymdownx parameters appear", () => {
    expect(buildFenceInfo(parts({ extra: ["copy"] }))).toBe("{ .python .copy }");
    expect(buildFenceInfo(parts({ attrs: ['data-foo="bar"'] }))).toBe('{ .python data-foo="bar" }');
  });

  it("a quote in a title would end the string early, so it becomes an apostrophe", () => {
    expect(buildFenceInfo(parts({ title: 'say "hi"' }))).toBe("python title=\"say 'hi'\"");
  });

  it("survives a round trip with everything set", () => {
    const info = '{ .python .copy title="app.py" linenums="1" hl_lines="2-4" data-x="1" }';
    expect(buildFenceInfo(parseFence(fence(info)))).toBe(info);
  });
});

describe("hlSpec", () => {
  it("collapses runs into ranges", () => {
    expect(hlSpec(new Set([2, 3, 4, 7]))).toBe("2-4 7");
    expect(hlSpec(new Set([5]))).toBe("5");
    expect(hlSpec(new Set())).toBe("");
  });

  it("does not care in what order the lines were clicked", () => {
    expect(hlSpec(new Set([9, 1, 2, 3]))).toBe("1-3 9");
  });
});

describe("defaultTitleFor", () => {
  it("offers the file name a reader expects for the language", () => {
    expect(defaultTitleFor("python")).toBe("app.py");
    expect(defaultTitleFor("YAML")).toBe("config.yml");
  });

  it("falls back to the language itself, and to a word when there is none", () => {
    expect(defaultTitleFor("brainfuck")).toBe("brainfuck");
    expect(defaultTitleFor("")).toBe("Title");
  });
});
