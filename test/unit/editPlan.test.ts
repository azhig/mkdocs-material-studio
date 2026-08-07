// Where a batch of edits lands in the file.
//
// Checked against a reference: the operations are applied to plain text the way
// a WorkspaceEdit applies them — every offset taken in the ORIGINAL document,
// then spliced from the end backwards — and the result is compared with the
// text the author should see. A wrong range here does not throw, it silently
// writes over the neighbouring block, so the assertion has to be on the text.

import { describe, expect, it } from "vitest";
import {
  closeText,
  insertPosition,
  lineRange,
  planEditOps,
  type LineDoc,
} from "../../src/wysiwyg/editPlan";
import { planEdits, type BlockView } from "../../webviews/visual/syncModel";
import { applyBatch, docOf } from "./support/docEdits";

describe("planEditOps: replacements", () => {
  it("replaces a block in the middle and leaves its neighbours alone", () => {
    const text = "# Title\n\nFirst.\n\nSecond.\n";
    expect(applyBatch(text, [{ start: 2, end: 3, text: "Changed.\n" }])).toBe(
      "# Title\n\nChanged.\n\nSecond.\n",
    );
  });

  it("keeps the trailing newline of a file that has one", () => {
    const text = "# Title\n\nBody.\n";
    expect(applyBatch(text, [{ start: 2, end: 3, text: "Other.\n" }])).toBe("# Title\n\nOther.\n");
  });

  it("does not grow a file that ends without a newline", () => {
    // The block's markdown always ends with \n. At the end of a file that has
    // none, that newline would be a line the author never typed — and one more
    // on every touch.
    const text = "# Title\n\nBody.";
    expect(applyBatch(text, [{ start: 2, end: 3, text: "Other.\n" }])).toBe("# Title\n\nOther.");
  });

  it("replaces the last block of a file and keeps its trailing newline", () => {
    // "a\nb\nc\n" has a fourth, empty line; the block ends at 3, short of it, so
    // the newline that closes the file is not part of the range.
    const text = "a\nb\nc\n";
    expect(applyBatch(text, [{ start: 1, end: 3, text: "B\n" }])).toBe("a\nB\n");
  });

  it("replaces the whole document", () => {
    expect(applyBatch("old\n", [{ start: 0, end: 2, text: "new\n" }])).toBe("new");
  });

  it("applies independent replacements as one batch", () => {
    const text = "one\n\ntwo\n\nthree\n";
    expect(
      applyBatch(text, [
        { start: 0, end: 1, text: "ONE\n" },
        { start: 4, end: 5, text: "THREE\n" },
      ]),
    ).toBe("ONE\n\ntwo\n\nTHREE\n");
  });
});

describe("planEditOps: inserts", () => {
  it("inserts before a block", () => {
    const text = "# Title\n\nBody.\n";
    expect(applyBatch(text, [{ start: 2, end: 2, text: "New.\n\n" }])).toBe(
      "# Title\n\nNew.\n\nBody.\n",
    );
  });

  it("appends past the last line of a file that ends with a newline", () => {
    const text = "# Title\n";
    expect(applyBatch(text, [{ start: 1, end: 1, text: "\nNew.\n" }])).toBe("# Title\n\nNew.\n");
  });

  it("appends past the last line of a file that does not", () => {
    // There is no line 1 to insert at: the position has to be the end of line 0.
    const text = "# Title";
    expect(applyBatch(text, [{ start: 1, end: 1, text: "\nNew.\n" }])).toBe("# Title\nNew.\n");
  });

  it("inserts into an empty document", () => {
    expect(applyBatch("", [{ start: 0, end: 0, text: "New.\n" }])).toBe("New.\n");
  });

  it("inserts far past the end without reaching for a line that is not there", () => {
    const doc = docOf("a\nb");
    expect(insertPosition(doc, 99)).toEqual({ line: 1, ch: 1 });
  });
});

describe("planEditOps: deletions", () => {
  it("deletes a block together with the blank line after it", () => {
    const text = "one\n\ntwo\n\nthree\n";
    expect(applyBatch(text, [{ start: 2, end: 4, text: "" }])).toBe("one\n\nthree\n");
  });

  it("deletes the last block", () => {
    const text = "one\n\ntwo\n";
    expect(applyBatch(text, [{ start: 1, end: 3, text: "" }])).toBe("one\n");
  });

  it("deletes everything", () => {
    expect(applyBatch("one\ntwo\n", [{ start: 0, end: 3, text: "" }])).toBe("");
  });

  it("an empty range with empty text changes nothing", () => {
    const text = "one\ntwo\n";
    expect(applyBatch(text, [{ start: 1, end: 1, text: "" }])).toBe(text);
  });
});

describe("planEditOps: bounds", () => {
  it("returns one operation per edit, in order", () => {
    const ops = planEditOps(docOf("a\nb\nc\n"), [
      { start: 0, end: 1, text: "A\n" },
      { start: 1, end: 1, text: "x\n" },
      { start: 2, end: 3, text: "" },
    ]);
    expect(ops.map((o) => o.kind)).toEqual(["replace", "insert", "delete"]);
  });

  it("clamps a start line past the end of the document", () => {
    expect(lineRange(docOf("a\nbb"), 99, 99)).toEqual({
      start: { line: 1, ch: 0 },
      end: { line: 1, ch: 2 },
    });
  });

  it("ends the range where the text does when the end is past the last line", () => {
    expect(lineRange(docOf("a\nbb\n"), 1, 5)).toEqual({
      start: { line: 1, ch: 0 },
      end: { line: 2, ch: 0 },
    });
  });

  it("survives a document of no lines at all", () => {
    const empty: LineDoc = { lineCount: 0, lineLength: () => 0 };
    expect(insertPosition(empty, 0)).toEqual({ line: 0, ch: 0 });
    expect(lineRange(empty, 3, 7)).toEqual({ start: { line: 0, ch: 0 }, end: { line: 0, ch: 0 } });
  });

  it("closeText only drops the newline at the end of the file", () => {
    const doc = docOf("a\nb\nc\n");
    expect(closeText(doc, { start: 0, end: 1, text: "x\n" })).toBe("x\n");
    expect(closeText(doc, { start: 2, end: 4, text: "x\n" })).toBe("x");
    // Only one, and only at the very end.
    expect(closeText(doc, { start: 2, end: 4, text: "x\n\n" })).toBe("x\n");
  });
});

describe("the batch the editor builds actually lands where it should", () => {
  /** Blocks in document order, as the visual editor sees them. */
  function apply(text: string, blocks: BlockView[]): string {
    const endsNL = text.endsWith("\n");
    const lines = text.split("\n");
    if (endsNL) {
      lines.pop();
    }
    return applyBatch(text, planEdits({ blocks, lines, endsNL }).edits);
  }

  it("an edited paragraph reaches the file", () => {
    const text = "# Title\n\nBody.\n";
    const blocks: BlockView[] = [
      { range: { start: 0, end: 1 }, text: "# Title\n", connected: true },
      { range: { start: 2, end: 3 }, text: "Changed.\n", connected: true, dirty: true },
    ];
    expect(apply(text, blocks)).toBe("# Title\n\nChanged.\n");
  });

  it("a new block at the end of a file without a trailing newline", () => {
    const text = "# Title";
    const blocks: BlockView[] = [
      { range: { start: 0, end: 1 }, text: "# Title\n", connected: true },
      { text: "New.\n", connected: true, dirty: true },
    ];
    expect(apply(text, blocks)).toBe("# Title\n\nNew.\n");
  });

  it("an erased block leaves the file with its blank line", () => {
    const text = "one\n\ntwo\n\nthree\n";
    const blocks: BlockView[] = [
      { range: { start: 0, end: 1 }, text: "one\n", connected: true },
      { range: { start: 2, end: 3 }, text: "", connected: true, dirty: true },
      { range: { start: 4, end: 5 }, text: "three\n", connected: true },
    ];
    expect(apply(text, blocks)).toBe("one\n\nthree\n");
  });

  it("a block the user removed from the document leaves the file", () => {
    // deleteEdit absorbs the blank line that FOLLOWS a block; the last block has
    // none, so its separator stays behind. A blank line at the end of the file
    // renders as nothing and does not accumulate — it is left as it is.
    const text = "one\n\ntwo\n";
    const blocks: BlockView[] = [
      { range: { start: 0, end: 1 }, text: "one\n", connected: true },
      { range: { start: 2, end: 3 }, text: "two\n", connected: false, dirty: true },
    ];
    expect(apply(text, blocks)).toBe("one\n\n");
  });
});
