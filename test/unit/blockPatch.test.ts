// @vitest-environment happy-dom
//
// Which blocks a render actually has to redraw.
//
// The editor patches the page block by block after every edit, and it used to
// replace every block on it — two hundred nodes rebuilt, and every button and
// island hung on them again, for one letter typed. That is what typing lag on a
// long page was.
//
// What makes it possible to leave a block alone is that almost nothing about it
// changes: opening a paragraph shifts the file lines of everything below it,
// and the markup stays word for word what the page already shows. So the
// comparison leaves the lines out — and the lines are then handed over on their
// own, all of them, including the ones inside a table or a call-out that the
// editor uses to write those rows back.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { copyNestedSrcAttrs, copySrcAttrs, renderKey } from "../../webviews/visual/blockPatch";

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

function blocks(src: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return Array.from(host.children) as HTMLElement[];
}

const PAGE = (lead: string): string =>
  `${lead}\n\n` +
  '!!! note "A note"\n\n    Body of the note.\n\n' +
  "| Code | Meaning |\n| ---- | ------- |\n| 11 | Nothing found |\n";

describe("what a render has to redraw", () => {
  it("leaves a block alone when only its file lines moved", () => {
    // The author opened a paragraph above: everything below now sits two lines
    // further down and says exactly what it said before.
    const before = blocks(PAGE("First."));
    const after = blocks(PAGE("First.\n\nA new paragraph."));
    expect(after.length).toBe(before.length + 1);
    // The call-out and the table below the new paragraph, unchanged but moved.
    for (let i = 0; i < 2; i++) {
      const was = before[before.length - 1 - i];
      const now = after[after.length - 1 - i];
      expect(now.getAttribute("data-src-line")).not.toBe(was.getAttribute("data-src-line"));
      expect(renderKey(now)).toBe(renderKey(was));
    }
  });

  it("sees a block whose content changed", () => {
    const [was] = blocks("A paragraph.\n");
    const [now] = blocks("A paragraph, longer.\n");
    expect(renderKey(now)).not.toBe(renderKey(was));
  });

  it("ignores the lines a table's own rows carry", () => {
    // They are attributes deep inside the block: comparing them would call
    // every table below an edit changed, which is most of a documentation page.
    const [table] = blocks("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(table.querySelectorAll("[data-src-line]").length).toBeGreaterThan(0);
    expect(renderKey(table)).not.toContain("data-src-line");
  });

  it("hands over every line number, not just the block's own", () => {
    const [was] = blocks("| a | b |\n| - | - |\n| 1 | 2 |\n");
    const [now] = blocks("Lead.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n").slice(1);
    copySrcAttrs(now, was);
    copyNestedSrcAttrs(now, was);
    const lineOf = (el: Element, sel: string): string | null =>
      el.querySelector(sel)?.getAttribute("data-src-line") ?? null;
    expect(was.getAttribute("data-src-line")).toBe(now.getAttribute("data-src-line"));
    expect(lineOf(was, "tbody tr")).toBe(lineOf(now, "tbody tr"));
  });

  it("hands over the lines inside a call-out too", () => {
    const src = '!!! note "A note"\n\n    Body of the note.\n';
    const [was] = blocks(src);
    const [now] = blocks(`Lead.\n\n${src}`).slice(1);
    copyNestedSrcAttrs(now, was);
    const lines = (el: Element): (string | null)[] =>
      Array.from(el.querySelectorAll("[data-src-line]")).map((n) =>
        n.getAttribute("data-src-line"),
      );
    expect(lines(was)).toEqual(lines(now));
    expect(lines(was).length).toBeGreaterThan(0);
  });

  it("leaves the page's block untouched when the two are not the same shape", () => {
    const [table] = blocks("| a | b |\n| - | - |\n| 1 | 2 |\n");
    const [para] = blocks("Just a paragraph.\n");
    const before = table.outerHTML;
    copyNestedSrcAttrs(para, table);
    expect(table.outerHTML).toBe(before);
  });
});
