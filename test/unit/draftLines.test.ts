// @vitest-environment happy-dom
//
// Where the author can still write. At the end of the document there is always
// a paragraph; inside a tab, a card or a call-out the container ends right
// below its last block, and after a diagram, a table or a line made of nothing
// but a button there was nowhere left to click. Two answers, both from Notion:
// a click zone at the bottom of the container, and a hint that marks the ONE
// empty line the caret is in.
//
// The file must not notice any of it: nothing is added before the click, and an
// empty paragraph serializes to no lines at all.

import { describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { serializeTopBlock } from "../../webviews/visual/htmlToMd";
import {
  containerBelowClick,
  dropPlaceholderBreak,
  openTrailingLine,
  pruneDraftLines,
  updateDraftHint,
} from "../../webviews/visual/draftLines";

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

function render(src: string): HTMLElement {
  const host = document.createElement("div");
  host.id = "doc";
  host.innerHTML = md.render(src);
  document.body.appendChild(host);
  return host;
}

const TAB_WITH_DIAGRAM = [
  '=== "Alpha"',
  "",
  "    Plain text.",
  "",
  '=== "Beta"',
  "",
  "    ```mermaid",
  "    flowchart TD",
  "    ```",
  "",
].join("\n");

describe("the click zone at the bottom of a container", () => {
  it("opens a line in the tab and hands it over for the caret", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const panel = host.querySelectorAll<HTMLElement>(".tabbed-block")[1];
    const line = openTrailingLine(panel);
    expect(line.tagName).toBe("P");
    expect(panel.lastElementChild).toBe(line);
  });

  it("reuses the empty line it already opened", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const panel = host.querySelectorAll<HTMLElement>(".tabbed-block")[1];
    const first = openTrailingLine(panel);
    expect(openTrailingLine(panel)).toBe(first);
    expect(panel.querySelectorAll("p")).toHaveLength(1);
  });

  it("belongs to the container itself, not to a block inside it", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const panel = host.querySelectorAll<HTMLElement>(".tabbed-block")[1];
    const diagram = panel.firstElementChild!;
    // A click that landed on a block is that block's business.
    expect(containerBelowClick(diagram, 1000)).toBeNull();
    // A click on the container's own padding, below everything in it.
    expect(containerBelowClick(panel, 1000)).toBe(panel);
  });

  it("adds nothing to the file until something is written in the line", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const set = host.querySelector<HTMLElement>(".tabbed-set")!;
    const before = serializeTopBlock(set);
    const line = openTrailingLine(host.querySelectorAll<HTMLElement>(".tabbed-block")[1]);
    expect(serializeTopBlock(set)).toBe(before);
    line.textContent = "Below the diagram.";
    expect(serializeTopBlock(set)).toContain("\n\n    Below the diagram.\n");
  });
});

describe("the line the click zone lends out", () => {
  it("goes away when the caret leaves it empty", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const panel = host.querySelectorAll<HTMLElement>(".tabbed-block")[1];
    openTrailingLine(panel);
    expect(panel.querySelectorAll("p")).toHaveLength(1);

    // The caret went to the text of the first tab — nothing was written here.
    pruneDraftLines(host, host.querySelector(".tabbed-block p"));
    expect(panel.querySelectorAll("p")).toHaveLength(0);
  });

  it("stays while the caret is still in it", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const panel = host.querySelectorAll<HTMLElement>(".tabbed-block")[1];
    const line = openTrailingLine(panel);
    pruneDraftLines(host, line);
    expect(panel.lastElementChild).toBe(line);
  });

  it("stops being a loan once something is written in it", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const panel = host.querySelectorAll<HTMLElement>(".tabbed-block")[1];
    const line = openTrailingLine(panel);
    line.textContent = "Below the diagram.";
    pruneDraftLines(host, line);
    // Written in, then left: the line is the author's now and must survive.
    pruneDraftLines(host, null);
    expect(panel.lastElementChild).toBe(line);
    expect(line.hasAttribute("data-vdraft")).toBe(false);
  });

  it("never takes away a line the author made", () => {
    const host = render("Text.\n\nMore text.\n");
    const own = document.createElement("p");
    own.appendChild(document.createElement("br"));
    host.appendChild(own);
    pruneDraftLines(host, null);
    expect(host.lastElementChild).toBe(own);
  });
});

describe("the <br> that holds an empty line open", () => {
  it("goes when something is put in the line, so the file gets no hard break", () => {
    const host = render(TAB_WITH_DIAGRAM);
    const set = host.querySelector<HTMLElement>(".tabbed-set")!;
    const line = openTrailingLine(host.querySelectorAll<HTMLElement>(".tabbed-block")[1]);

    dropPlaceholderBreak(line);
    const keys = document.createElement("span");
    keys.className = "keys";
    keys.setAttribute("data-keys", "++ctrl+alt+del++");
    line.appendChild(keys);

    // A <br> left beside the insert is written as “  ” at the end of the line.
    expect(serializeTopBlock(set)).toContain("\n\n    ++ctrl+alt+del++\n");
  });

  it("stays in a line that has text of its own", () => {
    const host = render("Text.\n");
    const line = host.firstElementChild!;
    line.appendChild(document.createElement("br"));
    dropPlaceholderBreak(line);
    expect(line.querySelector("br")).not.toBeNull();
  });
});

describe("the hint", () => {
  it("marks the empty line the caret is in, and no other", () => {
    const host = render("Text.\n");
    const first = openTrailingLine(host);
    const second = document.createElement("p");
    second.appendChild(document.createElement("br"));
    host.appendChild(second);

    updateDraftHint(host, first, "Keep writing…");
    expect(first.getAttribute("data-vph")).toBe("Keep writing…");
    expect(second.hasAttribute("data-vph")).toBe(false);

    // The caret moves on: the hint goes with it instead of staying behind.
    updateDraftHint(host, second, "Keep writing…");
    expect(first.hasAttribute("data-vph")).toBe(false);
    expect(second.getAttribute("data-vph")).toBe("Keep writing…");
  });

  it("goes away once the line has text in it", () => {
    const host = render("Text.\n");
    const line = openTrailingLine(host);
    updateDraftHint(host, line, "Keep writing…");
    line.textContent = "Now it says something.";
    updateDraftHint(host, line, "Keep writing…");
    expect(line.hasAttribute("data-vph")).toBe(false);
  });

  it("shows nowhere while the caret sits in ordinary text", () => {
    const host = render("Text.\n");
    const line = openTrailingLine(host);
    updateDraftHint(host, line, "Keep writing…");
    updateDraftHint(host, host.firstElementChild, "Keep writing…");
    expect(host.querySelectorAll("p[data-vph]")).toHaveLength(0);
  });
});
