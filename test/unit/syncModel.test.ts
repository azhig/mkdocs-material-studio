// What the visual editor writes back to the file. This is the arithmetic that
// once cut a whole block out of a document, and until it was pulled out of the
// 10k-line webview module there was no way to state that case as a test.

import { describe, expect, it } from "vitest";
import {
  deleteEdit,
  dropDuplicateRanges,
  invertEdits,
  lineCountOf,
  planEdits,
  type BlockView,
} from "../../webviews/visual/syncModel";

/** A page of three paragraphs, blank lines and all. */
const LINES = ["First.", "", "Second.", "", "Third."];

const block = (over: Partial<BlockView> = {}): BlockView => ({ connected: true, ...over });

const plan = (blocks: BlockView[], over: Partial<Parameters<typeof planEdits>[0]> = {}) =>
  planEdits({ blocks, lines: LINES, endsNL: true, ...over });

describe("planEdits", () => {
  it("a changed block replaces its own lines", () => {
    const { edits, clearDirty } = plan([
      block({ range: { start: 0, end: 1 } }),
      block({ range: { start: 2, end: 3 }, dirty: true, text: "Second, edited.\n" }),
      block({ range: { start: 4, end: 5 } }),
    ]);
    expect(edits).toEqual([{ start: 2, end: 3, text: "Second, edited.\n" }]);
    expect(clearDirty).toEqual([1]);
  });

  it("an untouched block is not written back", () => {
    expect(plan([block({ range: { start: 0, end: 1 }, text: "First.\n" })]).edits).toEqual([]);
  });

  it("a draft goes in before the block that follows it", () => {
    const { edits, markPending } = plan([
      block({ range: { start: 0, end: 1 } }),
      block({ text: "New paragraph.\n" }),
      block({ range: { start: 2, end: 3 } }),
    ]);
    // Line 2 holds “Second.”, line 1 is blank: a separator is needed after the
    // insert but not before it.
    expect(edits).toEqual([{ start: 2, end: 2, text: "New paragraph.\n\n" }]);
    expect(markPending).toEqual([1]);
  });

  it("an empty draft is nothing to write", () => {
    expect(plan([block({ range: { start: 0, end: 1 } }), block({ text: "  \n" })]).edits).toEqual(
      [],
    );
  });

  it("a draft already in flight waits for its patch", () => {
    expect(plan([block({ text: "New.\n", pending: true })]).edits).toEqual([]);
  });

  it("erasing a block deletes it from the file and drops its range", () => {
    const { edits, dropRange } = plan([
      block({ range: { start: 0, end: 1 }, dirty: true, text: "\n" }),
      block({ range: { start: 2, end: 3 } }),
    ]);
    // The blank separator on line 1 goes with it.
    expect(edits).toEqual([{ start: 0, end: 2, text: "" }]);
    expect(dropRange).toEqual([0]);
  });

  it("a block the user removed is deleted", () => {
    const { edits } = plan([
      block({ range: { start: 0, end: 1 } }),
      block({ range: { start: 2, end: 3 }, dirty: true, connected: false }),
    ]);
    expect(edits).toEqual([{ start: 2, end: 4, text: "" }]);
  });

  it("a block that merely left the DOM is NOT a deletion", () => {
    // The regression: a catch-up patch replaces a node, the old one is detached
    // — and was read as “the user deleted this block”, so its lines were cut out
    // of the file. Only a block the user was editing counts.
    const { edits } = plan([
      block({ range: { start: 0, end: 1 } }),
      block({ range: { start: 2, end: 3 }, connected: false }),
    ]);
    expect(edits).toEqual([]);
  });

  it("a block that cannot be serialized leaves the file alone", () => {
    const { edits, clearDirty } = plan([block({ range: { start: 0, end: 1 }, dirty: true })]);
    expect(edits).toEqual([]);
    expect(clearDirty).toEqual([0]); // and stops being asked about
  });

  it("the footnotes tail is not content", () => {
    expect(plan([block({ service: true, text: "[^1]: note\n" })]).edits).toEqual([]);
  });

  it("a live editor keeps its range and writes nothing", () => {
    const { edits } = plan([
      block({ range: { start: 0, end: 1 }, live: true, dirty: true, text: "ignored" }),
    ]);
    expect(edits).toEqual([]);
  });

  it("two blocks claiming one line: the second becomes an insert", () => {
    // Enter inside a block splits it, and the browser copies data-src-* into the
    // new half. Both would otherwise write over the same lines.
    const blocks = [
      block({ range: { start: 2, end: 3 }, dirty: true, text: "Second.\n" }),
      block({ range: { start: 2, end: 3 }, dirty: true, text: "The new half.\n" }),
    ];
    expect(dropDuplicateRanges(blocks)).toEqual([1]);
  });

  it("a removal seen by the observer is added unless it overlaps an edit", () => {
    const overlapping = plan(
      [block({ range: { start: 0, end: 1 }, dirty: true, text: "Edited.\n" })],
      {
        removed: [{ start: 0, end: 1 }],
      },
    );
    expect(overlapping.edits).toEqual([{ start: 0, end: 1, text: "Edited.\n" }]);

    const apart = plan([block({ range: { start: 0, end: 1 }, dirty: true, text: "Edited.\n" })], {
      removed: [{ start: 4, end: 5 }],
    });
    expect(apart.edits).toEqual([
      { start: 0, end: 1, text: "Edited.\n" },
      { start: 4, end: 5, text: "" },
    ]);
  });

  it("source-only edits ride in the same batch", () => {
    const { edits } = plan([block({ range: { start: 0, end: 1 } })], {
      sourceEdits: [{ start: 5, end: 5, text: "[^1]: a note\n" }],
    });
    expect(edits).toEqual([{ start: 5, end: 5, text: "[^1]: a note\n" }]);
  });

  it("an insert at the end of a file without a trailing newline closes the last line", () => {
    const { edits } = planEdits({
      blocks: [block({ range: { start: 0, end: 1 } }), block({ text: "Added.\n" })],
      lines: ["Only line."],
      endsNL: false,
    });
    expect(edits).toEqual([{ start: 1, end: 1, text: "\n\nAdded.\n" }]);
  });
});

describe("invertEdits", () => {
  it("undoes a replacement by putting the old lines back", () => {
    const edits = [{ start: 2, end: 3, text: "Second, edited.\n" }];
    expect(invertEdits(edits, LINES)).toEqual([{ start: 2, end: 3, text: "Second.\n" }]);
  });

  it("undoes an insert by deleting what it added", () => {
    expect(invertEdits([{ start: 2, end: 2, text: "New.\n\n" }], LINES)).toEqual([
      { start: 2, end: 4, text: "" },
    ]);
  });

  it("undoes a deletion by inserting the lines back", () => {
    expect(invertEdits([{ start: 2, end: 4, text: "" }], LINES)).toEqual([
      { start: 2, end: 2, text: "Second.\n\n" },
    ]);
  });

  it("keeps later edits in the coordinates of the document after the earlier ones", () => {
    const edits = [
      { start: 0, end: 1, text: "One.\nTwo.\n" }, // one line becomes two
      { start: 4, end: 5, text: "Third, edited.\n" },
    ];
    const inverse = invertEdits(edits, LINES);
    expect(inverse[1]).toEqual({ start: 5, end: 6, text: "Third.\n" });
  });
});

describe("the small pieces", () => {
  it("counts the lines a piece of text adds", () => {
    expect(lineCountOf("")).toBe(0);
    expect(lineCountOf("one\n")).toBe(1);
    expect(lineCountOf("one\ntwo\n")).toBe(2);
    expect(lineCountOf("no trailing newline")).toBe(1);
  });

  it("a deletion absorbs the blank line after the block", () => {
    expect(deleteEdit(0, 1, LINES)).toEqual({ start: 0, end: 2, text: "" });
    // The last block has nothing after it to absorb.
    expect(deleteEdit(4, 5, LINES)).toEqual({ start: 4, end: 5, text: "" });
  });
});
