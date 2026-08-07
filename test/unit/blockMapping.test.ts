// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { parseBlock } from "../../src/wizards/blockParsers";
import { getComponent } from "../../src/wizards/components";

const md = buildMarkdownEngine({ resolveIcon: () => "<svg></svg>", readSnippet: () => undefined });

interface Block {
  start: number;
  end: number;
  type: string;
}

/** Extracts the blocks carrying source-line markers from HTML. */
function extractBlocks(html: string): Block[] {
  const tagRe = /<[^>]*\bdata-block-type="[^"]*"[^>]*>/g;
  const blocks: Block[] = [];
  for (const m of html.matchAll(tagRe)) {
    const tag = m[0];
    const start = /data-src-line="(\d+)"/.exec(tag)?.[1];
    const end = /data-src-end="(\d+)"/.exec(tag)?.[1];
    const type = /data-block-type="([^"]*)"/.exec(tag)?.[1];
    if (start && end && type) {
      blocks.push({ start: Number(start), end: Number(end), type });
    }
  }
  return blocks;
}

describe("block → source → round-trip mapping (M6/M8 safety)", () => {
  const src = [
    "# Heading", // 0
    "", // 1
    '!!! note "Info"', // 2
    "    Text notes", // 3
    "", // 4
    "```python", // 5
    "x = 1", // 6
    "```", // 7
    "", // 8
  ].join("\n");

  const html = md.render(src);
  const lines = src.split("\n");
  const blocks = extractBlocks(html);

  it("admonition and code are marked with correct line ranges", () => {
    const types = blocks.map((b) => b.type);
    expect(types).toContain("admonition");
    expect(types).toContain("code");
  });

  it("the slice of every supported block is rebuilt by its generator", () => {
    let checked = 0;
    for (const b of blocks) {
      if (b.type !== "admonition" && b.type !== "code") {
        continue;
      }
      const slice = lines.slice(b.start, b.end).join("\n") + "\n";
      const parsed = parseBlock(slice, b.type);
      expect(parsed, `block ${b.type} [${b.start},${b.end}) must sort it out`).toBeTruthy();
      const component = getComponent(parsed!.id)!;
      // Generating from the parsed values yields the source slice byte for byte.
      expect(component.generate(parsed!.values as never)).toBe(slice);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe("block ranges do not swallow the blank separator line", () => {
  /** [data-src-line, data-src-end) ranges of the top-level blocks. */
  function ranges(src: string): Array<[string, number, number]> {
    const host = document.createElement("div");
    host.innerHTML = md.render(src);
    return Array.from(host.children)
      .filter((el) => el.hasAttribute("data-src-line"))
      .map((el) => [
        el.tagName,
        Number(el.getAttribute("data-src-line")),
        Number(el.getAttribute("data-src-end")),
      ]);
  }

  // markdown-it includes the trailing blank line in the map of lists: keeping
  // it inside the range would let a list edit erase the separator and glue it to the paragraph.
  it("list: the range ends at the last item", () => {
    expect(ranges("- one\n- two\n\nParagraph.\n")).toEqual([
      ["UL", 0, 2],
      ["P", 3, 4],
    ]);
  });

  it("ordered list and definition list", () => {
    expect(ranges("1. step\n\nTerm\n\n:   Definition.\n\nTail.\n")).toEqual([
      ["OL", 0, 1],
      ["DL", 2, 5],
      ["P", 6, 7],
    ]);
  });

  it("blockquote and admonition", () => {
    expect(ranges('> A quote.\n\n!!! note "N"\n    Text.\n\nTail.\n')).toEqual([
      ["BLOCKQUOTE", 0, 1],
      ["DIV", 2, 4],
      ["P", 5, 6],
    ]);
  });
});
