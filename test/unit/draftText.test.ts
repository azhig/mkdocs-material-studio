// The working text of the visual editor: batches go in, and one edit comes out
// when the author saves.
//
// Everything the editor types passes through here before it reaches anybody's
// file, so a mistake in this arithmetic is a mistake in a document. The cases
// worth writing down are the ends: the last line of a file, a file that does
// not end in a newline, a batch that empties a range.

import { describe, expect, it } from "vitest";
import { applySyncEdits, draftEdit, isDraftDirty } from "../../src/wysiwyg/draftText";

const PAGE = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";

describe("applying a batch to the draft", () => {
  it("replaces a line range with new lines", () => {
    expect(applySyncEdits(PAGE, [{ start: 2, end: 3, text: "First paragraph, edited.\n" }])).toBe(
      "# Title\n\nFirst paragraph, edited.\n\nSecond paragraph.\n",
    );
  });

  it("inserts without covering anything", () => {
    expect(applySyncEdits(PAGE, [{ start: 2, end: 2, text: "Inserted.\n\n" }])).toBe(
      "# Title\n\nInserted.\n\nFirst paragraph.\n\nSecond paragraph.\n",
    );
  });

  it("removes a range when the text is empty", () => {
    expect(applySyncEdits(PAGE, [{ start: 2, end: 4, text: "" }])).toBe(
      "# Title\n\nSecond paragraph.\n",
    );
  });

  it("applies several edits in the coordinates they were built in", () => {
    // Both ranges describe the text as it stands now; applying the later one
    // first is what keeps the earlier one's lines where it expects them.
    const out = applySyncEdits(PAGE, [
      { start: 0, end: 1, text: "# A longer title\nwith two lines\n" },
      { start: 4, end: 5, text: "Second paragraph, edited.\n" },
    ]);
    expect(out).toBe(
      "# A longer title\nwith two lines\n\nFirst paragraph.\n\nSecond paragraph, edited.\n",
    );
  });

  it("keeps a file that does not end in a newline that way", () => {
    expect(applySyncEdits("one\ntwo", [{ start: 0, end: 1, text: "ONE\n" }])).toBe("ONE\ntwo");
  });

  it("empties a document without inventing a line", () => {
    expect(applySyncEdits(PAGE, [{ start: 0, end: 5, text: "" }])).toBe("");
  });
});

describe("the edit that saves the draft", () => {
  it("is nothing at all when the draft matches the file", () => {
    expect(draftEdit(PAGE, PAGE)).toBeUndefined();
    expect(isDraftDirty(PAGE, PAGE)).toBe(false);
  });

  it("covers only the lines that differ", () => {
    const draft = PAGE.replace("First paragraph.", "First paragraph, rewritten.");
    expect(draftEdit(PAGE, draft)).toEqual({
      start: 2,
      end: 3,
      text: "First paragraph, rewritten.\n",
    });
  });

  it("spans everything between the first and the last difference", () => {
    // Two separate changes come back as one range: a save is one undo step, and
    // the range is the stretch the author has been working in.
    const draft = "# Title\n\nOne.\n\nSecond paragraph.\n".replace("Second", "Two");
    expect(draftEdit(PAGE, draft)).toEqual({ start: 2, end: 5, text: "One.\n\nTwo paragraph.\n" });
  });

  it("appends at the end of the file", () => {
    expect(draftEdit(PAGE, PAGE + "\nA new line.\n")).toEqual({
      start: 5,
      end: 5,
      text: "\nA new line.\n",
    });
  });

  it("keeps a file that does not end in a newline that way", () => {
    const edit = draftEdit("one\ntwo", "one\nTWO");
    expect(edit).toEqual({ start: 1, end: 2, text: "TWO" });
    expect(applySyncEdits("one\ntwo", [edit!])).toBe("one\nTWO");
  });

  it("round-trips: applying it to the file gives the draft", () => {
    const drafts = [
      PAGE.replace("Title", "Heading"),
      PAGE + "\nAppended.\n",
      "",
      "# Only a title\n",
      PAGE.replace("\nSecond paragraph.\n", ""),
    ];
    for (const draft of drafts) {
      const edit = draftEdit(PAGE, draft);
      expect(edit, `draft ${JSON.stringify(draft)} differs from the file`).toBeDefined();
      expect(applySyncEdits(PAGE, [edit!])).toBe(draft);
    }
  });
});
