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
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock, canSerialize } from "../../webviews/visual/htmlToMd";

const md = buildMarkdownEngine({
  resolveIcon: (code) =>
    code.startsWith("material-") || code.startsWith("octicons-") || code.startsWith("fontawesome-")
      ? `<svg data-icon="${code}"><path d="M0"/></svg>`
      : undefined,
  readSnippet: () => undefined,
});

function roundTripFail(src: string): string | null {
  const lines = src.split("\n");
  const host = document.createElement("div");
  try {
    host.innerHTML = md.render(src);
  } catch (e) {
    return `render: ${String(e)}`;
  }
  const blocks = Array.from(host.children) as HTMLElement[];
  if (blocks.length === 0) return "no of the blocks";
  for (const el of blocks) {
    // Blocks with footnotes are marked non-editable at the top level too —
    // that is a deliberate limitation, not a nesting defect.
    if (!canSerialize(el)) continue;
    // The engine generates the footnote service tail itself (there are no source lines);
    // the editor marks it vservice and never writes it to the file.
    if (el.classList.contains("footnotes-sep") || el.classList.contains("footnotes")) continue;
    const startAttr = el.getAttribute("data-src-line");
    if (startAttr === null) return `no data-src-line on <${el.tagName.toLowerCase()}>`;
    const start = Number(startAttr);
    const end = Number(el.getAttribute("data-src-end"));
    const slice = lines.slice(start, end).join("\n").replace(/\n+$/, "") + "\n";
    let out: string;
    try {
      out = serializeTopBlock(el);
    } catch (e) {
      return `serialize: ${String(e)}`;
    }
    if (out !== slice) {
      return `<${el.tagName.toLowerCase()}>@${start}\n  expected: ${JSON.stringify(slice)}\n  got: ${JSON.stringify(out)}`;
    }
  }
  return null;
}

/** Indents the non-empty lines by n spaces. */
function ind(body: string, n = 4): string {
  const pad = " ".repeat(n);
  return body
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

type Wrap = (body: string) => string;

/** Containers: they take a markdown body with zero indent. */
const CONTAINERS: Record<string, Wrap> = {
  adm: (b) => `!!! note "A remark of mine"\n${ind(b)}`,
  admFold: (b) => `??? note "Collapsed"\n${ind(b)}`,
  tabs: (b) => `=== "First"\n\n${ind(b)}\n=== "Second"\n\n    Tail.\n`,
  ul: (b) => `- Item\n\n${ind(b)}`,
  ol: (b) => `1. Step\n\n${ind(b)}`,
  quote: (b) =>
    b
      .replace(/\n$/, "")
      .split("\n")
      .map((l) => (l.trim() === "" ? ">" : "> " + l))
      .join("\n") + "\n",
  task: (b) => `- [x] A task\n\n${ind(b)}`,
  grid: (b) => `<div class="grid" markdown>\n\n${b}\n</div>\n`,
};

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
  quoteLeaf: "> A quote.\n",
  admLeaf: '!!! tip "Handy"\n    Text.\n',
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

function build(path: string[], leaf: string): string {
  let src = LEAVES[leaf];
  for (let i = path.length - 1; i >= 0; i--) src = CONTAINERS[path[i]](src);
  return src;
}

function run(cases: Array<{ name: string; src: string }>): string[] {
  const fails: string[] = [];
  for (const c of cases) {
    const f = roundTripFail(c.src);
    if (f) fails.push(`❌ ${c.name}\n${f}\n--- source ---\n${c.src}`);
  }
  return fails;
}

describe("Material component nesting matrix", () => {
  it("depth 2: container ⊃ leaf (144 combinations)", () => {
    const cases: Array<{ name: string; src: string }> = [];
    for (const c of CN) {
      for (const l of LN) {
        cases.push({ name: `${c} ⊃ ${l}`, src: build([c], l) });
      }
    }
    expect(run(cases).join("\n\n"), `failures of ${cases.length}`).toBe("");
  });

  it("depth 3: container ⊃ container ⊃ leaf (384 combinations)", () => {
    const cases: Array<{ name: string; src: string }> = [];
    for (const a of C3) {
      for (const b of C3) {
        for (const l of L3) {
          cases.push({ name: `${a} ⊃ ${b} ⊃ ${l}`, src: build([a, b], l) });
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
            cases.push({ name: `${a} ⊃ ${b} ⊃ ${c} ⊃ ${l}`, src: build([a, b, c], l) });
          }
        }
      }
    }
    expect(run(cases).join("\n\n"), `failures of ${cases.length}`).toBe("");
  });
});
