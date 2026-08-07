// @vitest-environment happy-dom
//
// A Material card grid is, in markup, a plain bulleted list inside
// `div.grid.cards` — but to the author a card is a card. Two things follow, and
// both broke in real use: the toolbar called the caret's card “a bulleted list”
// (and the lit button, when pressed, un-listed the cards and dissolved the
// grid); and there was no way to make a list INSIDE a card — the button
// retyped the card list itself.
//
// Every case here renders real markdown, drives the real selection helpers,
// applies the replacement to the file and re-renders — the assertion is on the
// bytes of the file and on what the grid still is afterwards.

import { beforeEach, describe, expect, it } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import * as core from "../../webviews/visual/editorCore";
import {
  enclosingTag,
  indentOfLine,
  initSelectionOps,
  rangedAncestor,
  selectionLines,
  selectionRange,
} from "../../webviews/visual/selectionOps";
import {
  applyList,
  initParagraphStyle,
  updateBlockButtons,
} from "../../webviews/visual/paragraphStyle";
import { splitCardParagraph } from "../../webviews/visual/tabsGrids";

const md = buildMarkdownEngine({
  resolveIcon: () => undefined,
  readSnippet: () => undefined,
});

const docEl = document.createElement("div");
docEl.id = "doc";

const GRID = [
  '<div class="grid cards" markdown>',
  "",
  "- **Card one**",
  "",
  "    Some words here.",
  "",
  "- **Card two**",
  "",
  "    Other words.",
  "",
  "</div>",
  "",
].join("\n");

function load(src: string): void {
  core.openLocalDoc(src);
  docEl.innerHTML = md.render(src);
}

/** Applies a replacement the way the editor does, and re-renders the file. */
function replaceForReal(start: number, end: number, lines: string[]): void {
  const next = [...core.docLines()];
  next.splice(start, end - start, ...lines.join("\n").replace(/\n+$/, "").split("\n"));
  load(next.join("\n") + "\n");
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.appendChild(docEl);
  // The two toolbar elements updateBlockButtons speaks to.
  const group = document.createElement("span");
  group.id = "vtList";
  group.innerHTML = '<button id="tbList"><span class="codicon"></span></button>';
  document.body.appendChild(group);

  const topBlockOf = (node: Node | null): Element | null => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return el?.closest("#doc > *") ?? null;
  };
  core.initCore({
    docEl,
    statusEl: document.createElement("span"),
    post: () => {},
    topBlockOf,
    caretInBlock: () => true,
    inSub: () => false,
    renderSub: () => {},
  });
  initSelectionOps({
    docEl,
    currentBlock: () => null,
    blocksInOrder: () => Array.from(docEl.children),
    caretIntoBlock: () => {},
    findBlockByStart: () => undefined,
    insertMarkdownBlock: () => {},
  });
  initParagraphStyle({
    docEl,
    cmd: () => {},
    currentBlock: () => null,
    caretIntoBlock: () => {},
    rangedAncestor,
    enclosingTag,
    indentOfLine,
    replaceLines: replaceForReal,
    selectionLines,
    selectionRange,
  });
});

/** Puts a collapsed caret inside the first element matching the selector. */
function caretIn(selector: string): void {
  const el = docEl.querySelector(selector);
  if (!el) throw new Error(`no ${selector} in the render`);
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Selects from the start of one element to the end of another. */
function selectAcross(fromSelector: string, toSelector: string): void {
  const from = docEl.querySelector(fromSelector);
  const to = docEl.querySelector(toSelector);
  if (!from || !to) throw new Error(`no ${fromSelector} or ${toSelector} in the render`);
  const range = document.createRange();
  range.setStartBefore(from.firstChild ?? from);
  range.setEndAfter(to.lastChild ?? to);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function cards(): HTMLElement[] {
  return Array.from(docEl.querySelectorAll<HTMLElement>(".grid.cards > ul > li"));
}

function listButtonOn(): boolean {
  return document.getElementById("vtList")?.classList.contains("on") === true;
}

describe("what the toolbar says about a card", () => {
  it("does not call a card a list", () => {
    load(GRID);
    caretIn(".grid.cards li p:nth-of-type(2)");
    updateBlockButtons();
    expect(listButtonOn()).toBe(false);
  });

  it("still calls an ordinary list a list", () => {
    // The same file, so silence in the card cannot come from a broken harness.
    load(GRID + "\n- outside item\n");
    caretIn("#doc > ul > li");
    updateBlockButtons();
    expect(listButtonOn()).toBe(true);
  });

  it("calls a list nested inside a card a list", () => {
    load(
      [
        '<div class="grid cards" markdown>',
        "",
        "- **Card one**",
        "",
        "    1. Step one",
        "    2. Step two",
        "",
        "</div>",
        "",
      ].join("\n"),
    );
    caretIn(".grid.cards li ol li");
    updateBlockButtons();
    expect(listButtonOn()).toBe(true);
  });
});

describe("making a list inside a card", () => {
  it("turns the card's paragraph into a nested numbered list", () => {
    load(GRID);
    caretIn(".grid.cards li p:nth-of-type(2)");
    applyList("ol");
    expect(core.fullText()).toBe(GRID.replace("    Some words here.", "    1. Some words here."));
    // The grid survived, and the list went INSIDE the first card.
    expect(cards()).toHaveLength(2);
    expect(cards()[0].querySelectorAll("ol > li")).toHaveLength(1);
  });

  it("leaves the file alone when the caret is on the card's title", () => {
    // The title lives on the card's own marker line. Listing that line would
    // tear the card off the grid — refusing is the only honest outcome.
    load(GRID);
    caretIn(".grid.cards li p:nth-of-type(1)");
    applyList("ol");
    expect(core.fullText()).toBe(GRID);
  });

  it("stays within the card when the selection runs into the next one", () => {
    load(GRID);
    selectAcross(".grid.cards li p:nth-of-type(2)", ".grid.cards li:nth-of-type(2) p");
    applyList("ul");
    expect(core.fullText()).toBe(GRID.replace("    Some words here.", "    - Some words here."));
    expect(cards()).toHaveLength(2);
  });

  it("splits at the caret and never leaves the card", () => {
    // Enter inside a card. The browser's own answer to Enter in a list item is
    // to split the item — for a grid that quietly mints a new card, and a card
    // fresh from “+ Card” (a bare title) could never be given a body.
    load(GRID);
    // Collapsed at (p, 0) — exactly where the caret lands after “+ Card”.
    caretIn(".grid.cards li p");
    const title = docEl.querySelector<HTMLElement>(".grid.cards li p") as HTMLElement;
    const card = title.closest("li") as HTMLElement;
    const next = splitCardParagraph(card);
    expect(next).not.toBeNull();
    expect(next?.parentElement).toBe(card);
    expect(title.nextElementSibling).toBe(next);
    // The card count did not change — that is the whole point.
    expect(cards()).toHaveLength(2);
  });

  it("gives a new paragraph a caret target when the split is at the end", () => {
    load(GRID);
    const desc = docEl.querySelector<HTMLElement>(".grid.cards li p:nth-of-type(2)") as HTMLElement;
    const text = desc.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, text.length);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const next = splitCardParagraph(desc.closest("li") as HTMLElement);
    expect(next?.textContent).toBe("");
    expect(next?.querySelector("br")).not.toBeNull();
    expect(desc.textContent).toBe("Some words here.");
  });

  it("carries the tail of the paragraph into the new one", () => {
    load(GRID);
    const desc = docEl.querySelector<HTMLElement>(".grid.cards li p:nth-of-type(2)") as HTMLElement;
    const text = desc.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, "Some words".length);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const next = splitCardParagraph(desc.closest("li") as HTMLElement);
    expect(desc.textContent).toBe("Some words");
    expect(next?.textContent).toBe(" here.");
  });

  it("appends a paragraph to a tight card, which has no paragraphs at all", () => {
    load(['<div class="grid cards" markdown>', "", "- One", "- Two", "", "</div>", ""].join("\n"));
    const card = docEl.querySelector<HTMLElement>(".grid.cards li") as HTMLElement;
    expect(card.querySelector("p")).toBeNull();
    caretIn(".grid.cards li");
    const next = splitCardParagraph(card);
    expect(next?.parentElement).toBe(card);
    expect(next?.querySelector("br")).not.toBeNull();
  });

  it("retypes a list nested in a card without touching the card", () => {
    const src = [
      '<div class="grid cards" markdown>',
      "",
      "- **Card one**",
      "",
      "    1. Step one",
      "    2. Step two",
      "",
      "</div>",
      "",
    ].join("\n");
    load(src);
    caretIn(".grid.cards li ol li");
    applyList("ul");
    expect(core.fullText()).toBe(
      src.replace("    1. Step one", "    - Step one").replace("    2. Step two", "    - Step two"),
    );
    expect(cards()).toHaveLength(1);
  });
});
