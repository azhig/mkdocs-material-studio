// A batch of edits arriving from the webview. The editor sends well-formed
// ones; the point of the check is what happens when it does not — a NaN in a
// line number used to reach vscode.Range and throw from inside a message
// handler, far from anything that would explain it.

import { describe, expect, it } from "vitest";
import { parseSyncEdits } from "../../src/wysiwyg/syncEdits";

describe("parseSyncEdits", () => {
  it("reads an ordinary batch unchanged", () => {
    const edits = [
      { start: 2, end: 4, text: "one\ntwo\n" },
      { start: 9, end: 9, text: "inserted\n" },
      { start: 12, end: 15, text: "" },
    ];
    expect(parseSyncEdits(edits)).toEqual(edits);
  });

  it("an empty batch is a batch", () => {
    expect(parseSyncEdits([])).toEqual([]);
  });

  it("refuses a line number that is not one", () => {
    expect(parseSyncEdits([{ start: NaN, end: 1, text: "" }])).toBeUndefined();
    expect(parseSyncEdits([{ start: 0, end: Infinity, text: "" }])).toBeUndefined();
    expect(parseSyncEdits([{ start: -1, end: 2, text: "" }])).toBeUndefined();
    expect(parseSyncEdits([{ start: 1.5, end: 2, text: "" }])).toBeUndefined();
    expect(parseSyncEdits([{ start: "3", end: 4, text: "" }])).toBeUndefined();
  });

  it("refuses a range that runs backwards", () => {
    expect(parseSyncEdits([{ start: 7, end: 3, text: "x" }])).toBeUndefined();
  });

  it("refuses an entry that is not an edit at all", () => {
    expect(parseSyncEdits([null])).toBeUndefined();
    expect(parseSyncEdits(["replace lines 1-2"])).toBeUndefined();
    expect(parseSyncEdits([{ start: 1, end: 2 }])).toBeUndefined();
    expect(parseSyncEdits([{ start: 1, end: 2, text: 42 }])).toBeUndefined();
  });

  it("refuses something that is not a batch", () => {
    expect(parseSyncEdits(undefined)).toBeUndefined();
    expect(parseSyncEdits({ start: 1, end: 2, text: "" })).toBeUndefined();
    expect(parseSyncEdits("[]")).toBeUndefined();
  });

  it("one bad edit spoils the batch — a half-applied batch is worse than none", () => {
    expect(
      parseSyncEdits([
        { start: 0, end: 1, text: "fine\n" },
        { start: 5, end: 2, text: "not fine\n" },
      ]),
    ).toBeUndefined();
  });
});
