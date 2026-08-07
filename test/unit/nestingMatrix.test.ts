// @vitest-environment happy-dom
//
// Nesting matrix of MkDocs Material components: the combinations
// container ⊃ (container ⊃)* leaf up to depth 4 are generated automatically,
// and each one is checked for a round-trip of all top-level blocks.
//
// Containers (admonition, tabs, lists, blockquotes, grids) per the Material standard
// accept nested blocks at +4 indent; leaves (code, tables, diagrams,
// formulas) hold inline markup only — they appear in the matrix as nested items only.

import { describe, expect, it } from "vitest";
import { build, CONTAINERS, roundTripFail } from "./support/nesting";

/** Leaf insertions. */
const LEAVES: Record<string, string> = {
  para: "An ordinary paragraph.\n",
  code: "```python\nx = 1\n```\n",
  table: "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
  mermaid: "```mermaid\ngraph TD\n    A --> B\n```\n",
  math: "$$\nE = mc^2\n$$\n",
  image: "![Caption](image.png)\n",
  hr: "---\n",
  heading: "## Heading\n",
  bullets: "- one\n- two\n",
  numbers: "1. one\n2. two\n",
  // A list goes “loose” as soon as one item holds a block; the items the author
  // packed together have to stay packed anyway.
  looseList: "- one\n\n- two\n",
  mixedList: "- one\n- two\n\n    Nested.\n",
  quoteLeaf: "> A quote.\n",
  admLeaf: '!!! tip "Handy"\n    Text.\n',
  // A title spelled out even though it repeats the type: the render is the same
  // as without it, so only the source says which one the author wrote.
  admOwnTitle: '!!! note "Note"\n    Text.\n',
  tabsLeaf: '=== "And1"\n\n    A\n\n=== "And2"\n\n    B\n',
  codeTitle: '```python title="file.py" linenums="1"\nx = 1\n```\n',
  keys: "++ctrl+alt+del++\n",
  footnoteRef: "Text with a footnote.[^1]\n\n[^1]: A note.\n",
  deflist: "Term\n\n:   Definition.\n",
  html: '<div class="grid cards" markdown>\n\n- A card\n\n</div>\n',
};

const CN = Object.keys(CONTAINERS);
const LN = Object.keys(LEAVES);

// Subsets for the deeper levels (otherwise a combinatorial explosion).
const C3 = ["adm", "tabs", "ul", "ol", "quote", "grid", "admFold", "task"];
const L3 = ["para", "code", "table", "admLeaf", "bullets", "math"];
const C4 = ["adm", "tabs", "ul", "quote"];
const L4 = ["para", "code", "table"];

function nest(path: string[], leaf: string): string {
  return build(path, LEAVES[leaf]);
}

function run(cases: Array<{ name: string; src: string }>): string[] {
  const fails: string[] = [];
  for (const c of cases) {
    const f = roundTripFail(c.src);
    if (f) fails.push(`❌ ${c.name}\n${f}\n--- source ---\n${c.src}`);
  }
  return fails;
}

// `!!! note` and `!!! note "Note"` draw exactly the same block. The editor
// rewrites a block from what it drew, so without the render saying which form
// the file held, editing the text of such an admonition would silently take the
// title out of the author's file.
describe("the title of an admonition", () => {
  it("keeps one that was written out even though it repeats the type", () => {
    expect(roundTripFail('!!! note "Note"\n    Text.\n')).toBeNull();
  });

  it("keeps one on a collapsible block too", () => {
    expect(roundTripFail('??? note "Note"\n    Text.\n')).toBeNull();
  });

  it("does not invent one where the file has none", () => {
    expect(roundTripFail("!!! note\n    Text.\n")).toBeNull();
  });

  it("keeps a title suppressed on purpose", () => {
    expect(roundTripFail('!!! note ""\n    Text.\n')).toBeNull();
  });
});

describe("Material component nesting matrix", () => {
  it("depth 2: container ⊃ leaf (144 combinations)", () => {
    const cases: Array<{ name: string; src: string }> = [];
    for (const c of CN) {
      for (const l of LN) {
        cases.push({ name: `${c} ⊃ ${l}`, src: nest([c], l) });
      }
    }
    expect(run(cases).join("\n\n"), `failures of ${cases.length}`).toBe("");
  });

  it("depth 3: container ⊃ container ⊃ leaf (384 combinations)", () => {
    const cases: Array<{ name: string; src: string }> = [];
    for (const a of C3) {
      for (const b of C3) {
        for (const l of L3) {
          cases.push({ name: `${a} ⊃ ${b} ⊃ ${l}`, src: nest([a, b], l) });
        }
      }
    }
    expect(run(cases).join("\n\n"), `failures of ${cases.length}`).toBe("");
  });

  // A container is rarely the last thing in the one around it. Whatever follows
  // has to stay outside it: a block rule that reads its own end from the whole
  // document rather than from the piece it was handed runs past the end of the
  // quote it sits in and swallows the paragraph after it — and the next edit to
  // that page writes the paragraph into the file where it never was.
  it("a container with something after it (324 combinations)", () => {
    const cases: Array<{ name: string; src: string }> = [];
    for (const outer of CN) {
      for (const inner of CN) {
        for (const l of ["para", "admLeaf", "tabsLeaf", "code"]) {
          const body = CONTAINERS[inner](LEAVES[l]) + "\nAfter the inner block.\n";
          cases.push({ name: `${outer} ⊃ (${inner} ⊃ ${l}) + text`, src: CONTAINERS[outer](body) });
        }
      }
    }
    expect(run(cases).join("\n\n"), `failures of ${cases.length}`).toBe("");
  });

  it("depth 4: three containers ⊃ leaf (192 combinations)", () => {
    const cases: Array<{ name: string; src: string }> = [];
    for (const a of C4) {
      for (const b of C4) {
        for (const c of C4) {
          for (const l of L4) {
            cases.push({ name: `${a} ⊃ ${b} ⊃ ${c} ⊃ ${l}`, src: nest([a, b, c], l) });
          }
        }
      }
    }
    expect(run(cases).join("\n\n"), `failures of ${cases.length}`).toBe("");
  });
});
