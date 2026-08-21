// @vitest-environment happy-dom
//
// The core of the visual editor: the document as lines, the batch that goes to
// the file, and the history that takes it back. Everything the editor does ends
// up here, so a mistake in this module is a mistake in somebody's document.
//
// The module keeps its state in module-level variables — one editor per webview
// — so every test starts from a fresh import rather than trying to reset it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncEdit } from "../../webviews/visual/syncModel";

type Core = typeof import("../../webviews/visual/editorCore");

interface Harness {
  core: Core;
  /** What was sent to the extension. */
  posts: { type: string; baseVersion?: number; edits?: SyncEdit[] }[];
  docEl: HTMLElement;
  statusEl: HTMLElement;
  /** The annotation sub-editor: its document is a copy, not the file. */
  sub: { on: boolean; renders: number };
  caret: { inBlock: boolean };
  /**
   * Puts a rendered document in place, the way the editor does — through
   * `mutedRemote`. Rendering is not an edit, and the core is entitled to be
   * told so.
   */
  render(html: string): Promise<void>;
}

async function freshCore(): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  docEl.setAttribute("contenteditable", "true");
  const statusEl = document.createElement("span");
  document.body.append(docEl, statusEl);

  const state = {
    posts: [] as Harness["posts"],
    sub: { on: false, renders: 0 },
    caret: { inBlock: false },
  };
  const core: Core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl,
    post: (msg) => state.posts.push(msg as Harness["posts"][number]),
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    caretInBlock: () => state.caret.inBlock,
    inSub: () => state.sub.on,
    renderSub: () => {
      state.sub.renders++;
    },
  });
  return {
    core,
    docEl,
    statusEl,
    ...state,
    async render(html) {
      core.mutedRemote(() => {
        docEl.innerHTML = html;
      });
      await settle();
      statusEl.textContent = "";
    },
  };
}

/** Lets the MutationObserver deliver its records — it does so in a microtask. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** Applies a batch to plain lines, the way the provider applies it to the file. */
function applyToLines(text: string, edits: SyncEdit[]): string {
  const endsNL = text === "" || text.endsWith("\n");
  const lines = text.split("\n");
  if (endsNL && lines.length > 0) {
    lines.pop();
  }
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    const insert = e.text === "" ? [] : e.text.replace(/\n$/, "").split("\n");
    lines.splice(e.start, e.end - e.start, ...insert);
  }
  return lines.length === 0 ? "" : lines.join("\n") + (endsNL ? "\n" : "");
}

describe("the document as the core holds it", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshCore();
  });

  it("keeps the text it was given, byte for byte", () => {
    h.core.adoptText("one\ntwo\n", 7);
    expect(h.core.fullText()).toBe("one\ntwo\n");
    expect(h.core.docLines()).toEqual(["one", "two"]);
    expect(h.core.docEndsNL()).toBe(true);
    expect(h.core.docVersion()).toBe(7);
  });

  it("remembers a file that ends without a newline", () => {
    h.core.adoptText("one\ntwo", 1);
    expect(h.core.docEndsNL()).toBe(false);
    expect(h.core.docLines()).toEqual(["one", "two"]);
    // The missing newline must survive the round trip: adding one would be an
    // edit nobody asked for, in a file somebody else wrote.
    expect(h.core.fullText()).toBe("one\ntwo");
  });

  it("an empty document is empty, not a blank line", () => {
    h.core.adoptText("", 1);
    expect(h.core.docLines()).toEqual([]);
    expect(h.core.fullText()).toBe("");
  });

  it("reads a block's range from its attributes, and assumes one line without an end", () => {
    const el = document.createElement("p");
    el.setAttribute("data-src-line", "4");
    expect(h.core.rangeOf(el)).toEqual({ start: 4, end: 5 });
    el.setAttribute("data-src-end", "9");
    expect(h.core.rangeOf(el)).toEqual({ start: 4, end: 9 });
  });

  it("knows the footnote tail the engine generates and the file does not have", () => {
    const tail = document.createElement("section");
    tail.className = "footnotes";
    const sep = document.createElement("hr");
    sep.className = "footnotes-sep";
    const para = document.createElement("p");
    expect(h.core.isFootnoteService(tail)).toBe(true);
    expect(h.core.isFootnoteService(sep)).toBe(true);
    expect(h.core.isFootnoteService(para)).toBe(false);
  });
});

describe("undo and redo of what was written to the file", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshCore();
    h.core.adoptText("one\ntwo\n", 1);
  });

  /** The extension's answer: the file now reads `text`. */
  function answer(text: string, version: number): void {
    h.core.adoptText(text, version);
    h.core.finishRemote();
  }

  it("undo sends the inverse of the batch, and it restores the text", () => {
    const edit: SyncEdit = { start: 0, end: 1, text: "ONE\n" };
    h.core.sendSync([edit]);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({ type: "sync", baseVersion: 1 });
    answer(applyToLines("one\ntwo\n", [edit]), 2);
    expect(h.core.fullText()).toBe("ONE\ntwo\n");

    h.core.undoOnce();
    expect(h.posts).toHaveLength(2);
    const inverse = h.posts[1].edits!;
    expect(applyToLines("ONE\ntwo\n", inverse)).toBe("one\ntwo\n");
  });

  it("redo puts back what undo took away", () => {
    const edit: SyncEdit = { start: 1, end: 2, text: "TWO\n" };
    h.core.sendSync([edit]);
    answer(applyToLines("one\ntwo\n", [edit]), 2);

    h.core.undoOnce();
    answer(applyToLines("one\nTWO\n", h.posts[1].edits!), 3);
    expect(h.core.fullText()).toBe("one\ntwo\n");

    h.core.redoOnce();
    expect(applyToLines("one\ntwo\n", h.posts[2].edits!)).toBe("one\nTWO\n");
  });

  it("a new edit drops the redo branch — there is nothing to return to any more", () => {
    h.core.sendSync([{ start: 0, end: 1, text: "ONE\n" }]);
    answer("ONE\ntwo\n", 2);
    h.core.undoOnce();
    answer("one\ntwo\n", 3);

    h.core.sendSync([{ start: 1, end: 2, text: "TWO\n" }]);
    answer("one\nTWO\n", 4);
    const before = h.posts.length;
    h.core.redoOnce();
    expect(h.posts).toHaveLength(before);
  });

  it("an empty batch is not history: nothing is sent and nothing is stacked", () => {
    h.core.sendSync([]);
    expect(h.posts).toHaveLength(0);
    h.core.undoOnce();
    expect(h.posts).toHaveLength(0);
  });

  it("the history has a bottom — an old edit falls out instead of growing forever", () => {
    for (let i = 0; i < 205; i++) {
      h.core.sendSync([{ start: 0, end: 1, text: `line ${i}\n` }]);
      answer(`line ${i}\ntwo\n`, i + 2);
    }
    let undone = 0;
    for (let i = 0; i < 300; i++) {
      const before = h.posts.length;
      h.core.undoOnce();
      if (h.posts.length === before) {
        break;
      }
      undone++;
      answer(applyToLines(h.core.fullText(), h.posts.at(-1)!.edits!), 1000 + i);
    }
    expect(undone).toBe(200);
  });
});

describe("the annotation sub-editor writes to a copy, not to the file", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshCore();
  });

  it("a batch is applied locally and re-rendered, and the extension hears nothing", () => {
    h.core.adoptText("file line\n", 3);
    const snap = h.core.takeCoreSnapshot();
    h.core.openLocalDoc("note body\n");
    h.sub.on = true;

    h.core.sendSync([{ start: 0, end: 1, text: "edited note\n" }]);
    expect(h.core.fullText()).toBe("edited note\n");
    expect(h.sub.renders).toBe(1);
    expect(h.posts).toHaveLength(0);

    h.sub.on = false;
    h.core.restoreCore(snap);
    expect(h.core.fullText()).toBe("file line\n");
    expect(h.core.docVersion()).toBe(3);
  });

  it("the snapshot carries the history away and brings it back", () => {
    h.core.adoptText("one\n", 1);
    h.core.sendSync([{ start: 0, end: 1, text: "ONE\n" }]);
    h.core.adoptText("ONE\n", 2);
    h.core.finishRemote();

    const snap = h.core.takeCoreSnapshot();
    expect(snap.undo).toHaveLength(1);
    h.core.openLocalDoc("note\n");
    h.sub.on = true;
    // Inside the note, undo must not reach the file's history.
    const before = h.posts.length;
    h.core.undoOnce();
    expect(h.posts).toHaveLength(before);

    h.sub.on = false;
    h.core.restoreCore(snap);
    h.core.undoOnce();
    expect(applyToLines("ONE\n", h.posts.at(-1)!.edits!)).toBe("one\n");
  });
});

describe("telling a user edit from a programmatic one", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshCore();
    h.core.adoptText("hello\n", 1);
    await h.render('<p data-src-line="0" data-src-end="1">hello</p>');
  });

  it("typing marks the block changed", async () => {
    const p = h.docEl.firstElementChild!;
    p.textContent = "hello there";
    await settle();
    expect(h.core.dirty.has(p)).toBe(true);
    // The status line says nothing about it: whether the page is in the file is
    // shown on the save button, and a line that renamed the same state three
    // times flickered on every keystroke.
    expect(h.statusEl.textContent).toBe("");
  });

  it("a mutation inside mutedRemote is not an edit", async () => {
    h.core.mutedRemote(() => {
      h.docEl.innerHTML = '<p data-src-line="0" data-src-end="1">rendered anew</p>';
    });
    await settle();
    expect(h.core.dirty.size).toBe(0);
    expect(h.statusEl.textContent).toBe("");
  });

  it("an island redrawing itself is not an edit either", async () => {
    // Mermaid and code highlighting rebuild their own subtree outside the muting.
    // Counting that as typing would loop: render → mutation → sync → render.
    await h.render(
      '<div data-src-line="0" data-src-end="3" class="mermaid"><div contenteditable="false"><svg></svg></div></div>',
    );

    const island = h.docEl.querySelector('[contenteditable="false"]')!;
    island.innerHTML = "<svg><g>redrawn</g></svg>";
    await settle();
    expect(h.core.dirty.size).toBe(0);
    expect(h.statusEl.textContent).toBe("");
  });

  it("a checkbox is a change even though it mutates no attribute", async () => {
    await h.render(
      '<ul data-src-line="0" data-src-end="1"><li><input type="checkbox" class="task-list-item-checkbox"></li></ul>',
    );
    const box = h.docEl.querySelector("input")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(h.core.dirty.has(h.docEl.firstElementChild!)).toBe(true);
  });
});

describe("collecting the batch", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshCore();
  });

  it("a changed paragraph is sent as its own range and nothing else", async () => {
    h.core.adoptText("one\n\ntwo\n", 1);
    await h.render(
      '<p data-src-line="0" data-src-end="1">one</p><p data-src-line="2" data-src-end="3">two</p>',
    );
    const first = h.docEl.firstElementChild!;
    first.textContent = "one edited";
    await settle();

    h.core.runSync();
    expect(h.posts).toHaveLength(1);
    const edits = h.posts[0].edits!;
    expect(applyToLines("one\n\ntwo\n", edits)).toBe("one edited\n\ntwo\n");
  });

  it("a block removed from the document leaves the file", async () => {
    h.core.adoptText("one\n\ntwo\n", 1);
    await h.render(
      '<p data-src-line="0" data-src-end="1">one</p><p data-src-line="2" data-src-end="3">two</p>',
    );

    h.docEl.firstElementChild!.remove();
    await settle();
    h.core.runSync();
    expect(applyToLines("one\n\ntwo\n", h.posts[0].edits!)).toBe("two\n");
  });

  it("a source-only edit rides in the same batch as the block edits", async () => {
    // A footnote definition has no block of its own: removing the marker and the
    // definition must be one WorkspaceEdit, or an undo would split them.
    h.core.adoptText("text[^1]\n\n[^1]: note\n", 1);
    await h.render('<p data-src-line="0" data-src-end="1">text</p>');
    const p = h.docEl.firstElementChild!;
    p.textContent = "text";
    h.core.markDirty(p);
    h.core.queueSourceEdit({ start: 2, end: 3, text: "" });

    h.core.runSync();
    expect(h.posts).toHaveLength(1);
    const edits = h.posts[0].edits!;
    expect(edits.some((e) => e.start === 2 && e.end === 3 && e.text === "")).toBe(true);
  });

  it("nothing to send means nothing is sent", async () => {
    h.core.adoptText("one\n", 1);
    await h.render('<p data-src-line="0" data-src-end="1">one</p>');
    h.core.runSync();
    expect(h.posts).toHaveLength(0);
  });

  it("a document being replaced drops the queue that spoke in its coordinates", async () => {
    h.core.adoptText("one\n\ntwo\n", 1);
    await h.render(
      '<p data-src-line="0" data-src-end="1">one</p><p data-src-line="2" data-src-end="3">two</p>',
    );
    h.docEl.firstElementChild!.remove();
    h.core.queueSourceEdit({ start: 2, end: 3, text: "" });
    await settle();

    // A render arrives: line 2 of the old text is some other block in the new one.
    h.core.clearForRender();
    h.core.adoptText("brand new\n", 2);
    await h.render('<p data-src-line="0" data-src-end="1">brand new</p>');
    h.core.runSync();
    expect(h.posts).toHaveLength(0);
  });
});

describe("the state around a batch in flight", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshCore();
    h.core.adoptText("one\n", 1);
  });

  it("a sent batch is busy until the answer is applied", () => {
    expect(h.core.syncBusy()).toBe(false);
    h.core.noteSyncSent();
    expect(h.core.syncBusy()).toBe(true);
    h.core.finishRemote();
    expect(h.core.syncBusy()).toBe(false);
  });

  it("a refused batch releases the editor as well", () => {
    h.core.noteSyncSent();
    h.core.cancelSync();
    expect(h.core.syncBusy()).toBe(false);
  });

  it("what waited for the answer runs once it arrives", () => {
    const ran: string[] = [];
    h.core.noteSyncSent();
    h.core.setAfterSync(() => ran.push("after"));
    expect(ran).toEqual([]);
    h.core.finishRemote();
    expect(ran).toEqual(["after"]);
  });

  it("a refusal cancels what was waiting instead of running it on stale text", () => {
    const ran: string[] = [];
    h.core.noteSyncSent();
    h.core.setAfterSync(() => ran.push("after"));
    h.core.cancelSync();
    h.core.finishRemote();
    expect(ran).toEqual([]);
  });

  // A second click on an interface control — another call-out type, another
  // language on a code block — used to send a batch built against the version
  // the editor last heard about. The extension had already moved past it, the
  // whole batch was refused, and the click did nothing at all.
  it("an interface edit waits for the batch in flight instead of racing it", () => {
    const built: string[] = [];
    h.core.noteSyncSent();
    h.core.sendBuiltSync(() => {
      built.push("second");
      return [{ start: 0, end: 1, text: "two\n" }];
    });
    expect(built).toEqual([]);
    expect(h.posts).toHaveLength(0);

    h.core.finishRemote();
    expect(built).toEqual(["second"]);
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({ type: "sync", edits: [{ text: "two\n" }] });
  });

  it("builds the waiting edit only after the answer, from the text that came back", () => {
    h.core.noteSyncSent();
    h.core.sendBuiltSync(() => [{ start: 0, end: 1, text: h.core.docLines()[0] + "!\n" }]);
    // The answer brings a text the click never saw; the edit is built on THAT.
    h.core.adoptText("changed\n", 2);
    h.core.finishRemote();
    expect(h.posts[0]).toMatchObject({ baseVersion: 2, edits: [{ text: "changed!\n" }] });
  });

  it("lets waiting edits through one at a time, each after its own answer", () => {
    const built: string[] = [];
    h.core.noteSyncSent();
    h.core.sendBuiltSync(() => {
      built.push("a");
      return [{ start: 0, end: 1, text: "a\n" }];
    });
    h.core.sendBuiltSync(() => {
      built.push("b");
      return [{ start: 0, end: 1, text: "b\n" }];
    });

    h.core.finishRemote();
    expect(built).toEqual(["a"]);
    h.core.finishRemote();
    expect(built).toEqual(["a", "b"]);
    expect(h.posts).toHaveLength(2);
  });

  it("sends straight away when nothing is in flight", () => {
    h.core.sendBuiltSync(() => [{ start: 0, end: 1, text: "now\n" }]);
    expect(h.posts).toHaveLength(1);
  });

  it("drops a waiting edit whose block is gone rather than writing at a guess", () => {
    h.core.noteSyncSent();
    h.core.sendBuiltSync(() => undefined); // the block was not found any more
    h.core.finishRemote();
    expect(h.posts).toHaveLength(0);
  });

  it("the full-render request is read once", () => {
    expect(h.core.takeFullRenderRequest()).toBe(false);
    h.core.requestFullRender();
    expect(h.core.takeFullRenderRequest()).toBe(true);
    expect(h.core.takeFullRenderRequest()).toBe(false);
  });

  it("a block left alone by a patch waits for its fresh render", () => {
    expect(h.core.catchUpPending()).toBe(false);
    h.core.noteCatchUp();
    expect(h.core.catchUpPending()).toBe(true);
  });

  it("the catch-up render waits for the caret to leave the block", () => {
    h.core.noteCatchUp();
    h.caret.inBlock = true;
    h.core.runSync();
    expect(h.posts).toHaveLength(0);

    h.caret.inBlock = false;
    h.core.runSync();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]).toMatchObject({ type: "sync", edits: [] });
    expect(h.core.catchUpPending()).toBe(false);
  });
});

// A key combination, a formula, a footnote marker: what the editor drops at the
// caret only stands in for what the engine will draw. A patch leaves the block
// the caret is in alone — that is what keeps the caret — so the stand-in has to
// ask for its block to be replaced anyway, and say where the caret goes back to.
describe("the stand-in an inline component leaves behind", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await freshCore();
    h.core.adoptText("one\n", 1);
  });

  /** A paragraph with n engine-drawn pieces in it, the last one just inserted. */
  async function paragraphWithIslands(n: number): Promise<HTMLElement[]> {
    const marks = Array.from({ length: n }, (_v, i) => `<span data-keys="++f${i + 1}++"></span>`);
    await h.render(`<p data-src-line="0" data-src-end="1">text ${marks.join(" and ")}</p>`);
    return Array.from(h.docEl.querySelectorAll<HTMLElement>("[data-keys]"));
  }

  it("names the block and where in it the piece sits", async () => {
    const islands = await paragraphWithIslands(3);
    h.core.noteInlineIsland(islands[2]);
    expect(h.core.takeInlineRefresh()).toEqual({ block: h.docEl.firstElementChild, index: 2 });
  });

  it("is read once — the next patch has nothing to bring", async () => {
    const islands = await paragraphWithIslands(1);
    h.core.noteInlineIsland(islands[0]);
    expect(h.core.takeInlineRefresh()).not.toBeNull();
    expect(h.core.takeInlineRefresh()).toBeNull();
  });

  it("is dropped when the whole document is replaced", async () => {
    const islands = await paragraphWithIslands(1);
    h.core.noteInlineIsland(islands[0]);
    h.core.clearForRender();
    expect(h.core.takeInlineRefresh()).toBeNull();
  });

  it("lines the editor's pieces up with the ones in a fresh render", async () => {
    await paragraphWithIslands(2);
    const rendered = document.createElement("p");
    // What the engine sends back for the same paragraph.
    rendered.innerHTML =
      'text <span class="keys" data-keys="++f1++"><kbd>F1</kbd></span> and ' +
      '<span class="keys" data-keys="++f2++"><kbd>F2</kbd></span>';
    expect(h.core.inlineIslands(rendered).map((el) => el.getAttribute("data-keys"))).toEqual([
      "++f1++",
      "++f2++",
    ]);
  });

  it("says nothing about an element outside any block", async () => {
    await paragraphWithIslands(1);
    const loose = document.createElement("span");
    loose.setAttribute("data-keys", "++esc++");
    h.core.noteInlineIsland(loose);
    expect(h.core.takeInlineRefresh()).toBeNull();
  });
});
