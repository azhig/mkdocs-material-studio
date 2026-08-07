// @vitest-environment happy-dom
//
// The mkdocstrings autodoc block (`::: identifier`). The content is produced by
// the Python plugin at site build time — here it is a stub island. The main thing
// we check: the block source (together with the YAML options and their indentation) survives
// render and serialization byte for byte, including inside containers.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock } from "../../webviews/visual/htmlToMd";

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

function renderBlocks(src: string): HTMLElement[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return Array.from(host.children) as HTMLElement[];
}

/** Every top-level block serializes back to the exact source slice. */
function expectRoundTrip(src: string): void {
  const lines = src.split("\n");
  const blocks = renderBlocks(src);
  expect(blocks.length).toBeGreaterThan(0);
  for (const el of blocks) {
    const start = Number(el.getAttribute("data-src-line"));
    const end = Number(el.getAttribute("data-src-end"));
    const slice = lines.slice(start, end).join("\n").replace(/\n+$/, "") + "\n";
    expect(serializeTopBlock(el), `block <${el.tagName.toLowerCase()}> @${start}`).toBe(slice);
  }
}

describe("mkdocstrings: `::: identifier`", () => {
  it("renders a card with the symbol name, not a paragraph", () => {
    const [block] = renderBlocks("::: fastapi.status\n");
    expect(block.className).toBe("mkdocstrings");
    expect(block.getAttribute("data-block-type")).toBe("mkdocstrings");
    expect(block.querySelector(".mkdocstrings-id")?.textContent).toBe("fastapi.status");
  });

  it("shows the YAML options of the block", () => {
    const src = "::: mypkg.module.Thing\n    options:\n      members_order: source\n";
    const [block] = renderBlocks(src);
    expect(block.querySelector(".mkdocstrings-options")?.textContent).toBe(
      "options:\n  members_order: source",
    );
    expect(block.getAttribute("data-mkdocstrings-src")).toBe(src.replace(/\n$/, ""));
  });

  it("byte-for-byte round-trip: the bare marker and the marker with options", () => {
    expectRoundTrip("::: fastapi.status\n");
    expectRoundTrip(
      "::: mypkg.module.Thing\n    handler: python\n    options:\n      show_root_heading: true\n",
    );
  });

  it("does not swallow the neighbouring blocks", () => {
    const src = "## Example\n\n::: fastapi.status\n\nText after of the block.\n";
    expectRoundTrip(src);
    const blocks = renderBlocks(src);
    expect(blocks.map((b) => b.tagName)).toEqual(["H2", "DIV", "P"]);
  });

  it("works inside an admonition (the container indent is stripped and restored)", () => {
    expectRoundTrip(
      '!!! note "API"\n    ::: mypkg.module\n        options:\n          heading_level: 3\n',
    );
  });

  it("leaves lookalike lines alone: `:::` without an identifier and text inside a code block", () => {
    const [plain] = renderBlocks(":::\n");
    expect(plain.tagName).toBe("P");
    const [fence] = renderBlocks("```\n::: fastapi.status\n```\n");
    expect(fence.className).toContain("highlight");
    expect(fence.textContent).toContain("::: fastapi.status");
  });
});
