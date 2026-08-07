// @vitest-environment happy-dom
//
// Writing the notes back as Markdown. An annotation list is a numbered list
// where item n is note n, so the notes are renumbered from scratch on every
// change — adding one in the middle renumbers the rest. A note longer than one
// line continues under a four-space indent; lose that indent and the
// continuation stops being part of the item, which quietly turns one note into
// two blocks and shifts every marker after it.

import { describe, expect, it } from "vitest";
import { renumberList, trailingBlankCount } from "../../webviews/visual/annotations";

describe("the notes as a numbered list", () => {
  it("numbers from one, in order", () => {
    expect(renumberList(["first", "second", "third"])).toBe("1. first\n2. second\n3. third");
  });

  it("is a single line for a single note", () => {
    expect(renumberList(["only"])).toBe("1. only");
  });

  it("is empty for no notes at all", () => {
    expect(renumberList([])).toBe("");
  });

  it("indents the continuation of a note by four spaces", () => {
    expect(renumberList(["first line\nsecond line"])).toBe("1. first line\n    second line");
  });

  it("leaves a blank line inside a note blank, not indented", () => {
    // Trailing whitespace on an “empty” line is whitespace in the file.
    expect(renumberList(["para one\n\npara two"])).toBe("1. para one\n\n    para two");
  });

  it("keeps each note's own continuation with it", () => {
    expect(renumberList(["one\nmore", "two"])).toBe("1. one\n    more\n2. two");
  });

  it("renumbers past nine without losing alignment of the marker", () => {
    const notes = Array.from({ length: 11 }, (_, i) => `note ${i + 1}`);
    const lines = renumberList(notes).split("\n");
    expect(lines[9]).toBe("10. note 10");
    expect(lines[10]).toBe("11. note 11");
  });
});

describe("counting the blank lines a block ends with", () => {
  it("is none when the last line has text", () => {
    expect(trailingBlankCount(["a", "b"])).toBe(0);
  });

  it("counts one", () => {
    expect(trailingBlankCount(["a", ""])).toBe(1);
  });

  it("counts several", () => {
    expect(trailingBlankCount(["a", "", "", ""])).toBe(3);
  });

  it("counts a line of spaces as blank", () => {
    expect(trailingBlankCount(["a", "   "])).toBe(1);
  });

  it("counts every line of an all-blank block", () => {
    expect(trailingBlankCount(["", ""])).toBe(2);
  });
});
