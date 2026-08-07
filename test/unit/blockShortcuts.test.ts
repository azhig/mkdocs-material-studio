// @vitest-environment happy-dom
//
// Cut/copy the CURRENT block with the usual shortcuts. With a collapsed caret
// the browser does nothing on Cmd+C/X, so the editor answers instead: the
// block under the caret (or the activated island) is copied as Markdown and,
// for a cut, deleted by editing the file. What is asserted here: which block
// answers, what lands in the block clipboard, and what edit reaches the file.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";

type BlockHandle = typeof import("../../webviews/visual/blockHandle");
type Clipboard = typeof import("../../webviews/visual/blockClipboard");
type Core = typeof import("../../webviews/visual/editorCore");

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

let bh: BlockHandle;
let clip: Clipboard;
let core: Core;
let docEl: HTMLElement;
let posted: { type: string; edits?: { start: number; end: number; text: string }[] }[];

async function load(src: string): Promise<void> {
  vi.resetModules();
  document.body.innerHTML = "";
  docEl = document.createElement("div");
  docEl.id = "doc";
  docEl.setAttribute("contenteditable", "true");
  document.body.appendChild(docEl);
  posted = [];

  core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl: document.createElement("span"),
    post: (msg) => posted.push(msg as (typeof posted)[number]),
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    caretInBlock: () => false,
    inSub: () => false,
    renderSub: () => {},
  });
  core.adoptText(src, 1);
  docEl.innerHTML = md.render(src);

  bh = await import("../../webviews/visual/blockHandle");
  clip = await import("../../webviews/visual/blockClipboard");
  bh.initBlockHandle({
    docEl,
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    rangedAncestor: (el) => el?.closest<HTMLElement>("[data-src-line]") ?? null,
    indentOfLine: () => "",
    replaceLines: () => {},
    insertMarkdownBlock: () => {},
    openIslandEditor: () => {},
    hideTip: () => {},
    renderQuickMenu: () => {},
    isInlineCode: () => false,
    codeMenuItems: () => [],
    fenceInfoOf: () => ({ lang: "" }),
  });
}

function caretInto(el: Element): void {
  const range = document.createRange();
  range.setStart(el.firstChild ?? el, 0);
  range.collapse(true);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

const DOC = "First paragraph.\n\nSecond paragraph.\n";

describe("copy of the current block", () => {
  beforeEach(() => vi.useRealTimers());

  it("copies the block under the caret as its Markdown", async () => {
    await load(DOC);
    caretInto(docEl.children[1]);
    expect(bh.copyCurrentBlock()).toBe(true);
    expect(clip.ownBlockClipboard("Second paragraph.")).toBe(true);
    expect(clip.ownBlockClipboard("First paragraph.")).toBe(false);
  });

  it("prefers the activated island over a stale caret", async () => {
    await load("```mermaid\ngraph TD;A-->B;\n```\n\nA paragraph.\n");
    const island = docEl.querySelector<HTMLElement>(".mermaid")!;
    island.setAttribute("contenteditable", "false");
    caretInto(docEl.children[1]);
    bh.activateBlock(island);
    expect(bh.copyCurrentBlock()).toBe(true);
    expect(clip.ownBlockClipboard("```mermaid\ngraph TD;A-->B;\n```")).toBe(true);
  });

  it("from a tab label copies the whole tab set — clicking a tab is how it is picked", async () => {
    await load('=== "Tab 1"\n\n    Body.\n');
    const label = docEl.querySelector<HTMLElement>(".tabbed-labels > label")!;
    caretInto(label);
    bh.activateBlock(docEl.querySelector<HTMLElement>(".tabbed-set")!);
    expect(bh.copyCurrentBlock()).toBe(true);
    expect(clip.ownBlockClipboard('=== "Tab 1"\n\n    Body.')).toBe(true);
  });

  it("the caret landing inside the tab set does not pull the handle down from it", async () => {
    await load('=== "Tab 1"\n\n    Body.\n');
    const label = docEl.querySelector<HTMLElement>(".tabbed-labels > label")!;
    const set = docEl.querySelector<HTMLElement>(".tabbed-set")!;
    const inner = docEl.querySelector<HTMLElement>(".tabbed-block p")!;
    label.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    // Clicking a label also switches the tab, and the caret lands in the body:
    // the handle used to slide down and the cut took that paragraph instead.
    bh.followCaret(inner);
    expect(docEl.querySelector("[data-vactive]")).toBe(set);
  });

  it("does not answer from a label being renamed — the text owns the keys there", async () => {
    await load('=== "Tab 1"\n\n    Body.\n');
    const label = docEl.querySelector<HTMLElement>(".tabbed-labels > label")!;
    label.setAttribute("contenteditable", "true"); // a double-click starts the rename
    caretInto(label);
    expect(bh.copyCurrentBlock()).toBe(false);
  });
});

// Clicking inside tabs or a call-out always lands in some inner block, so the
// container itself could not be picked at all. Escape walks out of the text one
// container at a time, and the cut acts on whatever is marked.
describe("Escape marks blocks, one container wider each time", () => {
  const NESTED = '!!! note "Head"\n\n    Inner text.\n';

  it("marks the block of the caret, then its container, then nothing", async () => {
    await load(NESTED);
    const inner = docEl.querySelector<HTMLElement>(".admonition > p:not(.admonition-title)")!;
    caretInto(inner);
    bh.activateBlock(inner); // the handle follows the caret on its own

    // The first press stays where the caret is — it selects, it does not leave.
    expect(bh.escalateBlock()).toBe(true);
    expect(docEl.querySelector("[data-vactive]")).toBe(inner);

    expect(bh.escalateBlock()).toBe(true);
    expect(docEl.querySelector("[data-vactive]")).toBe(docEl.querySelector(".admonition"));

    expect(bh.escalateBlock()).toBe(false);
    expect(docEl.querySelector("[data-vactive]")).toBeNull();
  });

  it("the cut then takes the container, not the paragraph inside it", async () => {
    await load(NESTED);
    caretInto(docEl.querySelector<HTMLElement>(".admonition > p:not(.admonition-title)")!);
    bh.escalateBlock();
    bh.escalateBlock();
    expect(bh.cutCurrentBlock()).toBe(true);
    expect(clip.ownBlockClipboard('!!! note "Head"\n\n    Inner text.')).toBe(true);
  });

  it("survives the handle being told again where the caret is", async () => {
    await load(NESTED);
    const inner = docEl.querySelector<HTMLElement>(".admonition > p:not(.admonition-title)")!;
    caretInto(inner);
    bh.activateBlock(inner);
    bh.escalateBlock();
    bh.escalateBlock();
    // The caret has not moved — the selection was merely re-reported. Without
    // this the mark fell back to the paragraph and the cut took the wrong block.
    bh.followCaret(inner);
    expect(docEl.querySelector("[data-vactive]")).toBe(docEl.querySelector(".admonition"));
  });

  it("typing puts the handle back on the block being typed in", async () => {
    await load(NESTED);
    const inner = docEl.querySelector<HTMLElement>(".admonition > p:not(.admonition-title)")!;
    caretInto(inner);
    bh.activateBlock(inner);
    bh.escalateBlock();
    bh.escalateBlock();
    docEl.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", bubbles: true }));
    bh.followCaret(inner);
    expect(docEl.querySelector("[data-vactive]")).toBe(inner);
  });

  it("moving the caret starts the walk over from the block it landed in", async () => {
    await load(NESTED);
    const inner = docEl.querySelector<HTMLElement>(".admonition > p:not(.admonition-title)")!;
    caretInto(inner);
    bh.escalateBlock();
    bh.escalateBlock(); // marked: the call-out
    bh.activateBlock(inner); // as a click or the caret would
    expect(bh.escalateBlock()).toBe(true);
    expect(docEl.querySelector("[data-vactive]")).toBe(inner);
  });
});

describe("cut of the current block", () => {
  it("copies, then deletes the block by editing the file", async () => {
    await load(DOC);
    caretInto(docEl.children[1]);
    expect(bh.cutCurrentBlock()).toBe(true);
    expect(clip.ownBlockClipboard("Second paragraph.")).toBe(true);
    // The deletion is an edit of the block's own lines, not a DOM removal.
    await new Promise((r) => setTimeout(r, 0));
    const sync = posted.find((m) => m.type === "sync");
    expect(sync?.edits).toEqual([{ start: 2, end: 3, text: "" }]);
  });
});
