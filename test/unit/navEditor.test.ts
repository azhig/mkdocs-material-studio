import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";
import {
  moveNavItem,
  addNavPage,
  addNavSection,
  renameNavItem,
  removeNavItem,
} from "../../src/core/navEditor";

const SAMPLE = `site_name: Demo
# A comment about the navigation
nav:
  - Home: index.md   # start page
  - Section:
      - First: a.md
      - Second: b.md
`;

function edit(text: string, fn: (doc: import("yaml").Document) => void): string {
  const doc = parseDocument(text);
  fn(doc);
  return doc.toString();
}

describe("navEditor: preserving comments", () => {
  it("moving keeps the top-level comments", () => {
    const out = edit(SAMPLE, (doc) => moveNavItem(doc, [1, 1], [1], 0));
    expect(out).toContain("# A comment about the navigation");
    expect(out).toContain("# start page");
    // “Second” now comes before “the first”.
    const secondIdx = out.indexOf("Second");
    const firstIdx = out.indexOf("First");
    expect(secondIdx).toBeLessThan(firstIdx);
  });

  it("moving a top-level item changes the order", () => {
    // Dropping “Home” after “Section” (the position after the item with index 1 → 2).
    const out = edit(SAMPLE, (doc) => moveNavItem(doc, [0], [], 2));
    const homeIdx = out.indexOf("Home");
    const sectionIdx = out.indexOf("Section");
    expect(sectionIdx).toBeLessThan(homeIdx);
  });

  it("adding a page to the root", () => {
    const out = edit(SAMPLE, (doc) => addNavPage(doc, [], "About", "about.md"));
    expect(out).toContain("About: about.md");
    expect(out).toContain("# A comment about the navigation");
  });

  it("adding a section", () => {
    const out = edit(SAMPLE, (doc) => addNavSection(doc, [], "New"));
    expect(out).toMatch(/New:\s*\[\]/);
  });

  it("renaming an item", () => {
    const out = edit(SAMPLE, (doc) => renameNavItem(doc, [0], "Start"));
    expect(out).toContain("Start: index.md");
    expect(out).not.toContain("Home: index.md");
  });

  it("removing an item", () => {
    const out = edit(SAMPLE, (doc) => removeNavItem(doc, [1, 0]));
    expect(out).not.toContain("First: a.md");
    expect(out).toContain("Second: b.md");
  });
});
