// @vitest-environment happy-dom
//
// Deleting a selection that crosses structure. The browser's native answer
// merges the blocks at the range's two ends; across a container boundary that
// beheads it — a real cut of a tab set standing before an admonition wrote
// `Intro.Title` and `!!! success ""` into the file. The guard cancels the
// native deletion for such selections and deletes with Range.deleteContents,
// which never merges.

import { beforeEach, describe, expect, it } from "vitest";
import {
  dangerousRange,
  deleteRangeSafely,
  initDeleteGuard,
} from "../../webviews/visual/deleteGuard";

let docEl: HTMLElement;

function build(): void {
  document.body.innerHTML =
    '<div id="doc" contenteditable="true">' +
    "<p id='intro'>Intro paragraph.</p>" +
    "<p id='second'>Second paragraph.</p>" +
    '<div id="island" class="tabbed-set" contenteditable="false"><div class="tabbed-block"><p>Tab body.</p></div></div>' +
    '<div id="adm" class="admonition success">' +
    "<p class='admonition-title' id='title'>Title</p>" +
    "<p id='body'>Body text.</p>" +
    "</div>" +
    "</div>";
  docEl = document.getElementById("doc")!;
}

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function text(id: string): Text {
  return document.getElementById(id)!.firstChild as Text;
}

beforeEach(build);

describe("what counts as dangerous", () => {
  it("a selection inside one paragraph is not", () => {
    const r = select(text("intro"), 0, text("intro"), 5);
    expect(dangerousRange(r, docEl)).toBe(false);
  });

  it("a selection across two plain paragraphs is not — merging them is normal", () => {
    const r = select(text("intro"), 6, text("second"), 6);
    expect(dangerousRange(r, docEl)).toBe(false);
  });

  it("a selected island is", () => {
    const island = document.getElementById("island")!;
    const r = document.createRange();
    r.selectNode(island);
    expect(dangerousRange(r, docEl)).toBe(true);
  });

  it("a selection from a paragraph into an admonition is", () => {
    const r = select(text("second"), 7, text("body"), 4);
    expect(dangerousRange(r, docEl)).toBe(true);
  });

  it("a selection from the title into the body is — the title must not eat the body", () => {
    const r = select(text("title"), 2, text("body"), 4);
    expect(dangerousRange(r, docEl)).toBe(true);
  });

  it("a whole selected block (endpoints at the root) is — even with no island in it", () => {
    const adm = document.getElementById("adm")!;
    const r = document.createRange();
    r.selectNode(adm);
    expect(dangerousRange(r, docEl)).toBe(true);
  });
});

describe("the safe deletion", () => {
  it("removes a selected island whole and leaves the neighbours alone", () => {
    const island = document.getElementById("island")!;
    const r = document.createRange();
    r.selectNode(island);
    deleteRangeSafely(r, docEl);
    expect(document.getElementById("island")).toBeNull();
    expect(document.getElementById("title")!.textContent).toBe("Title");
    expect(document.getElementById("intro")!.textContent).toBe("Intro paragraph.");
    // The caret has a home in a real block, not in the root between blocks.
    const sel = document.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    expect(sel.getRangeAt(0).startContainer).not.toBe(docEl);
  });

  it("a cross-container deletion removes what was selected and merges nothing", () => {
    const r = select(text("second"), 7, text("body"), 5);
    deleteRangeSafely(r, docEl);
    // The island and the title lay whole inside the selection — they go; the
    // half-selected paragraphs keep their remnants ON THEIR OWN SIDES of the
    // container boundary instead of being merged into one.
    expect(document.getElementById("island")).toBeNull();
    expect(document.getElementById("title")).toBeNull();
    expect(document.getElementById("second")!.textContent).toBe("Second ");
    expect(document.getElementById("body")!.textContent).toBe("text.");
    expect(document.getElementById("second")!.parentElement).toBe(docEl);
    expect(document.getElementById("body")!.parentElement!.id).toBe("adm");
  });
});

describe("the beforeinput hook", () => {
  it("cancels a native delete over a dangerous selection and does it safely", () => {
    initDeleteGuard(docEl);
    const island = document.getElementById("island")!;
    const r = document.createRange();
    r.selectNode(island);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    const e = new InputEvent("beforeinput", {
      inputType: "deleteByCut",
      bubbles: true,
      cancelable: true,
    });
    docEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.getElementById("island")).toBeNull();
    expect(document.getElementById("title")!.textContent).toBe("Title");
  });

  it("leaves a harmless selection to the browser", () => {
    initDeleteGuard(docEl);
    select(text("intro"), 0, text("intro"), 5);
    const e = new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
    });
    docEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe("the cut hook", () => {
  it("writes the selection to the clipboard itself and deletes safely", () => {
    initDeleteGuard(docEl);
    const island = document.getElementById("island")!;
    const r = document.createRange();
    r.selectNode(island);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    const dt = new DataTransfer();
    const e = new ClipboardEvent("cut", { clipboardData: dt, bubbles: true, cancelable: true });
    docEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(dt.getData("text/html")).toContain("tabbed-set");
    expect(document.getElementById("island")).toBeNull();
    expect(document.getElementById("title")!.textContent).toBe("Title");
  });

  it("leaves an ordinary cut to the browser — its clipboard is already right", () => {
    initDeleteGuard(docEl);
    select(text("intro"), 0, text("intro"), 5);
    const dt = new DataTransfer();
    const e = new ClipboardEvent("cut", { clipboardData: dt, bubbles: true, cancelable: true });
    docEl.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.getElementById("intro")!.textContent).toBe("Intro paragraph.");
  });
});
