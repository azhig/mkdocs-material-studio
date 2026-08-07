// @vitest-environment happy-dom
//
// What the clipboard turns into inside the document. Three roads, and this file
// is about which one a paste takes: whole blocks go through the FILE as
// Markdown, inline content goes in as nodes at the caret (keeping the data
// attributes our islands live in), and our own cut block answers a paste the
// system clipboard could not serve.

import { describe, expect, it, vi } from "vitest";

type Paste = typeof import("../../webviews/visual/pasteContent");
type Core = typeof import("../../webviews/visual/editorCore");

interface Harness {
  core: Core;
  docEl: HTMLElement;
  /** Markdown handed to insertMarkdownBlock — the block-paste road. */
  inserted: string[];
  /** Puts a rendered document in, the way the editor does — not as an edit. */
  render(html: string): Promise<void>;
}

async function fresh(): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  docEl.setAttribute("contenteditable", "true");
  const statusEl = document.createElement("span");
  document.body.append(docEl, statusEl);

  const topBlockOf = (node: Node | null): Element | null => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return el?.closest("#doc > *") ?? null;
  };
  const inserted: string[] = [];
  const core: Core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl,
    post: () => {},
    topBlockOf,
    caretInBlock: () => false,
    inSub: () => false,
    renderSub: () => {},
  });

  const paste: Paste = await import("../../webviews/visual/pasteContent");
  paste.initPasteContent({
    docEl,
    topBlockOf,
    insertMarkdownBlock: (template) => inserted.push(template),
  });
  // The handler itself still belongs to the module that owns pasted images.
  docEl.addEventListener("paste", (e) => {
    if (paste.pasteClipboard(e.clipboardData)) {
      e.preventDefault();
    }
  });

  return {
    core,
    docEl,
    inserted,
    async render(html: string) {
      core.mutedRemote(() => {
        docEl.innerHTML = html;
      });
      await new Promise((r) => setTimeout(r, 0));
      core.dirty.clear();
    },
  };
}

describe("pasting blocks from the clipboard", () => {
  it("a block fragment travels through the file as Markdown, not through insertHTML", async () => {
    const h = await fresh();
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    const p = h.docEl.querySelector("p")!;
    const sel = document.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    const dt = new DataTransfer();
    dt.setData(
      "text/html",
      '<div class="admonition note"><p class="admonition-title">Head</p><p>Inner.</p></div>',
    );
    h.docEl.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    expect(h.inserted).toEqual(['!!! note "Head"\n    Inner.']);
    // insertHTML did not run: the paragraph is untouched.
    expect(p.textContent).toBe("Target.");
  });

  it("a diagram alone still counts as content to paste", async () => {
    const h = await fresh();
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    const dt = new DataTransfer();
    dt.setData(
      "text/html",
      '<pre class="mermaid" data-mermaid-src="graph TD;A-->B;"><svg>drawn</svg></pre>',
    );
    h.docEl.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    expect(h.inserted).toEqual(["```mermaid\ngraph TD;A-->B;\n```"]);
  });
});

// An island shows what the render drew — <kbd>s, KaTeX, a footnote number —
// while what goes back into the file lives in its data attribute. Chrome's own
// paste (execCommand) trades those attributes for an inline style, which is how
// a pasted key combination used to arrive as plain text.
describe("pasting inline content", () => {
  const KEYS =
    '<span class="keys" data-keys="++ctrl+alt+del++" contenteditable="false">' +
    "<kbd>Ctrl</kbd><span>+</span><kbd>Alt</kbd><span>+</span><kbd>Del</kbd></span>";

  async function pasteHtml(h: Harness, html: string): Promise<void> {
    const p = h.docEl.querySelector("p")!;
    const sel = document.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    h.docEl.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
  }

  it("an island keeps the source the serializer reads", async () => {
    const h = await fresh();
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    await pasteHtml(h, KEYS);
    const island = h.docEl.querySelector("[data-keys]");
    expect(island?.getAttribute("data-keys")).toBe("++ctrl+alt+del++");
    expect(island?.closest("p")?.textContent).toContain("Target.");
    expect(h.inserted).toEqual([]); // inline content is not a block edit
  });

  it("asks the answer to this edit for the island's rendered look", async () => {
    const h = await fresh();
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    await pasteHtml(h, KEYS);
    // What went in is the source spelling; the <kbd>s come from the engine.
    expect(h.core.takeInlineRefresh()).toEqual({ block: h.docEl.querySelector("p"), index: 0 });
  });

  it("a lone paragraph merges into the text and brings its islands along", async () => {
    const h = await fresh();
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    await pasteHtml(h, `<p>Press ${KEYS} now.</p>`);
    const p = h.docEl.querySelector("p")!;
    expect(h.docEl.querySelectorAll("p")).toHaveLength(1); // no paragraph inside a paragraph
    expect(p.textContent).toContain("Target.Press");
    expect(p.querySelector("[data-keys]")).not.toBeNull();
  });

  it("pasting into an empty draft takes its <br> with it", async () => {
    const h = await fresh();
    // The draft paragraph the editor keeps at the end: a lone <br> to click into.
    await h.render("<p><br></p>");
    const draft = h.docEl.querySelector("p")!;
    const sel = document.getSelection()!;
    const r = document.createRange();
    r.setStart(draft, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    const dt = new DataTransfer();
    dt.setData("text/html", "<b>Bold</b> text");
    h.docEl.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    // Left in place, the <br> keeps the placeholder visible over the text and
    // the serializer writes it as a hard break — two spaces at the end of a line.
    expect(draft.querySelector("br")).toBeNull();
    expect(draft.textContent).toBe("Bold text");
  });

  it("text standing next to a block becomes a paragraph of its own", async () => {
    const h = await fresh();
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    await pasteHtml(h, "tail text <h2>A heading</h2>");
    expect(h.inserted).toEqual(["tail text\n\n## A heading"]);
  });
});

describe("pasting the handle's own block clipboard", () => {
  it("plain text that IS our cut block becomes a block, not literal characters", async () => {
    const h = await fresh();
    const bh = await import("../../webviews/visual/blockClipboard");
    bh.rememberBlockClipboard("!!! abstract\n\n    Text.");
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    const dt = new DataTransfer();
    dt.setData("text/plain", "!!! abstract\n\n    Text.");
    h.docEl.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
    expect(h.inserted).toEqual(["!!! abstract\n\n    Text."]);
  });

  it("foreign plain text still goes in as text", async () => {
    const h = await fresh();
    const bh = await import("../../webviews/visual/blockClipboard");
    bh.rememberBlockClipboard("!!! abstract\n\n    Text.");
    await h.render('<p data-src-line="0" data-src-end="1">Target.</p>');
    const dt = new DataTransfer();
    dt.setData("text/plain", "just words from elsewhere");
    const e = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    h.docEl.dispatchEvent(e);
    expect(h.inserted).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });
});
