// @vitest-environment happy-dom
//
// The insertion forms — what each of them actually writes into the file. Every
// component of the Material reference goes through here, so a mistake in one of
// these templates is markup somebody has to fix by hand afterwards.
//
// The forms are driven the way a user drives them: open the popup, fill the
// fields, press the button, and read back what was handed to the editor.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Inserts = typeof import("../../webviews/visual/blockInserts");
type Core = typeof import("../../webviews/visual/editorCore");

interface Harness {
  inserts: Inserts;
  core: Core;
  docEl: HTMLElement;
  /** Templates handed to the editor for insertion. */
  inserted: string[];
  /** Batches the admonition edit sent to the file. */
  posts: { edits?: { start: number; end: number; text: string }[] }[];
  /** What the file dialog will answer. */
  pickedFile: string;
}

async function fresh(): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  const statusEl = document.createElement("span");
  // Every form anchors itself to the “+ Insert” button when there is one.
  const anchor = document.createElement("button");
  anchor.id = "tbComponent";
  document.body.append(docEl, statusEl, anchor);

  const state = { inserted: [] as string[], posts: [] as Harness["posts"], pickedFile: "" };
  const core: Core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl,
    post: (msg) => state.posts.push(msg as Harness["posts"][number]),
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    caretInBlock: () => false,
    inSub: () => false,
    renderSub: () => {},
  });
  const inserts: Inserts = await import("../../webviews/visual/blockInserts");
  inserts.initInserts({
    insertPoint: () => ({ line: 0, indent: "" }),
    insertMarkdownBlock: (template) => state.inserted.push(template),
    popupAnchor: () => anchor,
    // The real editor looks a block up by the line it starts on — an admonition
    // changing its type is found again this way after an answer replaced it.
    blockByStart: (start) =>
      Array.from(docEl.querySelectorAll("[data-src-line]")).find(
        (el) => Number(el.getAttribute("data-src-line")) === start,
      ),
    caretInto: () => {},
    pickFile: () => Promise.resolve(state.pickedFile),
    linkSuggestions: () => [],
  });
  return {
    inserts,
    core,
    docEl,
    get inserted() {
      return state.inserted;
    },
    get posts() {
      return state.posts;
    },
    set pickedFile(v: string) {
      state.pickedFile = v;
    },
    get pickedFile() {
      return state.pickedFile;
    },
  } as Harness;
}

/** The popup currently open. */
function popup(): HTMLElement {
  const pop = document.querySelector<HTMLElement>(".vpop");
  if (!pop) {
    throw new Error("no popup is open");
  }
  return pop;
}

/** Clicks a button of the open popup by its visible text. */
function press(text: string): void {
  const btn = Array.from(popup().querySelectorAll<HTMLElement>("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  );
  if (!btn) {
    throw new Error(`no “${text}” button in the popup`);
  }
  btn.click();
}

/** Submits the form of the open popup, the way Enter or the OK button does. */
function submit(): void {
  popup()
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
}

function fields(): HTMLInputElement[] {
  return Array.from(popup().querySelectorAll("input"));
}

describe("admonitions", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  // The title is left out when it would only repeat the type: Material shows
  // the same word anyway, and the serializer drops such a title the moment the
  // block is edited — which the author would see as a change they never made.
  it("inserts a note with a body line and no title of its own", () => {
    h.inserts.openAdmonitionInsert();
    press("Insert");
    expect(h.inserted).toEqual(["!!! note\n    Text."]);
  });

  it("the chosen type becomes the keyword", () => {
    h.inserts.openAdmonitionInsert();
    popup().querySelector<HTMLElement>(".adm-type.adm-warning")!.click();
    press("Insert");
    expect(h.inserted).toEqual(["!!! warning\n    Text."]);
  });

  it("a translated label is written — it is not what Material would show", async () => {
    // The bundle is read when the module loads, so it goes in before the import.
    const w = window as unknown as { __i18n?: { lang: string; strings: Record<string, string> } };
    w.__i18n = { lang: "el", strings: { Note: "Σημείωση" } };
    try {
      const greek = await fresh();
      greek.inserts.openAdmonitionInsert();
      press("Insert");
      expect(greek.inserted).toEqual(['!!! note "Σημείωση"\n    Text.']);
    } finally {
      delete w.__i18n;
    }
  });

  it("collapsible states use the markers Material expects", () => {
    for (const [button, marker] of [
      ["Collapsed ▸", "???"],
      ["Expanded ▾", "???+"],
    ] as const) {
      h.inserted.length = 0;
      h.inserts.openAdmonitionInsert();
      press(button);
      press("Insert");
      expect(h.inserted[0].startsWith(`${marker} note\n`)).toBe(true);
    }
  });

  it("reads the type and the state of an existing block", () => {
    const plain = document.createElement("div");
    plain.className = "admonition tip";
    expect(h.inserts.currentAdmonitionState(plain)).toEqual({ type: "tip", collapse: "plain" });

    const collapsed = document.createElement("details");
    collapsed.className = "admonition danger";
    expect(h.inserts.currentAdmonitionState(collapsed)).toEqual({
      type: "danger",
      collapse: "collapsed",
    });
    collapsed.setAttribute("open", "");
    expect(h.inserts.currentAdmonitionState(collapsed).collapse).toBe("expanded");
  });
});

describe("changing an admonition already in the file", () => {
  let h: Harness;
  let block: HTMLElement;

  beforeEach(async () => {
    h = await fresh();
    h.core.adoptText('!!! note "My title"\n    Body text.\n', 1);
    h.docEl.innerHTML =
      '<div class="admonition note" data-src-line="0" data-src-end="2"><p>Body text.</p></div>';
    block = h.docEl.firstElementChild as HTMLElement;
  });

  /** The text the batch would put in the file. */
  function written(): string {
    const edit = h.posts.at(-1)!.edits![0];
    const lines = '!!! note "My title"\n    Body text.\n'.split("\n");
    lines.pop();
    lines.splice(edit.start, edit.end - edit.start, ...edit.text.replace(/\n$/, "").split("\n"));
    return lines.join("\n") + "\n";
  }

  it("swaps the keyword and leaves the author's title alone", () => {
    h.inserts.applyAdmonitionChange(block, { type: "warning" });
    expect(written()).toBe('!!! warning "My title"\n    Body text.\n');
  });

  it("swaps the marker without touching the type", () => {
    h.inserts.applyAdmonitionChange(block, { collapse: "expanded" });
    expect(written()).toBe('???+ note "My title"\n    Body text.\n');
  });

  it("keeps the indent of a nested block", () => {
    h.core.adoptText('=== "Tab"\n\n    !!! note "Inner"\n        Body.\n', 1);
    h.docEl.innerHTML =
      '<div class="admonition note" data-src-line="2" data-src-end="4"><p>Body.</p></div>';
    const nested = h.docEl.firstElementChild as HTMLElement;
    h.inserts.applyAdmonitionChange(nested, { type: "tip" });
    expect(h.posts.at(-1)!.edits![0].text).toBe('    !!! tip "Inner"\n        Body.\n');
  });

  it("keeps extra tokens after the type — they are the author's attributes", () => {
    h.core.adoptText('!!! note inline end "Side note"\n    Body.\n', 1);
    h.docEl.innerHTML =
      '<div class="admonition note" data-src-line="0" data-src-end="2"><p>Body.</p></div>';
    const inline = h.docEl.firstElementChild as HTMLElement;
    h.inserts.applyAdmonitionChange(inline, { type: "info" });
    expect(h.posts.at(-1)!.edits![0].text).toBe('!!! info inline end "Side note"\n    Body.\n');
  });

  it("a block whose first line is not an admonition is left alone", () => {
    h.core.adoptText("Just a paragraph.\n", 1);
    h.docEl.innerHTML = '<p data-src-line="0" data-src-end="1">Just a paragraph.</p>';
    const para = h.docEl.firstElementChild as HTMLElement;
    h.inserts.applyAdmonitionChange(para, { type: "note" });
    expect(h.posts).toHaveLength(0);
  });
});

describe("tables", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  // The empty cells are as wide as the serializer writes them: any narrower and
  // the first edit to the table would repad every cell in it.
  it("builds a header row, a separator and as many body rows as asked", () => {
    expect(h.inserts.tableMarkdown(2, 3)).toBe(
      "| Heading 1 | Heading 2 | Heading 3 |\n" +
        "| --- | --- | --- |\n" +
        "|     |     |     |\n" +
        "|     |     |     |",
    );
  });

  it("the size grid inserts the size that was clicked", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    h.inserts.openTableGrid(anchor);
    const cell = popup().querySelector<HTMLElement>('.vgrid span[data-r="3"][data-c="4"]')!;
    cell.click();
    expect(h.inserted).toEqual([h.inserts.tableMarkdown(3, 4)]);
  });
});

describe("content tabs and card grids", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("a tab set is one `===` line per tab", () => {
    h.inserts.openTabsInsert();
    const inputs = fields();
    inputs[0].value = "Python";
    inputs[1].value = "Shell";
    submit();
    expect(h.inserted).toEqual(['=== "Python"\n\n=== "Shell"']);
  });

  it("opens with two numbered tabs already filled in", () => {
    h.inserts.openTabsInsert();
    expect(fields().map((f) => f.value)).toEqual(["Tab 1", "Tab 2"]);
  });

  it("a tab the user emptied still gets a name — an empty title is not valid", () => {
    h.inserts.openTabsInsert();
    const inputs = fields();
    inputs[0].value = "";
    inputs[1].value = "   ";
    submit();
    expect(h.inserted).toEqual(['=== "Tab 1"\n\n=== "Tab 2"']);
  });

  it("a card the user emptied gets a name too", () => {
    h.inserts.openGridInsert();
    const inputs = fields();
    inputs[0].value = "";
    inputs[1].value = "";
    submit();
    expect(h.inserted[0]).toContain("- **Card 1**");
    expect(h.inserted[0]).toContain("- **Card 2**");
  });

  it("a quote in a tab title becomes an apostrophe — it would end the title", () => {
    h.inserts.openTabsInsert();
    fields()[0].value = 'the "quoted" one';
    submit();
    expect(h.inserted[0].split("\n")[0]).toBe("=== \"the 'quoted' one\"");
  });

  it("a card grid is a markdown div with one list item per card", () => {
    h.inserts.openGridInsert();
    const inputs = fields();
    inputs[0].value = "First";
    inputs[1].value = "Second";
    submit();
    expect(h.inserted).toEqual([
      '<div class="grid cards" markdown>\n\n' +
        "- **First**\n\n    Card description.\n\n" +
        "- **Second**\n\n    Card description.\n\n" +
        "</div>",
    ]);
  });
});

describe("code blocks, buttons and includes", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("a fence carries the language, the title and the line numbers it was given", () => {
    h.inserts.openCodeInsert();
    const [lang, linenums, title] = fields();
    lang.value = "python";
    linenums.checked = true;
    title.value = "app.py";
    submit();
    expect(h.inserted).toEqual(['```python title="app.py" linenums="1"\ncode\n```']);
  });

  it("a fence without any of them is a bare fence", () => {
    h.inserts.openCodeInsert();
    fields()[0].value = "";
    submit();
    expect(h.inserted).toEqual(["```\ncode\n```"]);
  });

  it("a button is a link with the Material class", () => {
    h.inserts.openButtonInsert();
    const [url, text] = fields();
    url.value = "downloads.md";
    text.value = "Download";
    submit();
    expect(h.inserted).toEqual(["[Download](downloads.md){ .md-button }"]);
  });

  it("the primary style adds the modifier, not a replacement", () => {
    h.inserts.openButtonInsert();
    const [url, text, primary] = fields();
    url.value = "start.md";
    text.value = "Get started";
    primary.checked = true;
    submit();
    expect(h.inserted).toEqual(["[Get started](start.md){ .md-button .md-button--primary }"]);
  });

  it("an empty button falls back to a label and an anchor rather than broken markup", () => {
    h.inserts.openButtonInsert();
    submit();
    expect(h.inserted).toEqual(["[Button](#){ .md-button }"]);
  });

  it("an include is the snippets syntax around the chosen path", async () => {
    h.pickedFile = "includes/abbreviations.md";
    h.inserts.openSnippetInsert();
    press("Choose file…");
    await Promise.resolve();
    expect(fields()[0].value).toBe("includes/abbreviations.md");
    submit();
    expect(h.inserted).toEqual(['--8<-- "includes/abbreviations.md"']);
  });

  it("an include with no path inserts nothing", () => {
    h.inserts.openSnippetInsert();
    submit();
    expect(h.inserted).toEqual([]);
  });
});
