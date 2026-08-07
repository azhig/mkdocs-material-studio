import { describe, it, expect } from "vitest";
import {
  blockSpan,
  dedentLines,
  indentLines,
  moveBlockEdits,
  type LineEdit,
} from "../../webviews/visual/blockMove";

/** Applies a batch of edits (source-text coordinates) — like a WorkspaceEdit. */
function apply(lines: string[], edits: LineEdit[]): string[] {
  let text = lines.join("\n") + "\n";
  const sorted = [...edits].sort((a, b) => b.start - a.start); // from the end, so coordinates do not shift
  for (const e of sorted) {
    const cur = text.split("\n");
    const head = cur.slice(0, e.start).join("\n");
    const tail = cur.slice(e.end).join("\n");
    text = (e.start > 0 ? head + "\n" : "") + e.text + tail;
  }
  return text.replace(/\n$/, "").split("\n");
}

const DOC = ["# Heading", "", "First paragraph.", "", "Second paragraph.", "", "Third paragraph."];

describe("block move: line edits", () => {
  it("moves a block down, separators stay single", () => {
    // “First paragraph” (line 2) is moved past “Second” (before line 6).
    const edits = moveBlockEdits(DOC, 2, 3, 6);
    expect(apply(DOC, edits)).toEqual([
      "# Heading",
      "",
      "Second paragraph.",
      "",
      "First paragraph.",
      "",
      "Third paragraph.",
    ]);
  });

  it("moves a block up", () => {
    // “Third paragraph” (line 6) goes to the very beginning.
    const edits = moveBlockEdits(DOC, 6, 7, 0);
    expect(apply(DOC, edits)).toEqual([
      "Third paragraph.",
      "",
      "# Heading",
      "",
      "First paragraph.",
      "",
      "Second paragraph.",
    ]);
  });

  it("moves a block to the end of the file", () => {
    const edits = moveBlockEdits(DOC, 0, 1, DOC.length);
    expect(apply(DOC, edits)).toEqual([
      "First paragraph.",
      "",
      "Second paragraph.",
      "",
      "Third paragraph.",
      "",
      "# Heading",
    ]);
  });

  it("moves a multiline block as a whole", () => {
    const doc = ["Text.", "", "```py", "x = 1", "```", "", "Tail."];
    expect(apply(doc, moveBlockEdits(doc, 2, 5, 0))).toEqual([
      "```py",
      "x = 1",
      "```",
      "",
      "Text.",
      "",
      "Tail.",
    ]);
  });

  it("keeps the indent of a nested block — moving inside an admonition", () => {
    const doc = ['!!! note "Name"', "", "    First.", "", "    Second.", "", "Outside."];
    expect(apply(doc, moveBlockEdits(doc, 2, 3, 6))).toEqual([
      '!!! note "Name"',
      "",
      "    Second.",
      "",
      "    First.",
      "",
      "Outside.",
    ]);
  });

  it("leaves the file alone when the anchor is the block's own place", () => {
    expect(moveBlockEdits(DOC, 2, 3, 2)).toEqual([]);
    expect(moveBlockEdits(DOC, 2, 3, 3)).toEqual([]); // the block's own separator
    expect(moveBlockEdits(DOC, 2, 3, 4)).toEqual([]); // “before the next one” = its own place
    expect(moveBlockEdits(DOC, 2, 3, 6)).not.toEqual([]);
  });

  it("batch edits do not overlap", () => {
    for (const anchor of [0, 6, DOC.length]) {
      const [del, ins] = moveBlockEdits(DOC, 2, 3, anchor);
      expect(ins.start === ins.end).toBe(true);
      expect(ins.start < del.start || ins.start > del.end).toBe(true);
    }
  });

  it("appends a newline when the file did not end with one", () => {
    const doc = ["One.", "", "Two."];
    const edits = moveBlockEdits(doc, 0, 1, doc.length, false);
    expect(edits[1].text).toBe("\n\nOne.\n");
  });
});

describe("block separator", () => {
  it("takes the blank line after the block", () => {
    expect(blockSpan(DOC, 2, 3)).toEqual({ start: 2, end: 4 });
  });

  it("for the last block in the file it takes the separator above", () => {
    expect(blockSpan(DOC, 6, 7)).toEqual({ start: 5, end: 7 });
  });

  it("for the only block there is nothing to extend", () => {
    expect(blockSpan(["One."], 0, 1)).toEqual({ start: 0, end: 1 });
  });
});

describe("indent of a nested block", () => {
  it("strips the common indent and puts it back", () => {
    const src = ["    - Item", "        - Nested", "", "    Tail."];
    const { indent, lines } = dedentLines(src);
    expect(indent).toBe("    ");
    expect(lines).toEqual(["- Item", "    - Nested", "", "Tail."]);
    expect(indentLines(lines, indent)).toEqual(src);
  });

  it("a top-level block has no indent", () => {
    const src = ["# Heading", "", "Text."];
    expect(dedentLines(src)).toEqual({ indent: "", lines: src });
    expect(indentLines(src, "")).toEqual(src);
  });

  it("blank lines get no indent (otherwise the file is left with junk)", () => {
    expect(indentLines(["Text.", "", "More."], "    ")).toEqual(["    Text.", "", "    More."]);
  });
});
