// Block operations on Markdown lines (lists, headings, blockquotes, indents).
// Pure functions — tested without a DOM and without the editor.

import { describe, expect, it } from "vitest";
import {
  parseListLine,
  toList,
  retypeList,
  fromList,
  setHeading,
  toQuote,
  fromQuote,
  headingLevel,
  itemRange,
  shiftLines,
  renumber,
  parseTabs,
  addTab,
  removeTab,
  renameTab,
  moveTab,
  parseCards,
  addCard,
  removeCard,
  moveCard,
} from "../../webviews/visual/blockOps";

describe("blockOps: parsing list lines", () => {
  it("bulleted, ordered, task", () => {
    expect(parseListLine("- text")).toEqual({
      indent: "",
      marker: "-",
      checked: null,
      text: "text",
    });
    expect(parseListLine("  1. text")).toEqual({
      indent: "  ",
      marker: "1.",
      checked: null,
      text: "text",
    });
    expect(parseListLine("- [x] done")).toEqual({
      indent: "",
      marker: "-",
      checked: true,
      text: "done",
    });
    expect(parseListLine("- [ ] no")).toEqual({
      indent: "",
      marker: "-",
      checked: false,
      text: "no",
    });
  });

  it("a plain line is not treated as an item", () => {
    expect(parseListLine("    simply text").marker).toBe("");
    expect(parseListLine("text - with a hyphen").marker).toBe("");
  });
});

describe("blockOps: paragraphs → list", () => {
  it("a single paragraph", () => {
    expect(toList(["Text."], "ul")).toEqual(["- Text."]);
    expect(toList(["Text."], "ol")).toEqual(["1. Text."]);
    expect(toList(["Text."], "task")).toEqual(["- [ ] Text."]);
  });

  it("several paragraphs — a tight list numbered in order", () => {
    expect(toList(["One.", "", "Two.", "", "Three."], "ol")).toEqual([
      "1. One.",
      "2. Two.",
      "3. Three.",
    ]);
  });

  it("a paragraph continuation is aligned under the item content", () => {
    expect(toList(["First line", "second line"], "ul")).toEqual(["- First line", "  second line"]);
  });

  it("the base indent is kept inside a nested block", () => {
    expect(toList(["    Text."], "ul", "    ")).toEqual(["    - Text."]);
  });

  it("an empty block yields an empty item", () => {
    expect(toList([""], "ul")).toEqual(["- "]);
  });
});

describe("blockOps: changing the list type", () => {
  it("bullets → numbers and back", () => {
    expect(retypeList(["- one", "- two"], "ol")).toEqual(["1. one", "2. two"]);
    expect(retypeList(["1. one", "2. two"], "ul")).toEqual(["- one", "- two"]);
  });

  it("to tasks and back — checkbox state is kept", () => {
    expect(retypeList(["- one", "- two"], "task")).toEqual(["- [ ] one", "- [ ] two"]);
    expect(retypeList(["- [x] one", "- [ ] two"], "task")).toEqual(["- [x] one", "- [ ] two"]);
    expect(retypeList(["- [x] one", "- [ ] two"], "ul")).toEqual(["- one", "- two"]);
    expect(retypeList(["- [x] one"], "ol")).toEqual(["1. one"]);
  });

  it("nested sub-items are left alone", () => {
    expect(retypeList(["- parent", "    - child", "- sibling"], "ol")).toEqual([
      "1. parent",
      "    - child",
      "2. sibling",
    ]);
  });

  it("a “loose” list keeps its blank lines", () => {
    expect(retypeList(["- one", "", "- two"], "ol")).toEqual(["1. one", "", "2. two"]);
  });
});

describe("blockOps: removing list formatting", () => {
  it("tight list — paragraphs separated by a blank line", () => {
    expect(fromList(["- one", "- two", "- three"])).toEqual(["one", "", "two", "", "three"]);
  });

  it("“loose” list", () => {
    expect(fromList(["- Text.", "", "- second"])).toEqual(["Text.", "", "second"]);
  });

  it("tasks lose their checkboxes", () => {
    expect(fromList(["- [x] done", "- [ ] no"])).toEqual(["done", "", "no"]);
  });

  it("a nested sublist moves one level up and stays a list", () => {
    expect(fromList(["- parent", "    - child", "- sibling"])).toEqual([
      "parent",
      "",
      "- child",
      "",
      "sibling",
    ]);
  });

  it("the base indent is kept inside a nested block", () => {
    expect(fromList(["    - one", "    - two"], "    ")).toEqual(["    one", "", "    two"]);
  });
});

describe("blockOps: headings and blockquotes", () => {
  it("paragraph → heading and back", () => {
    expect(setHeading(["Text"], 2)).toEqual(["## Text"]);
    expect(setHeading(["## Text"], 3)).toEqual(["### Text"]);
    expect(setHeading(["### Text"], 0)).toEqual(["Text"]);
  });

  it("a multiline paragraph becomes a single heading", () => {
    expect(setHeading(["First", "second"], 1)).toEqual(["# First second"]);
  });

  it("heading level", () => {
    expect(headingLevel("### Text")).toBe(3);
    expect(headingLevel("Text")).toBe(0);
    expect(headingLevel("####### Too many")).toBe(0);
  });

  it("blockquote: wrapping and unwrapping", () => {
    expect(toQuote(["One.", "", "Two."])).toEqual(["> One.", ">", "> Two."]);
    expect(fromQuote(["> One.", ">", "> Two."])).toEqual(["One.", "", "Two."]);
  });

  it("blockquote inside a nested block", () => {
    expect(toQuote(["    Text."], "    ")).toEqual(["    > Text."]);
    expect(fromQuote(["    > Text."], "    ")).toEqual(["    Text."]);
  });
});

describe("blockOps: item indentation", () => {
  it("item bounds include continuations and sub-items", () => {
    const lines = ["- one", "- two", "    - nested", "  continuation", "- three"];
    expect(itemRange(lines, 1)).toEqual({ start: 1, end: 4 });
    expect(itemRange(lines, 0)).toEqual({ start: 0, end: 1 });
  });

  it("an item with “loose” content after a blank line", () => {
    const lines = ["- one", "", "    A note.", "", "- two"];
    expect(itemRange(lines, 0)).toEqual({ start: 0, end: 3 });
  });

  it("indent and outdent", () => {
    expect(shiftLines(["- two", "    - nested"], true)).toEqual(["    - two", "        - nested"]);
    expect(shiftLines(["    - two"], false)).toEqual(["- two"]);
  });

  it("renumbering after an indent change", () => {
    expect(renumber(["1. one", "    1. nested", "3. two"])).toEqual([
      "1. one",
      "    1. nested",
      "2. two",
    ]);
  });

  it("renumbering leaves bulleted items and task checkboxes alone", () => {
    expect(renumber(["- one", "- two"])).toEqual(["- one", "- two"]);
    expect(renumber(["5. [x] one", "7. [ ] two"])).toEqual(["1. [x] one", "2. [ ] two"]);
  });
});

describe("blockOps: content tabs", () => {
  const tabs = ['=== "First"', "", "    One.", "", '=== "Second"', "", "    Two."];

  it("parsing a tab set", () => {
    expect(parseTabs(tabs)).toEqual([
      { title: "First", start: 0, end: 3 },
      { title: "Second", start: 4, end: 7 },
    ]);
  });

  it("adding a tab at the end", () => {
    expect(addTab(tabs, "Third")).toEqual([...tabs, "", '=== "Third"', "", ""]);
  });

  it("renaming keeps the expanded “===+” marker", () => {
    expect(renameTab(tabs, 1, "New")[4]).toBe('=== "New"');
    expect(renameTab(['===+ "A"', "", "    x"], 0, "B")[0]).toBe('===+ "B"');
  });

  it("removing a tab", () => {
    expect(removeTab(tabs, 0)).toEqual(['=== "Second"', "", "    Two."]);
    expect(removeTab(tabs, 1)).toEqual(['=== "First"', "", "    One."]);
  });

  it("the last tab is not removed", () => {
    const one = ['=== "One"', "", "    Text."];
    expect(removeTab(one, 0)).toEqual(one);
  });

  it("reordering tabs", () => {
    expect(moveTab(tabs, 0, 1)).toEqual([
      '=== "Second"',
      "",
      "    Two.",
      "",
      '=== "First"',
      "",
      "    One.",
    ]);
  });

  it("indented tabs (inside an admonition)", () => {
    const nested = ['    === "A"', "", "        x", "", '    === "B"', "", "        y"];
    expect(parseTabs(nested, "    ").map((s) => s.title)).toEqual(["A", "B"]);
    expect(addTab(nested, "In", "    ").slice(-3)).toEqual(['    === "In"', "", ""]);
  });
});

describe("blockOps: card grid", () => {
  const grid = [
    '<div class="grid cards" markdown>',
    "",
    "- First a card",
    "",
    "- Second a card",
    "",
    "</div>",
  ];

  it("parsing cards", () => {
    expect(parseCards(grid)).toEqual([
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it("adding a card", () => {
    expect(addCard(grid, "Third")).toEqual([
      '<div class="grid cards" markdown>',
      "",
      "- First a card",
      "",
      "- Second a card",
      "",
      "- Third",
      "",
      "</div>",
    ]);
  });

  it("removing a card", () => {
    expect(removeCard(grid, 0)).toEqual([
      '<div class="grid cards" markdown>',
      "",
      "- Second a card",
      "",
      "</div>",
    ]);
  });

  it("the last card is not removed", () => {
    const one = ['<div class="grid cards" markdown>', "", "- One", "", "</div>"];
    expect(removeCard(one, 0)).toEqual(one);
  });

  it("reordering cards", () => {
    expect(moveCard(grid, 1, 0)).toEqual([
      '<div class="grid cards" markdown>',
      "",
      "- Second a card",
      "",
      "- First a card",
      "",
      "</div>",
    ]);
  });

  it("a card with multiline content is moved as a whole", () => {
    const rich = [
      '<div class="grid cards" markdown>',
      "",
      "-   :material-clock: **Quick start**",
      "",
      "    ---",
      "",
      "    Install package.",
      "",
      "- Second",
      "",
      "</div>",
    ];
    expect(parseCards(rich)).toEqual([
      { start: 2, end: 7 },
      { start: 8, end: 9 },
    ]);
    expect(moveCard(rich, 1, 0).slice(2, 4)).toEqual(["- Second", ""]);
  });
});
