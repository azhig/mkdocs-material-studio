// @vitest-environment happy-dom
//
// A code block edited in place, and what reaches the file. Two paths meet here:
// the keyboard, which rewrites the body line by line, and the handle menu,
// which rewrites the info string of the fence. Both send the whole block back,
// so an off-by-one in either loses a line of somebody's program.
//
// The caret arithmetic itself is in codeBlockEdit.test.ts; this file is about
// the edits that leave the editor.

import { beforeEach, describe, expect, it, vi } from "vitest";

type CodeEdit = typeof import("../../webviews/visual/codeBlockEdit");
type Core = typeof import("../../webviews/visual/editorCore");

interface Harness {
  code: CodeEdit;
  core: Core;
  docEl: HTMLElement;
  posts: { edits?: { start: number; end: number; text: string }[] }[];
  /** The document as the file has it, with the batches applied. */
  file(): string;
}

const SOURCE = ['```python title="app.py"', "def greet(name):", "    return name", "```"];

async function fresh(source: string[] = SOURCE): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  const statusEl = document.createElement("span");
  document.body.append(docEl, statusEl);

  const posts: Harness["posts"] = [];
  const core: Core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl,
    post: (msg) => posts.push(msg as Harness["posts"][number]),
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    caretInBlock: () => false,
    inSub: () => false,
    renderSub: () => {},
  });
  core.adoptText(source.join("\n") + "\n", 1);

  const code: CodeEdit = await import("../../webviews/visual/codeBlockEdit");
  code.initCodeBlockEdit({
    findBlockByStart: (start) => docEl.querySelector(`[data-src-line="${start}"]`) ?? undefined,
  });

  return {
    code,
    core,
    docEl,
    posts,
    file() {
      const lines = source.slice();
      for (const post of posts) {
        for (const e of post.edits ?? []) {
          lines.splice(e.start, e.end - e.start, ...e.text.replace(/\n$/, "").split("\n"));
        }
      }
      return lines.join("\n") + "\n";
    },
  };
}

/** The block as the engine renders it: one `.cl` per line, info kept as data. */
function renderBlock(h: Harness, body: string[], info = 'python title="app.py"'): HTMLElement {
  const block = document.createElement("div");
  block.className = "highlight";
  block.setAttribute("data-block-type", "code");
  block.setAttribute("data-src-line", "0");
  block.setAttribute("data-src-end", String(body.length + 2));
  block.setAttribute("data-fence-info", info);
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  for (const line of body) {
    const cl = document.createElement("span");
    cl.className = "cl";
    cl.textContent = line;
    codeEl.appendChild(cl);
  }
  pre.appendChild(codeEl);
  block.appendChild(pre);
  h.docEl.appendChild(block);
  h.code.decorateCodeBlock(block);
  return block;
}

function codeOf(block: HTMLElement): HTMLElement {
  return block.querySelector(":scope > pre > code") as HTMLElement;
}

/** Puts the caret at line/column inside the rendered code. */
function caretAt(block: HTMLElement, line: number, col: number): void {
  const codeEl = codeOf(block);
  h_setCaret(codeEl, line, col);
}
let h_setCaret: (el: HTMLElement, line: number, col: number) => void;

/** Presses a key on the code element, the way the editor listens for it. */
function press(block: HTMLElement, key: string): void {
  codeOf(block).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/** Runs a handle-menu item by the start of its label. */
function runMenuItem(h: Harness, block: HTMLElement, startsWith: string): void {
  const item = h.code.codeMenuItems(block).find((i) => i.label.includes(startsWith));
  if (!item) {
    throw new Error(`no menu item matching “${startsWith}”`);
  }
  item.run?.();
}

describe("the handle menu shows what the fence says", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h_setCaret = h.code.setCodeCaret;
  });

  it("names the language, and says so when there is none", async () => {
    const block = renderBlock(h, ["def greet(name):", "    return name"]);
    expect(h.code.codeMenuItems(block)[0].label).toContain("python");

    const bare = await fresh(["```", "text", "```"]);
    h_setCaret = bare.code.setCodeCaret;
    const b2 = renderBlock(bare, ["text"], "");
    expect(bare.code.codeMenuItems(b2)[0].label).toContain("not set");
  });

  it("ticks the boxes that the fence has set", async () => {
    const withAll = await fresh(['```python title="app.py" linenums="1"', "x = 1", "```"]);
    h_setCaret = withAll.code.setCodeCaret;
    const block = renderBlock(withAll, ["x = 1"], 'python title="app.py" linenums="1"');
    const labels = withAll.code.codeMenuItems(block).map((i) => i.label);
    expect(labels.some((l) => l.startsWith("☑") && l.includes("Line numbers"))).toBe(true);
    expect(labels.some((l) => l.startsWith("☑") && l.includes("Title"))).toBe(true);
  });

  it("counts the highlighted lines", async () => {
    const hl = await fresh(['```python hl_lines="2 3"', "a", "b", "c", "```"]);
    h_setCaret = hl.code.setCodeCaret;
    const block = renderBlock(hl, ["a", "b", "c"], 'python hl_lines="2 3"');
    expect(
      hl.code.codeMenuItems(block).find((i) => i.label.includes("Highlight"))?.label,
    ).toContain("(2)");
  });
});

describe("the menu edits the fence, and nothing else", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h_setCaret = h.code.setCodeCaret;
  });

  it("turns line numbers on and back off", () => {
    const block = renderBlock(h, ["def greet(name):", "    return name"]);
    runMenuItem(h, block, "Line numbers");
    expect(h.file()).toBe(
      '```python title="app.py" linenums="1"\ndef greet(name):\n    return name\n```\n',
    );
  });

  it("adds a title and removes it again, leaving the body untouched", async () => {
    const plain = await fresh(["```python", "x = 1", "```"]);
    h_setCaret = plain.code.setCodeCaret;
    const block = renderBlock(plain, ["x = 1"], "python");
    runMenuItem(plain, block, "Title");
    expect(plain.file()).toBe('```python title="app.py"\nx = 1\n```\n');

    const titled = await fresh(['```python title="app.py"', "x = 1", "```"]);
    h_setCaret = titled.code.setCodeCaret;
    const b2 = renderBlock(titled, ["x = 1"], 'python title="app.py"');
    runMenuItem(titled, b2, "Title");
    expect(titled.file()).toBe("```python\nx = 1\n```\n");
  });

  it("keeps a tilde fence a tilde fence", async () => {
    // A `~~~` fence is how an author writes a block that itself contains
    // backticks. Rewriting it as ``` would break their document.
    const tilde = await fresh(["~~~python", "x = 1", "~~~"]);
    h_setCaret = tilde.code.setCodeCaret;
    const block = renderBlock(tilde, ["x = 1"], "python");
    runMenuItem(tilde, block, "Line numbers");
    expect(tilde.file()).toBe('~~~python linenums="1"\nx = 1\n~~~\n');
  });

  it("the highlight mode writes the lines that were clicked", () => {
    const block = renderBlock(h, ["def greet(name):", "    return name"]);
    runMenuItem(h, block, "Highlight lines");
    const lines = codeOf(block).querySelectorAll(":scope > .cl");
    lines[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const bar = document.querySelector(".vhl-bar")!;
    Array.from(bar.querySelectorAll("button"))
      .find((b) => b.textContent === "Done")!
      .click();
    expect(h.file()).toBe(
      '```python title="app.py" hl_lines="2"\ndef greet(name):\n    return name\n```\n',
    );
  });

  it("cancelling the highlight mode writes nothing", () => {
    const block = renderBlock(h, ["def greet(name):", "    return name"]);
    runMenuItem(h, block, "Highlight lines");
    codeOf(block)
      .querySelectorAll(":scope > .cl")[0]
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const bar = document.querySelector(".vhl-bar")!;
    Array.from(bar.querySelectorAll("button"))
      .find((b) => b.textContent === "Cancel")!
      .click();
    expect(h.posts).toHaveLength(0);
    expect(document.querySelector(".vhl-bar")).toBe(null);
  });
});

describe("the keyboard inside a code block", () => {
  let h: Harness;
  let block: HTMLElement;
  beforeEach(async () => {
    h = await fresh();
    h_setCaret = h.code.setCodeCaret;
    block = renderBlock(h, ["def greet(name):", "    return name"]);
  });

  const body = (): string[] => h.code.codeLinesOf(codeOf(block));

  it("Enter splits the line at the caret", () => {
    caretAt(block, 0, 16);
    press(block, "Enter");
    expect(body()).toEqual(["def greet(name):", "", "    return name"]);
  });

  it("Enter in the middle of a word keeps both halves", () => {
    caretAt(block, 0, 4);
    press(block, "Enter");
    expect(body()).toEqual(["def ", "greet(name):", "    return name"]);
  });

  it("Tab inserts four spaces at the caret, not a tab character", () => {
    caretAt(block, 1, 4);
    press(block, "Tab");
    expect(body()).toEqual(["def greet(name):", "        return name"]);
  });

  it("Backspace joins a line to the one above it", () => {
    caretAt(block, 1, 0);
    press(block, "Backspace");
    expect(body()).toEqual(["def greet(name):    return name"]);
  });

  it("Backspace at the very start does nothing", () => {
    caretAt(block, 0, 0);
    press(block, "Backspace");
    expect(body()).toEqual(["def greet(name):", "    return name"]);
  });

  it("Delete at the end of a line pulls the next one up", () => {
    caretAt(block, 0, 16);
    press(block, "Delete");
    expect(body()).toEqual(["def greet(name):    return name"]);
  });

  it("Delete at the very end does nothing", () => {
    caretAt(block, 1, 15);
    press(block, "Delete");
    expect(body()).toEqual(["def greet(name):", "    return name"]);
  });

  it("an edit marks the block for synchronization", () => {
    caretAt(block, 0, 3);
    press(block, "Tab");
    expect(h.core.dirty.has(block)).toBe(true);
  });
});

describe("the source editor over a block", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h_setCaret = h.code.setCodeCaret;
  });

  it("Done writes the edited text back over the block's own lines", () => {
    const island = document.createElement("div");
    island.setAttribute("data-src-line", "0");
    island.setAttribute("data-src-end", "4");
    h.docEl.appendChild(island);

    h.code.openLiveEditor(island, 0, 4, "::: mypackage.mymodule", "mkdocstrings");
    const box = h.docEl.querySelector(".vlive") as HTMLElement;
    const ta = box.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "::: mypackage.other";
    Array.from(box.querySelectorAll("button"))
      .find((b) => b.textContent === "Done")!
      .click();
    expect(h.posts.at(-1)!.edits).toEqual([{ start: 0, end: 4, text: "::: mypackage.other\n" }]);
  });

  it("Cancel puts the block back and writes nothing", () => {
    const island = document.createElement("div");
    island.setAttribute("data-src-line", "0");
    island.setAttribute("data-src-end", "4");
    h.docEl.appendChild(island);

    h.code.openLiveEditor(island, 0, 4, "::: mypackage", "mkdocstrings");
    const box = h.docEl.querySelector(".vlive") as HTMLElement;
    Array.from(box.querySelectorAll("button"))
      .find((b) => b.textContent === "Cancel")!
      .click();
    expect(h.docEl.querySelector(".vlive")).toBe(null);
    expect(h.docEl.firstElementChild).toBe(island);
    expect(h.posts).toHaveLength(0);
  });

  it("indents what it writes, so a nested island stays nested", () => {
    const island = document.createElement("div");
    island.setAttribute("data-src-line", "2");
    island.setAttribute("data-src-end", "3");
    h.docEl.appendChild(island);

    h.code.openLiveEditor(island, 2, 3, "::: pkg", "mkdocstrings", "    ");
    const box = h.docEl.querySelector(".vlive") as HTMLElement;
    (box.querySelector("textarea") as HTMLTextAreaElement).value = "::: pkg\n::: other";
    Array.from(box.querySelectorAll("button"))
      .find((b) => b.textContent === "Done")!
      .click();
    expect(h.posts.at(-1)!.edits![0].text).toBe("    ::: pkg\n    ::: other\n");
  });
});
