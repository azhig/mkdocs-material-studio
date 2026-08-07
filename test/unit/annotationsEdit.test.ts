// @vitest-environment happy-dom
//
// Annotations against a real document: the `(1)` marker in the text, the
// `{ .annotate }` class that turns it into one, and the numbered list that
// holds the notes. Adding one touches two places in the file at once — the
// block and the list — so the batch has to be right in both.
//
// The writing of the list itself (renumbering, indents) is in
// annotations.test.ts, which needs no document. This file is about the edits
// that leave the editor, and about the sub-editor over a single note — the one
// place where `#doc` is a copy rather than the page.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncEdit } from "../../webviews/visual/syncModel";

type Annotations = typeof import("../../webviews/visual/annotations");
type SubEditor = typeof import("../../webviews/visual/annotationSubEditor");
type Core = typeof import("../../webviews/visual/editorCore");

interface Harness {
  ann: Annotations;
  sub: SubEditor;
  core: Core;
  docEl: HTMLElement;
  statusEl: HTMLElement;
  posts: { type: string; edits?: SyncEdit[] }[];
  /** The file with every batch applied, in the order they were sent. */
  file(): string;
  render(html: string): Promise<void>;
}

async function fresh(source: string): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  docEl.setAttribute("contenteditable", "true");
  const statusEl = document.createElement("span");
  document.body.append(docEl, statusEl);

  const posts: Harness["posts"] = [];
  const core: Core = await import("../../webviews/visual/editorCore");
  const topBlockOf = (node: Node | null): Element | null => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return el?.closest("#doc > *") ?? null;
  };
  core.initCore({
    docEl,
    statusEl,
    post: (msg) => posts.push(msg as Harness["posts"][number]),
    topBlockOf,
    caretInBlock: () => false,
    inSub: () => sub.inSubEditor(),
    renderSub: () => {},
  });
  core.adoptText(source, 1);

  const ann: Annotations = await import("../../webviews/visual/annotations");
  const sub: SubEditor = await import("../../webviews/visual/annotationSubEditor");
  ann.initAnnotations({
    docEl,
    post: () => {},
    blocksInOrder: () => Array.from(docEl.children),
    currentBlock: () => topBlockOf(document.getSelection()?.anchorNode ?? null),
    topBlockOf,
    caretIntoBlock: () => {},
    applyPatches: () => {},
    // The same arithmetic the editor uses: a new block needs a blank line
    // before it unless there already is one, and one after it.
    insertBlockEdit: (anchorLine, body) => {
      const lines = core.docLines();
      const atEof = anchorLine >= lines.length;
      const prevBlank = anchorLine === 0 || (lines[anchorLine - 1] ?? "").trim() === "";
      const lead = prevBlank ? "" : "\n";
      const trail = atEof
        ? core.docEndsNL()
          ? ""
          : "\n"
        : (lines[anchorLine] ?? "").trim() === ""
          ? "\n"
          : "\n\n";
      return { start: anchorLine, end: anchorLine, text: lead + body + trail };
    },
  });

  return {
    ann,
    sub,
    core,
    docEl,
    statusEl,
    posts,
    file() {
      const lines = source.replace(/\n$/, "").split("\n");
      for (const post of posts) {
        // Bottom-up, the way the provider applies a batch.
        for (const e of [...(post.edits ?? [])].sort((a, b) => b.start - a.start)) {
          const insert = e.text === "" ? [] : e.text.replace(/\n$/, "").split("\n");
          lines.splice(e.start, e.end - e.start, ...insert);
        }
      }
      return lines.join("\n") + "\n";
    },
    async render(html: string) {
      core.mutedRemote(() => {
        docEl.innerHTML = html;
      });
      await new Promise((r) => setTimeout(r, 0));
      core.dirty.clear();
      statusEl.textContent = "";
    },
  };
}

/**
 * Puts the caret at the end of an element's text — inside the text node, which
 * is where a real caret sits. It matters: the marker is separated from the word
 * before it by looking at the character to the left, and from an element
 * boundary there is no character to look at.
 */
function caretAtEndOf(el: Element): void {
  const range = document.createRange();
  const last = el.lastChild;
  if (last && last.nodeType === Node.TEXT_NODE) {
    range.setStart(last, (last.textContent ?? "").length);
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("adding an annotation to a paragraph", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh("Some text.\n");
    await h.render('<p data-src-line="0" data-src-end="1">Some text.</p>');
  });

  it("writes the marker, the class and a numbered list", () => {
    caretAtEndOf(h.docEl.firstElementChild!);
    h.ann.addAnnotation();
    expect(h.file()).toBe("Some text. (1)\n{ .annotate }\n\n1. Annotation text\n");
  });

  it("a second one continues the same list instead of starting another", async () => {
    h = await fresh("Some text. (1)\n{ .annotate }\n\n1. First note\n");
    await h.render(
      '<p class="annotate" data-src-line="0" data-src-end="2">Some text. (1)</p>' +
        '<ol data-src-line="3" data-src-end="4"><li>First note</li></ol>',
    );
    caretAtEndOf(h.docEl.firstElementChild!);
    h.ann.addAnnotation();
    expect(h.file()).toBe(
      "Some text. (1) (2)\n{ .annotate }\n\n1. First note\n2. Annotation text\n",
    );
  });

  it("keeps the blank line that separates the list from what follows", async () => {
    h = await fresh("Some text. (1)\n{ .annotate }\n\n1. First note\n\nNext paragraph.\n");
    await h.render(
      '<p class="annotate" data-src-line="0" data-src-end="2">Some text. (1)</p>' +
        '<ol data-src-line="3" data-src-end="5"><li>First note</li></ol>' +
        '<p data-src-line="5" data-src-end="6">Next paragraph.</p>',
    );
    caretAtEndOf(h.docEl.firstElementChild!);
    h.ann.addAnnotation();
    // Without the separator the next paragraph becomes a lazy continuation of
    // the last item and disappears into the note.
    expect(h.file()).toBe(
      "Some text. (1) (2)\n{ .annotate }\n\n1. First note\n2. Annotation text\n\nNext paragraph.\n",
    );
  });

  it("says where to put the caret when there is nowhere to annotate", () => {
    document.getSelection()?.removeAllRanges();
    h.ann.addAnnotation();
    expect(h.posts).toHaveLength(0);
    expect(h.statusEl.textContent).toContain("Place the cursor");
  });

  it("refuses a block the file does not know yet rather than leaving a stray marker", async () => {
    // A just-typed paragraph has no range. Writing the marker into it would put
    // a literal “(1)” in the text with no note behind it.
    await h.render("<p>Freshly typed.</p>");
    caretAtEndOf(h.docEl.firstElementChild!);
    h.ann.addAnnotation();
    expect(h.posts).toHaveLength(0);
    expect(h.docEl.textContent).toBe("Freshly typed.");
  });
});

describe("the dots drawn on the markers", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh("Some text. (1) and (2)\n{ .annotate }\n\n1. First\n2. Second\n");
    await h.render(
      '<p class="annotate" data-src-line="0" data-src-end="2">Some text. (1) and (2)</p>' +
        '<ol data-src-line="3" data-src-end="5"><li>First</li><li>Second</li></ol>',
    );
  });

  it("replaces each marker with a dot that carries its number", () => {
    h.ann.decorateAnnotations();
    const dots = Array.from(h.docEl.querySelectorAll<HTMLElement>(".md-annotation"));
    expect(dots).toHaveLength(2);
    // The number is an attribute; Material draws it with a CSS counter.
    expect(dots.map((d) => d.getAttribute("data-annotation-index"))).toEqual(["1", "2"]);
  });

  it("hides the list that the dots stand for", () => {
    h.ann.decorateAnnotations();
    const list = h.docEl.querySelector("ol")!;
    expect(list.classList.contains("annotation-list")).toBe(true);
  });

  it("leaves a paragraph without the class alone — “(1)” there is just text", async () => {
    h = await fresh("Version (1) of the format.\n");
    await h.render('<p data-src-line="0" data-src-end="1">Version (1) of the format.</p>');
    h.ann.decorateAnnotations();
    expect(h.docEl.querySelector(".md-annotation")).toBe(null);
    expect(h.docEl.textContent).toBe("Version (1) of the format.");
  });
});

describe("the sub-editor over a single note", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh("Some text. (1)\n{ .annotate }\n\n1. First note\n");
    await h.render(
      '<p class="annotate" data-src-line="0" data-src-end="2">Some text. (1)</p>' +
        '<ol data-src-line="3" data-src-end="4"><li>First note</li></ol>',
    );
    h.ann.decorateAnnotations();
  });

  /** Opens the note the way a reader does: click the dot, then its tip's edit. */
  function openNote(): void {
    h.docEl.querySelector<HTMLElement>(".md-annotation")!.click();
  }

  it("starts closed", () => {
    expect(h.sub.inSubEditor()).toBe(false);
  });

  it("a click on a dot opens the note's tip", () => {
    openNote();
    expect(h.ann.annotTips.length).toBe(1);
    expect(document.querySelector(".vannotip")).not.toBe(null);
  });

  it("closing the tips leaves the page as it was", () => {
    openNote();
    h.ann.closeAnnotationTips(0);
    expect(h.ann.annotTips.length).toBe(0);
    expect(document.querySelector(".vannotip")).toBe(null);
    expect(h.posts).toHaveLength(0);
  });

  it("closing a sub-editor that was never opened writes nothing", () => {
    h.sub.closeSubEditor(true);
    expect(h.sub.inSubEditor()).toBe(false);
    expect(h.posts).toHaveLength(0);
    expect(h.file()).toBe("Some text. (1)\n{ .annotate }\n\n1. First note\n");
  });

  it("a render meant for a note that is no longer open is ignored", () => {
    // The fragment comes back asynchronously; by then the note may have been
    // closed, and applying it would redraw the page with a note's body.
    h.sub.onSubRendered(999, "<p>stale</p>");
    expect(h.docEl.textContent).not.toContain("stale");
    expect(h.docEl.querySelector("p")?.textContent).toContain("Some text.");
  });
});

describe("deleting a note", () => {
  let h: Harness;

  /** Opens the tip of a dot and presses its Delete action. */
  function deleteNote(index: number): void {
    const dots = h.docEl.querySelectorAll<HTMLElement>(".md-annotation");
    dots[index].click();
    const del = document.querySelector<HTMLElement>(".vannotip .vannotip-del");
    if (!del) {
      throw new Error("no Delete action in the tip");
    }
    del.click();
  }

  beforeEach(async () => {
    h = await fresh("Some text. (1) (2) (3)\n{ .annotate }\n\n1. One\n2. Two\n3. Three\n");
    await h.render(
      '<p class="annotate" data-src-line="0" data-src-end="2">Some text. (1) (2) (3)</p>' +
        '<ol data-src-line="3" data-src-end="6"><li>One</li><li>Two</li><li>Three</li></ol>',
    );
    h.ann.decorateAnnotations();
  });

  it("removes the marker and its note, and renumbers what follows", () => {
    deleteNote(1);
    expect(h.file()).toBe("Some text. (1) (2)\n{ .annotate }\n\n1. One\n2. Three\n");
  });

  it("removing the first note shifts every marker down by one", () => {
    deleteNote(0);
    expect(h.file()).toBe("Some text. (1) (2)\n{ .annotate }\n\n1. Two\n2. Three\n");
  });

  it("removing the last one leaves the others as they are", () => {
    deleteNote(2);
    expect(h.file()).toBe("Some text. (1) (2)\n{ .annotate }\n\n1. One\n2. Two\n");
  });

  it("removing the only note takes the list and the class with it", async () => {
    h = await fresh("Some text. (1)\n{ .annotate }\n\n1. Only\n");
    await h.render(
      '<p class="annotate" data-src-line="0" data-src-end="2">Some text. (1)</p>' +
        '<ol data-src-line="3" data-src-end="4"><li>Only</li></ol>',
    );
    h.ann.decorateAnnotations();
    deleteNote(0);
    // The marker and the list go; the `{ .annotate }` line stays behind. It is
    // harmless — Material simply finds no markers under it — and it is what the
    // author needs again the moment they add another note. Recorded here so the
    // behaviour is a decision rather than an accident.
    expect(h.file()).toBe("Some text.\n{ .annotate }\n\n");
  });
});
