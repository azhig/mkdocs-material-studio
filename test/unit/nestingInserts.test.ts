// @vitest-environment happy-dom
//
// Inserting a component while the caret sits inside another one.
//
// Where a new block goes is decided by the INDENT of the line the caret is on —
// there is no search for a container. That one rule has to hold for every
// component at every depth, and when it does not the damage is quiet: the block
// lands one level out of the admonition it was meant for, or its indent turns
// the text around it into a code fence. Both came back from real use.
//
// Every case here drives the real form the way a user does, applies the batch
// the way the provider applies it, and re-renders the file. Three things must
// hold afterwards: the component sits in the same container as the caret,
// nothing else in the file moved, and every block still writes back byte for
// byte.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InsertPoint } from "../../webviews/visual/blockInserts";
import type { SyncEdit } from "../../webviews/visual/syncModel";
import { applyBatch } from "./support/docEdits";
import { build, CONTAINERS, md, roundTripFail } from "./support/nesting";

type Core = typeof import("../../webviews/visual/editorCore");
type Menu = typeof import("../../webviews/visual/componentMenu");
type Inserts = typeof import("../../webviews/visual/blockInserts");
type Media = typeof import("../../webviews/visual/mediaLinks");
type Ops = typeof import("../../webviews/visual/selectionOps");
type Mermaid = typeof import("../../webviews/visual/mermaidDialog");
type Inline = typeof import("../../webviews/visual/inlineElements");
type Icons = typeof import("../../webviews/visual/iconPicker");

/** The paragraph the caret is put in; it also marks the place in the render. */
const MARK = "Caret paragraph.";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Editor {
  core: Core;
  menu: Menu;
  inserts: Inserts;
  media: Media;
  ops: Ops;
  mermaid: Mermaid;
  inline: Inline;
  icons: Icons;
  docEl: HTMLElement;
  /** Puts a file in front of the editor, rendered the way the extension sends it. */
  load(src: string): void;
  /** Puts the caret at the end of the marker paragraph. */
  caretAtMark(): boolean;
  /** The batch of the last insert, or null when nothing was sent. */
  lastEdits(): SyncEdit[] | null;
}

/**
 * The editor with everything an insert touches wired to the real modules: the
 * palette decides the point, the forms build the markdown, the core turns it
 * into a batch. Only the extension at the far end is a stand-in.
 */
async function makeEditor(): Promise<Editor> {
  vi.resetModules();
  // The icon picker fetches its index of Material icons. There is nothing to
  // serve it here, and left alone it reaches for a live port and fills the log;
  // it treats a failure as “no icons”, and the emoji are built in anyway.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in a test")));
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  const statusEl = document.createElement("span");
  // Every form anchors itself to the “+ Insert” button.
  const anchor = document.createElement("button");
  anchor.id = "tbComponent";
  document.body.append(docEl, statusEl, anchor);

  const posts: Array<{ type?: string; edits?: SyncEdit[] }> = [];
  const post = (msg: unknown): void => {
    posts.push(msg as { type?: string; edits?: SyncEdit[] });
  };
  const topBlockOf = (node: Node | null): Element | null => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return el?.closest("#doc > *") ?? null;
  };
  const currentBlock = (): Element | null => {
    const sel = document.getSelection();
    return sel && sel.rangeCount > 0 ? topBlockOf(sel.anchorNode) : null;
  };

  const core: Core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl,
    post,
    topBlockOf,
    caretInBlock: () => currentBlock() !== null,
    inSub: () => false,
    renderSub: () => {},
  });

  const menu: Menu = await import("../../webviews/visual/componentMenu");
  menu.initComponentMenu({
    docEl,
    post,
    currentBlock,
    iconSvgs: () => Promise.resolve({}),
    pinnedButtons: () => [],
  });

  const inserts: Inserts = await import("../../webviews/visual/blockInserts");
  inserts.initInserts({
    insertPoint: () => menu.insertPoint(),
    insertMarkdownBlock: (template, at) => menu.insertMarkdownBlock(template, at),
    popupAnchor: () => menu.insertPopupAnchor(),
    blockByStart: () => undefined,
    caretInto: () => {},
    pickFile: () => Promise.resolve({ rel: "includes/abbreviations.md", webUri: "" }),
    linkSuggestions: () => [],
  });

  const media: Media = await import("../../webviews/visual/mediaLinks");
  media.initMediaLinks({
    docEl,
    post,
    activePage: () => undefined,
    chromeData: () => undefined,
    enclosingTag: () => null,
    topBlockOf,
    ensureTrailingDraft: () => {},
    insertPoint: () => menu.insertPoint(),
    insertMarkdownBlock: (template, at) => menu.insertMarkdownBlock(template, at),
  });

  const mermaid: Mermaid = await import("../../webviews/visual/mermaidDialog");
  mermaid.initMermaidDialog({
    insertBlock: (markdown, at) => menu.insertMarkdownBlock(markdown, at as InsertPoint),
    insertPoint: () => menu.insertPoint(),
  });

  const inline: Inline = await import("../../webviews/visual/inlineElements");
  inline.initInlineElements({
    insertInline: (el) => media.insertInline(el),
    saveSelection: () => media.saveSelection(),
    restoreSelection: () => media.restoreSelection(),
    enclosingTag: (node, tagName) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest<HTMLElement>(tagName) ?? null;
    },
    openLinkPopup: () => {
      throw new Error("the link popup is not part of these cases");
    },
    insertLinkAtSelection: () => {
      throw new Error("the link popup is not part of these cases");
    },
  });

  const icons: Icons = await import("../../webviews/visual/iconPicker");
  icons.initIconPicker({
    iconNames: () => Promise.resolve({ material: ["home", "star"] }),
    iconSvgs: (codes) =>
      Promise.resolve(Object.fromEntries(codes.map((c) => [c, `<svg data-code="${c}"></svg>`]))),
    anchor: () => anchor,
    insertInline: (el) => media.insertInline(el),
    markDirty: (node) => core.markDirty(node),
    saveSelection: () => media.saveSelection(),
    restoreSelection: () => media.restoreSelection(),
  });

  const ops: Ops = await import("../../webviews/visual/selectionOps");
  ops.initSelectionOps({
    docEl,
    currentBlock,
    blocksInOrder: () => Array.from(docEl.children),
    caretIntoBlock: () => {},
    findBlockByStart: () => undefined,
    insertMarkdownBlock: (template) => menu.insertMarkdownBlock(template),
  });

  return {
    core,
    menu,
    inserts,
    media,
    ops,
    docEl,
    mermaid,
    inline,
    icons,
    load(src) {
      posts.length = 0;
      // The extension has answered whatever was sent before; without this the
      // core would still think a batch is in flight and hold the next one back.
      core.finishRemote();
      core.clearForRender();
      // The render arrives from the extension: the observers must not read it as
      // the user typing the whole document in.
      core.mutedRemote(() => {
        docEl.innerHTML = md.render(src);
      });
      core.adoptText(src, 1);
    },
    caretAtMark() {
      const target = markerIn(docEl);
      if (!target) {
        return false;
      }
      caretIn(target);
      return true;
    },
    lastEdits() {
      const sync = posts.filter((m) => m.type === "sync").at(-1);
      return sync?.edits ?? null;
    },
  };
}

/** Puts the caret at the very end of an element, the way a click there would. */
function caretIn(target: Element): void {
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    last = n as Text;
  }
  const range = document.createRange();
  if (last) {
    range.setStart(last, last.data.length);
  } else {
    range.selectNodeContents(target);
  }
  range.collapse(true);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** The innermost element holding exactly the marker text. */
function markerIn(root: ParentNode): Element | null {
  const all = Array.from(root.querySelectorAll("*")).filter(
    (el) => (el.textContent ?? "").trim() === MARK,
  );
  return all.find((el) => !all.some((other) => other !== el && el.contains(other))) ?? null;
}

// --- driving the forms -----------------------------------------------------

function popup(): HTMLElement {
  const pop = document.querySelector<HTMLElement>(".vpop");
  if (!pop) {
    throw new Error("no popup is open");
  }
  return pop;
}

function press(text: string): void {
  const btn = Array.from(popup().querySelectorAll<HTMLElement>("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!btn) {
    throw new Error(`no “${text}” button in the popup`);
  }
  btn.click();
}

function submit(): void {
  popup()
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
}

function fields(): HTMLInputElement[] {
  return Array.from(popup().querySelectorAll("input"));
}

/** A component of the palette, driven the way the user drives it. */
interface Component {
  name: string;
  /** What its markdown renders as, so the block can be found afterwards. */
  selector: string;
  run(ed: Editor): void | Promise<void>;
}

const COMPONENTS: Component[] = [
  {
    name: "admonition",
    selector: "div.admonition",
    run: (ed) => {
      ed.inserts.openAdmonitionInsert();
      press("Insert");
    },
  },
  {
    name: "collapsible admonition",
    selector: "details.admonition",
    run: (ed) => {
      ed.inserts.openAdmonitionInsert();
      press("Collapsed ▸");
      press("Insert");
    },
  },
  {
    name: "content tabs",
    selector: ".tabbed-set",
    run: (ed) => {
      ed.inserts.openTabsInsert();
      submit();
    },
  },
  {
    name: "card grid",
    selector: ".grid.cards",
    run: (ed) => {
      ed.inserts.openGridInsert();
      submit();
    },
  },
  {
    name: "code block",
    selector: "div.highlight",
    run: (ed) => {
      ed.inserts.openCodeInsert();
      const [lang, linenums, title] = fields();
      lang.value = "python";
      linenums.checked = true;
      title.value = "app.py";
      submit();
    },
  },
  {
    name: "table",
    selector: "table",
    run: (ed) => {
      ed.inserts.openTableGrid(document.getElementById("tbComponent") as HTMLElement);
      popup().querySelector<HTMLElement>('.vgrid span[data-r="2"][data-c="3"]')!.click();
    },
  },
  {
    name: "button",
    selector: "a.md-button",
    run: (ed) => {
      ed.inserts.openButtonInsert();
      const [url, text] = fields();
      url.value = "downloads.md";
      text.value = "Download";
      submit();
    },
  },
  {
    name: "snippet",
    selector: ".snippet-include",
    run: async (ed) => {
      ed.inserts.openSnippetInsert();
      press("Choose file…");
      await Promise.resolve();
      submit();
    },
  },
  {
    name: "divider",
    selector: "hr",
    run: (ed) => ed.ops.insertHr(),
  },
  {
    name: "diagram",
    selector: "pre.mermaid",
    run: (ed) => {
      ed.mermaid.openMermaidInsert();
      const foot = document.querySelector<HTMLElement>(".vmodal-foot")!;
      Array.from(foot.querySelectorAll("button")).at(-1)!.click();
    },
  },
  {
    name: "formula",
    selector: ".arithmatex",
    run: (ed) => {
      ed.media.openMathPopup();
      const pop = popup();
      pop.querySelector("textarea")!.value = "E = mc^2";
      const block = pop.querySelector<HTMLInputElement>('.vcheck input[type="checkbox"]')!;
      block.checked = true;
      block.dispatchEvent(new Event("change"));
      submit();
    },
  },
];

// --- the checks ------------------------------------------------------------

/** What holds a block: the innermost container it is nested in, or null. */
const CONTAINER_SEL = ".admonition, .tabbed-block, li, blockquote, .grid, .snippet-include";

function containerOf(el: Element, root: Element): Element | null {
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
    if (p.matches(CONTAINER_SEL)) {
      return p;
    }
  }
  return null;
}

/**
 * Where a block belongs. A tight list item holds its text directly, so the
 * caret's own element can be the container the new block has to join.
 */
function homeOf(el: Element, root: Element): Element | null {
  return el.matches(CONTAINER_SEL) ? el : containerOf(el, root);
}

/**
 * Every line the file had is still there, in the same order — the edit only
 * added lines. A block that lands with the wrong indent usually rewrites its
 * neighbour instead, and that shows up here rather than in the render.
 */
function onlyAdded(before: string, after: string): string | null {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a.at(-1 - tail) === b.at(-1 - tail)) {
    tail++;
  }
  if (head + tail < a.length) {
    const lost = a.slice(head, a.length - tail);
    const got = b.slice(head, b.length - tail);
    return `existing lines changed: ${JSON.stringify(lost)} → ${JSON.stringify(got)}`;
  }
  return null;
}

/** Inserts the component with the caret in the marker paragraph of this source. */
async function insertFail(ed: Editor, src: string, comp: Component): Promise<string | null> {
  ed.load(src);
  if (!ed.caretAtMark()) {
    return `the marker paragraph is not in the render of\n${src}`;
  }
  try {
    await comp.run(ed);
  } catch (e) {
    return `the form threw: ${String(e)}`;
  }
  const edits = ed.lastEdits();
  if (!edits || edits.length === 0) {
    return "nothing was sent to the file";
  }
  const out = applyBatch(src, edits);

  const moved = onlyAdded(src, out);
  if (moved) {
    return `${moved}\n--- became ---\n${out}`;
  }

  const root = document.createElement("div");
  root.innerHTML = md.render(out);
  const marker = markerIn(root);
  if (!marker) {
    return `the caret paragraph is gone from the render\n--- became ---\n${out}`;
  }
  // The one that is not an ancestor of the caret is the block just inserted.
  const fresh = Array.from(root.querySelectorAll(comp.selector)).filter(
    (el) => !el.contains(marker),
  );
  if (fresh.length !== 1) {
    return `expected one new “${comp.selector}”, found ${fresh.length}\n--- became ---\n${out}`;
  }
  const home = homeOf(marker, root);
  if (containerOf(fresh[0], root) !== home) {
    return (
      `landed in ${describeEl(containerOf(fresh[0], root))}, not in ${describeEl(home)}` +
      `\n--- became ---\n${out}`
    );
  }

  const broken = roundTripFail(out);
  if (broken) {
    return `the file no longer writes back:\n${broken}\n--- became ---\n${out}`;
  }
  return null;
}

function describeEl(el: Element | null): string {
  if (!el) {
    return "the page itself";
  }
  const cls = el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` : "";
  return `<${el.tagName.toLowerCase()}${cls}>`;
}

/** Every component into every one of these places. */
async function runCases(
  ed: Editor,
  places: Array<{ name: string; src: string }>,
): Promise<{ fails: string[]; count: number }> {
  const fails: string[] = [];
  let count = 0;
  for (const place of places) {
    for (const comp of COMPONENTS) {
      count++;
      const f = await insertFail(ed, place.src, comp);
      if (f) {
        fails.push(`❌ ${comp.name} into ${place.name}\n${f}`);
      }
    }
  }
  return { fails, count };
}

/** The places built by nesting containers, the caret in a paragraph of the innermost. */
function nested(paths: string[][]): Array<{ name: string; src: string }> {
  return paths.map((path) => ({ name: path.join(" ⊃ "), src: build(path, `${MARK}\n`) }));
}

function cross(names: string[], depth: number): string[][] {
  let paths: string[][] = names.map((n) => [n]);
  for (let d = 1; d < depth; d++) {
    paths = paths.flatMap((p) => names.map((n) => [...p, n]));
  }
  return paths;
}

// ---------------------------------------------------------------------------

const CN = Object.keys(CONTAINERS);
// Three deep takes a subset, otherwise the matrix explodes.
const C3 = ["adm", "tabs2", "ul", "quote"];

describe("inserting a component with the caret inside another one", () => {
  let ed: Editor;
  beforeEach(async () => {
    ed = await makeEditor();
  });

  it("into every container", async () => {
    const { fails, count } = await runCases(ed, nested(cross(CN, 1)));
    expect(fails.join("\n\n"), `failures of ${count}`).toBe("");
  });

  it("into a container inside a container", async () => {
    const { fails, count } = await runCases(ed, nested(cross(CN, 2)));
    expect(fails.join("\n\n"), `failures of ${count}`).toBe("");
  });

  it("three deep", async () => {
    const { fails, count } = await runCases(ed, nested(cross(C3, 3)));
    expect(fails.join("\n\n"), `failures of ${count}`).toBe("");
  });

  // The line under the caret is the item's marker (`- …`), so the level to nest
  // into is not the one the line starts at — it is one tab further in. Getting
  // this wrong puts the block at the marker's own level and ends the list.
  it("with the caret on the line of a list marker", async () => {
    const { fails, count } = await runCases(ed, [
      { name: "a bullet", src: `- ${MARK}\n` },
      { name: "a numbered item", src: `1. ${MARK}\n` },
      { name: "a task", src: `- [ ] ${MARK}\n` },
      { name: "a bullet in a quote", src: `> - ${MARK}\n` },
      { name: "a bullet in an admonition", src: `!!! note "Head"\n    - ${MARK}\n` },
      { name: "a bullet under a bullet", src: `- Item\n\n    - ${MARK}\n` },
      { name: "a bullet in a tab", src: `=== "First"\n\n    - ${MARK}\n` },
      {
        name: "a card of a grid",
        src: `<div class="grid cards" markdown>\n\n- ${MARK}\n\n</div>\n`,
      },
      { name: "the second item", src: `- One\n- ${MARK}\n` },
    ]);
    expect(fails.join("\n\n"), `failures of ${count}`).toBe("");
  });

  // Places with no paragraph of their own to read an indent from, or where the
  // caret's block cannot hold the new one.
  describe("places the indent alone does not answer for", () => {
    /** Inserts a plain admonition and gives back the file it produced. */
    function insertAdmonitionAt(src: string, caret: string): string {
      ed.load(src);
      caretIn(ed.docEl.querySelector(caret)!);
      ed.inserts.openAdmonitionInsert();
      press("Insert");
      return applyBatch(src, ed.lastEdits() ?? []);
    }

    it("into a tab with nothing in it yet", () => {
      // The tab has no content line, so the caret's block is the set itself —
      // the level has to come from the tab's own `===` marker instead.
      const src = '=== "First"\n\n=== "Second"\n\n    Tail.\n';
      expect(insertAdmonitionAt(src, ".tabbed-block")).toBe(
        '=== "First"\n\n    !!! note\n        Text.\n\n=== "Second"\n\n    Tail.\n',
      );
    });

    it("into the last tab, empty, of a set inside an admonition", () => {
      const src = '!!! note "Head"\n    === "First"\n\n        Body.\n\n    === "Second"\n';
      expect(insertAdmonitionAt(src, ".tabbed-block:last-child")).toBe(
        '!!! note "Head"\n    === "First"\n\n        Body.\n\n    === "Second"\n\n' +
          "        !!! note\n            Text.\n",
      );
    });

    it("with the caret in a table cell, after the table rather than through it", () => {
      // A table row cannot hold a block; splitting the table at the caret would
      // leave the author with two tables and no way back.
      const src =
        '!!! note "Head"\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |\n    | 3 | 4 |\n';
      expect(insertAdmonitionAt(src, "td")).toBe(src + "\n    !!! note\n        Text.\n");
    });

    it("with the caret in a header cell of a table of its own", () => {
      const src = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
      expect(insertAdmonitionAt(src, "th")).toBe(src + "\n!!! note\n    Text.\n");
    });

    it("twice in a row puts in two, not three", () => {
      // Reported from use: a grid inserted into a tab turned up in the file
      // twice. Each insert has to see the file the previous one left.
      const src = '=== "First"\n\n    Caret paragraph.\n\n=== "Second"\n\n    Tail.\n';
      let text = src;
      for (let i = 0; i < 2; i++) {
        ed.load(text);
        expect(ed.caretAtMark()).toBe(true);
        ed.inserts.openGridInsert();
        submit();
        text = applyBatch(text, ed.lastEdits() ?? []);
      }
      expect(text.split("grid cards")).toHaveLength(3); // two grids
      expect(text.split(MARK)).toHaveLength(2); // and one caret paragraph
      expect(roundTripFail(text)).toBeNull();
    });

    it("with the caret in a code block", () => {
      // The fence has no ranged parts inside it, so the block after it is right.
      const src = '!!! note "Head"\n    ```python\n    x = 1\n    ```\n';
      expect(insertAdmonitionAt(src, "code")).toBe(src + "\n    !!! note\n        Text.\n");
    });

    it("with the caret in a heading inside a container", () => {
      const src = '!!! note "Head"\n    ## A section\n\n    Body.\n';
      expect(insertAdmonitionAt(src, "h2")).toBe(
        '!!! note "Head"\n    ## A section\n\n    !!! note\n        Text.\n\n    Body.\n',
      );
    });

    // A container's chrome — the row of tab labels, an admonition's title — is
    // where the caret lands from an ordinary click: a label IS the tab switch, a
    // title is renamed in place. The block the caret is in is then the container
    // itself, whose source line is its OPENING marker. Read literally that line
    // says the container's own level, and a block written there closes the
    // container: reported from use as a tab set torn into two after inserting a
    // grid “into the second tab”.
    describe("with the caret on a container's own chrome", () => {
      it("in a tab's label, the block goes into that tab", () => {
        const src = '=== "First"\n\n    One.\n\n=== "Second"\n\n    Two.\n';
        expect(insertAdmonitionAt(src, ".tabbed-labels label")).toBe(
          '=== "First"\n\n    One.\n\n    !!! note\n        Text.\n\n=== "Second"\n\n    Two.\n',
        );
      });

      it("in the label of the last tab, and the set stays one set", () => {
        const src = '=== "First"\n\n    One.\n\n=== "Second"\n\n    Two.\n';
        const out = insertAdmonitionAt(src, ".tabbed-labels label:last-of-type");
        expect(out).toBe(
          '=== "First"\n\n    One.\n\n=== "Second"\n\n    Two.\n\n    !!! note\n        Text.\n',
        );
        expect(tabSetsIn(out)).toEqual([2]);
      });

      it("in a tab's label two levels down", () => {
        const src = '!!! note "Head"\n    === "First"\n\n        One.\n\n    === "Second"\n';
        expect(insertAdmonitionAt(src, ".tabbed-labels label")).toBe(
          '!!! note "Head"\n    === "First"\n\n        One.\n\n' +
            "        !!! note\n            Text.\n\n" +
            '    === "Second"\n',
        );
      });

      it("in an admonition's title, the block opens its body", () => {
        const src = '!!! note "Head"\n    Body.\n';
        const out = insertAdmonitionAt(src, ".admonition-title");
        expect(out).toBe('!!! note "Head"\n    !!! note\n        Text.\n\n    Body.\n');
        expect(roundTripFail(out)).toBeNull();
      });

      it("in the title of an admonition inside an admonition", () => {
        const src = '!!! note "Outer"\n    ??? tip "Inner"\n        Body.\n';
        const out = insertAdmonitionAt(src, ".admonition .admonition .admonition-title");
        expect(out).toBe(
          '!!! note "Outer"\n    ??? tip "Inner"\n        !!! note\n            Text.\n\n' +
            "        Body.\n",
        );
        expect(roundTripFail(out)).toBeNull();
      });
    });
  });
});

/** How many labels each tab set of a rendered file has — two sets mean one was torn apart. */
function tabSetsIn(src: string): number[] {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return Array.from(host.querySelectorAll(".tabbed-set")).map(
    (set) => set.querySelectorAll(".tabbed-labels > label").length,
  );
}

// ---------------------------------------------------------------------------
// The other half of the palette goes INSIDE a paragraph. Nothing about the file
// is computed from the caret there: the element is dropped into the DOM and the
// whole top-level block is written back from it. So the question is a different
// one — after an emoji is added to a paragraph four levels down, does the
// admonition around it come back out of the serializer exactly as it went in?
// ---------------------------------------------------------------------------

/** A component that goes into the paragraph rather than after it. */
interface InlineComponent {
  name: string;
  /** Drives the form, and answers with the markdown the line should have gained. */
  run(ed: Editor): string | Promise<string>;
}

const INLINE_COMPONENTS: InlineComponent[] = [
  {
    name: "emoji",
    run: (ed) => {
      ed.icons.openIconPicker();
      const cell = popup().querySelector<HTMLElement>(".ip-cell.ip-emoji")!;
      const code = cell.title;
      cell.click();
      return code;
    },
  },
  {
    name: "keyboard keys",
    run: (ed) => {
      ed.inline.openKeysPopup();
      popup().querySelector("input")!.value = "++ctrl+alt+del++";
      submit();
      return "++ctrl+alt+del++";
    },
  },
  {
    name: "footnote",
    run: (ed) => {
      ed.inline.openFootnotePopup();
      popup().querySelector("textarea")!.value = "An explanation.";
      submit();
      return "[^1]";
    },
  },
  {
    name: "tooltip",
    run: (ed) => {
      ed.inline.openTooltipPopup();
      const [text, tip] = fields();
      text.value = "HTML";
      tip.value = "Hyper Text Markup Language";
      submit();
      return "HTML";
    },
  },
  {
    name: "inline formula",
    run: (ed) => {
      ed.media.openMathPopup();
      popup().querySelector("textarea")!.value = "E = mc^2";
      submit();
      return "$E = mc^2$";
    },
  },
  {
    name: "image",
    run: (ed) => {
      ed.media.openImagePopup();
      const [src, alt] = fields();
      src.value = "images/shot.png";
      alt.value = "A screenshot";
      submit();
      return "![A screenshot](images/shot.png)";
    },
  },
];

/**
 * Adds the inline element with the caret at the end of the marker paragraph.
 * Only that line may change; anything the component writes of its own (a
 * footnote definition, an abbreviation) goes after the file, never into it.
 */
async function inlineFail(ed: Editor, src: string, comp: InlineComponent): Promise<string | null> {
  ed.load(src);
  if (!ed.caretAtMark()) {
    return `the marker paragraph is not in the render of\n${src}`;
  }
  let added: string;
  try {
    added = await comp.run(ed);
  } catch (e) {
    return `the form threw: ${String(e)}`;
  }
  // The editor batches an edit a moment after the change, so the user's typing
  // and what a form adds travel together.
  await vi.advanceTimersByTimeAsync(500);
  const edits = ed.lastEdits();
  if (!edits || edits.length === 0) {
    return "nothing was sent to the file";
  }
  const out = applyBatch(src, edits);

  const want = src
    .split("\n")
    .map((l) => (l.trimEnd().endsWith(MARK) ? l + added : l))
    .join("\n");
  if (!out.startsWith(want)) {
    return `expected the file to start with\n${want}\n--- became ---\n${out}`;
  }

  const broken = roundTripFail(out);
  if (broken) {
    return `the file no longer writes back:\n${broken}\n--- became ---\n${out}`;
  }
  return null;
}

// The editor batches what is typed a third of a second after the last
// keystroke. A component asked for inside that window used to go straight to
// the file with line numbers of its own, and the render that answered it
// replaced the paragraph the character was still sitting in — one letter, gone
// without a trace.
describe("a component asked for right after typing", () => {
  let ed: Editor;
  beforeEach(async () => {
    vi.useFakeTimers();
    ed = await makeEditor();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the typing to reach the file, then inserts", async () => {
    const src = '!!! note "Head"\n    Caret paragraph.\n';
    ed.load(src);
    expect(ed.caretAtMark()).toBe(true);

    // The user types a character…
    const para = markerIn(ed.docEl)!;
    para.append(document.createTextNode("!"));
    ed.core.markDirty(para);

    // …and reaches for a component before the batch is due.
    const item = ed.menu.componentInsertItems().find((i) => i.id === "admonition")!;
    ed.menu.runComponent(item);
    expect(document.querySelector(".vpop")).toBeNull(); // the form is held back

    // The typing goes first, on its own.
    await vi.advanceTimersByTimeAsync(500);
    const typed = applyBatch(src, ed.lastEdits() ?? []);
    expect(typed).toBe('!!! note "Head"\n    Caret paragraph.!\n');

    // The extension answers, and only then does the form appear.
    ed.core.adoptText(typed, 2);
    ed.core.finishRemote();
    press("Insert");
    expect(applyBatch(typed, ed.lastEdits() ?? [])).toBe(
      '!!! note "Head"\n    Caret paragraph.!\n\n    !!! note\n        Text.\n',
    );
  });
});

describe("adding an inline element to a paragraph inside a container", () => {
  let ed: Editor;
  beforeEach(async () => {
    vi.useFakeTimers();
    ed = await makeEditor();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The sequence a user reported as producing the block twice: an emoji dropped
  // into a paragraph of a tab, then a grid after it.
  it("an emoji and then a grid land once each", async () => {
    const src = '=== "First"\n\n    Caret paragraph.\n\n=== "Second"\n\n    Tail.\n';
    ed.load(src);
    expect(ed.caretAtMark()).toBe(true);

    ed.icons.openIconPicker();
    const cell = popup().querySelector<HTMLElement>(".ip-cell.ip-emoji")!;
    const emoji = cell.title;
    cell.click();
    await vi.advanceTimersByTimeAsync(500);
    const withEmoji = applyBatch(src, ed.lastEdits() ?? []);
    expect(withEmoji.split(emoji)).toHaveLength(2);

    // The extension has answered; the editor carries on from that text.
    ed.load(withEmoji);
    const para = Array.from(ed.docEl.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").includes(MARK),
    )!;
    caretIn(para);
    const grid = ed.menu.componentInsertItems().find((i) => i.id === "grid")!;
    ed.menu.runComponent(grid);
    submit();
    const withGrid = applyBatch(withEmoji, ed.lastEdits() ?? []);

    expect(withGrid.split("grid cards")).toHaveLength(2);
    expect(withGrid.split(emoji)).toHaveLength(2);
    expect(withGrid.split(MARK)).toHaveLength(2);
    expect(roundTripFail(withGrid)).toBeNull();
  });

  it("at every depth", async () => {
    const places = [
      ...nested(cross(CN, 1)),
      ...nested(cross(["adm", "tabs2", "ul", "quote", "grid"], 2)),
      ...nested(cross(["adm", "tabs", "ul"], 3)),
    ];
    const fails: string[] = [];
    let count = 0;
    for (const place of places) {
      for (const comp of INLINE_COMPONENTS) {
        count++;
        const f = await inlineFail(ed, place.src, comp);
        if (f) {
          fails.push(`❌ ${comp.name} into ${place.name}\n${f}`);
        }
      }
    }
    expect(fails.join("\n\n"), `failures of ${count}`).toBe("");
  });
});
