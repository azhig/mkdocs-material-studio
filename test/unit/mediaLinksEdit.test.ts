// @vitest-environment happy-dom
//
// Links and images as they reach the document: the address written into a link,
// the attributes of an image, and the round trip that saves a dropped picture
// next to the page and puts it in at the caret.
//
// The path arithmetic itself is covered in mediaLinks.test.ts. This file is
// about what happens to the document — and about the token protocol, which is
// the part that can silently insert a picture in the wrong place.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteNode } from "../../src/core/siteNavBuild";

type Media = typeof import("../../webviews/visual/mediaLinks");
type Core = typeof import("../../webviews/visual/editorCore");

interface Posted {
  type: string;
  token?: number;
  kind?: string;
  name?: string;
  mime?: string;
  data?: string;
}

interface Harness {
  media: Media;
  core: Core;
  docEl: HTMLElement;
  posts: Posted[];
  page: { active: string | undefined };
  nav: SiteNode[];
  /** Markdown handed to insertMarkdownBlock — the block-paste path. */
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

  const state = {
    posts: [] as Posted[],
    page: { active: "guide/writing.md" as string | undefined },
    nav: [] as SiteNode[],
    inserted: [] as string[],
  };
  const core: Core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl,
    post: () => {},
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    caretInBlock: () => false,
    inSub: () => false,
    renderSub: () => {},
  });

  const media: Media = await import("../../webviews/visual/mediaLinks");
  media.initMediaLinks({
    docEl,
    post: (msg) => state.posts.push(msg as Posted),
    activePage: () => state.page.active,
    chromeData: () => ({ nav: state.nav }),
    enclosingTag: (node, tagName) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest<HTMLElement>(tagName.toLowerCase()) ?? null;
    },
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    ensureTrailingDraft: () => {
      if (!docEl.lastElementChild || docEl.lastElementChild.tagName !== "P") {
        docEl.appendChild(document.createElement("p"));
      }
    },
    insertPoint: () => ({ line: 0, indent: "" }),
    insertMarkdownBlock: (template) => state.inserted.push(template),
  });
  return {
    media,
    core,
    docEl,
    ...state,
    async render(html: string) {
      core.mutedRemote(() => {
        docEl.innerHTML = html;
      });
      await new Promise((r) => setTimeout(r, 0));
      core.dirty.clear();
    },
  } as Harness;
}

function caretIn(el: Element, offset = 0): void {
  const range = document.createRange();
  range.setStart(el.firstChild ?? el, offset);
  range.collapse(true);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

function popup(): HTMLElement {
  const pop = document.querySelector<HTMLElement>(".vpop");
  if (!pop) {
    throw new Error("no popup is open");
  }
  return pop;
}

describe("what is offered while typing a link", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("offers the headings of the page being edited", () => {
    h.docEl.innerHTML =
      '<h2 id="getting-started">Getting started<a class="header-anchor">¶</a></h2>';
    expect(h.media.linkSuggestions()).toEqual([
      { value: "#getting-started", hint: "Getting started" },
    ]);
  });

  it("writes a heading id in its readable form, not percent-encoded", () => {
    // The render encodes it; browsers resolve either, and MkDocs writes the
    // readable one — so that is what goes into somebody's file.
    h.docEl.innerHTML = '<h2 id="d%C3%A9but">Début</h2>';
    expect(h.media.linkSuggestions()[0].value).toBe("#début");
  });

  it("leaves a broken escape alone instead of throwing", () => {
    h.docEl.innerHTML = '<h2 id="100%-done">100% done</h2>';
    expect(h.media.linkSuggestions()[0].value).toBe("#100%-done");
  });

  it("offers the pages of the site, relative to the page being edited", () => {
    h.nav.push(
      { kind: "page", title: "Home", path: "index.md" },
      {
        kind: "section",
        title: "Guide",
        children: [{ kind: "page", title: "Diagrams", path: "guide/diagrams.md" }],
      },
    );
    expect(h.media.linkSuggestions()).toEqual([
      { value: "../index.md", hint: "Home" },
      { value: "diagrams.md", hint: "Diagrams" },
    ]);
  });
});

describe("inserting a link", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    await h.render("<p>see the guide here</p>");
  });

  it("wraps the selected words", () => {
    const p = h.docEl.firstElementChild!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 8);
    range.setEnd(p.firstChild!, 13);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    h.media.insertLinkAtSelection("guide.md", "guide");
    expect(p.innerHTML).toBe('see the <a href="guide.md">guide</a> here');
  });

  it("with no selection puts the text in, and the address when there is no text", async () => {
    const p = h.docEl.firstElementChild!;
    caretIn(p, 0);
    h.media.insertLinkAtSelection("setup.md", "Setup");
    expect(h.docEl.querySelector("a")?.textContent).toBe("Setup");

    await h.render("<p>x</p>");
    caretIn(h.docEl.firstElementChild!, 0);
    h.media.insertLinkAtSelection("https://example.com", "");
    expect(h.docEl.querySelector("a")?.textContent).toBe("https://example.com");
  });

  it("carries a tooltip when one was given", () => {
    caretIn(h.docEl.firstElementChild!, 0);
    h.media.insertLinkAtSelection("setup.md", "Setup", "How to install");
    expect(h.docEl.querySelector("a")?.getAttribute("title")).toBe("How to install");
  });

  it("marks the block so the link reaches the file", () => {
    const p = h.docEl.firstElementChild!;
    caretIn(p, 0);
    h.media.insertLinkAtSelection("setup.md", "Setup");
    expect(h.core.dirty.has(p)).toBe(true);
  });
});

describe("the chip on a link under the caret", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("appears inside a link and goes away outside one", () => {
    h.docEl.innerHTML = '<p>see <a href="setup.md">setup</a> now</p>';
    caretIn(h.docEl.querySelector("a")!, 2);
    h.media.updateLinkChip();
    expect(document.querySelector(".vpop.chip")).not.toBe(null);

    caretIn(h.docEl.firstElementChild!, 0);
    h.media.updateLinkChip();
    expect(document.querySelector(".vpop.chip")).toBe(null);
  });

  it("stays away from a heading's own anchor — that is not the author's link", () => {
    h.docEl.innerHTML = '<h2 id="x">Title<a class="header-anchor" href="#x">¶</a></h2>';
    caretIn(h.docEl.querySelector("a")!, 0);
    h.media.updateLinkChip();
    expect(document.querySelector(".vpop.chip")).toBe(null);
  });
});

describe("the image form", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h.docEl.innerHTML = "<p>text</p>";
  });

  /** Fills the form and submits it. */
  function fill(values: { src?: string; alt?: string; width?: string; align?: string }): void {
    const pop = popup();
    const inputs = Array.from(pop.querySelectorAll("input"));
    const [src, alt, width] = inputs;
    if (values.src !== undefined) src.value = values.src;
    if (values.alt !== undefined) alt.value = values.alt;
    if (values.width !== undefined) width.value = values.width;
    if (values.align !== undefined) {
      (pop.querySelector("select") as HTMLSelectElement).value = values.align;
    }
    pop.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  }

  it("inserts a picture with the alt text it was given", () => {
    caretIn(h.docEl.firstElementChild!, 4);
    h.media.openImagePopup();
    fill({ src: "assets/diagram.png", alt: "The pipeline" });
    const img = h.docEl.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("assets/diagram.png");
    expect(img.getAttribute("alt")).toBe("The pipeline");
  });

  it("writes width and alignment only when they were asked for", () => {
    caretIn(h.docEl.firstElementChild!, 4);
    h.media.openImagePopup();
    fill({ src: "a.png", width: "300", align: "left" });
    const img = h.docEl.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("300");
    expect(img.getAttribute("align")).toBe("left");
  });

  it("editing an existing picture clears the attributes that were emptied", () => {
    h.docEl.innerHTML = '<p><img src="a.png" alt="old" width="300" align="left"></p>';
    const img = h.docEl.querySelector("img")!;
    h.media.openImagePopup(img);
    fill({ src: "b.png", alt: "new", width: "", align: "" });
    expect(img.getAttribute("src")).toBe("b.png");
    expect(img.getAttribute("alt")).toBe("new");
    expect(img.hasAttribute("width")).toBe(false);
    expect(img.hasAttribute("align")).toBe(false);
  });

  it("an empty address inserts nothing", () => {
    caretIn(h.docEl.firstElementChild!, 4);
    h.media.openImagePopup();
    fill({ src: "  " });
    expect(h.docEl.querySelector("img")).toBe(null);
  });

  it("Delete removes the picture and marks its block", () => {
    h.docEl.innerHTML = '<p><img src="a.png" alt=""></p>';
    const block = h.docEl.firstElementChild!;
    h.media.openImagePopup(h.docEl.querySelector("img")!);
    Array.from(popup().querySelectorAll("button"))
      .find((b) => b.textContent === "Delete")!
      .click();
    expect(h.docEl.querySelector("img")).toBe(null);
    expect(h.core.dirty.has(block)).toBe(true);
  });
});

describe("choosing a file through the dialog", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
  });

  it("asks the extension and resolves with the answer to that request", async () => {
    const pending = h.media.pickFile("image");
    const asked = h.posts.at(-1)!;
    expect(asked).toMatchObject({ type: "pickFile", kind: "image" });
    h.media.onFilePicked(asked.token!, "assets/logo.png");
    await expect(pending).resolves.toBe("assets/logo.png");
  });

  it("ignores an answer to a request it is not waiting for", async () => {
    const pending = h.media.pickFile("snippet");
    const asked = h.posts.at(-1)!;
    h.media.onFilePicked(asked.token! + 99, "wrong.png");
    h.media.onFilePicked(asked.token!, "right.png");
    await expect(pending).resolves.toBe("right.png");
  });

  it("a dismissed dialog resolves with nothing rather than hanging", async () => {
    const pending = h.media.pickFile("image");
    h.media.onFilePicked(h.posts.at(-1)!.token!, "");
    await expect(pending).resolves.toBe("");
  });
});

describe("a picture dropped into the page", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h.docEl.innerHTML = "<p>text</p>";
  });

  /** Drops files on the document, the way a file manager does. */
  function drop(files: File[]): void {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files, items: [] } });
    Object.defineProperty(event, "clientX", { value: 0 });
    Object.defineProperty(event, "clientY", { value: 0 });
    h.docEl.dispatchEvent(event);
  }

  const png = (name: string): File =>
    new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });

  /**
   * Waits until the extension has been asked to save something. Reading a file
   * goes through FileReader and is awaited once per file, so the number of
   * ticks depends on how many were dropped — waiting for the request itself is
   * the only honest way to synchronize.
   */
  async function settle(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      if (h.posts.some((p) => p.type === "saveImage")) {
        return;
      }
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  const saveRequests = (): unknown[] => h.posts.filter((p) => p.type === "saveImage");

  /** Waits for a condition, then leaves the assertion to say what went wrong. */
  async function until(ready: () => boolean, ticks = 200): Promise<void> {
    for (let i = 0; i < ticks && !ready(); i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  /**
   * Checks that something stays true for a while. For “nothing else is sent
   * yet” a single look proves little: on a slow machine the file may simply not
   * have been read at that instant, and the assertion passes for the wrong
   * reason — which is how this suite passed everywhere except Windows.
   */
  async function holds(check: () => void, ticks = 50): Promise<void> {
    for (let i = 0; i < ticks; i++) {
      check();
      await new Promise((r) => setTimeout(r, 1));
    }
  }

  it("is sent to the extension to be saved, with its name and type", async () => {
    drop([png("photo.png")]);
    await settle();
    expect(h.posts.at(-1)).toMatchObject({
      type: "saveImage",
      name: "photo.png",
      mime: "image/png",
    });
  });

  it("appears in the document once the extension reports where it went", async () => {
    drop([png("photo.png")]);
    await settle();
    h.media.onImageSaved(h.posts.at(-1)!.token!, "assets/photo.png");
    expect(h.docEl.querySelector("img")?.getAttribute("src")).toBe("assets/photo.png");
  });

  it("several pictures are saved one at a time, in the order they were dropped", async () => {
    drop([png("one.png"), png("two.png")]);
    await settle();
    // Only the first request goes out; the second waits for its answer, so the
    // pictures cannot land in the document in the wrong order.
    expect(h.posts.filter((p) => p.type === "saveImage")).toHaveLength(1);
    expect(h.posts.at(-1)!.name).toBe("one.png");

    h.media.onImageSaved(h.posts.at(-1)!.token!, "assets/one.png");
    const second = h.posts.at(-1)!;
    expect(second.name).toBe("two.png");
    h.media.onImageSaved(second.token!, "assets/two.png");

    expect(Array.from(h.docEl.querySelectorAll("img"), (i) => i.getAttribute("src"))).toEqual([
      "assets/one.png",
      "assets/two.png",
    ]);
  });

  it("lands each picture after the previous one, at the caret", async () => {
    // With a caret inside the document the pictures go in at that point, one
    // after the other. Note that `imageInsertRange = after` in the source is a
    // belt-and-braces line: `collapse(false)` before each insert already leaves
    // the range past the previous picture, so removing the assignment changes
    // nothing here or in a browser. Kept as a test of the visible order.
    caretIn(h.docEl.firstElementChild!, 4);
    drop([png("one.png"), png("two.png")]);
    await settle();
    h.media.onImageSaved(h.posts.at(-1)!.token!, "assets/one.png");
    h.media.onImageSaved(h.posts.at(-1)!.token!, "assets/two.png");
    expect(Array.from(h.docEl.querySelectorAll("img"), (i) => i.getAttribute("src"))).toEqual([
      "assets/one.png",
      "assets/two.png",
    ]);
  });

  it("a second drop waits for the first to be answered", async () => {
    drop([png("one.png")]);
    await settle();
    const first = h.posts.at(-1)!;
    drop([png("two.png")]);
    // One request in flight, and it stays one while the second file is read:
    // sending both at once would let the answers come back in either order, and
    // the pictures with them.
    await holds(() => expect(saveRequests()).toHaveLength(1));

    h.media.onImageSaved(first.token!, "assets/one.png");
    await until(() => saveRequests().length === 2);
    expect(saveRequests()).toHaveLength(2);
  });

  it("an answer to some other request inserts nothing", async () => {
    drop([png("photo.png")]);
    await settle();
    h.media.onImageSaved(h.posts.at(-1)!.token! + 99, "assets/wrong.png");
    expect(h.docEl.querySelector("img")).toBe(null);
  });

  it("a failure says so and lets the queue carry on", async () => {
    drop([png("one.png"), png("two.png")]);
    await settle();
    const first = h.posts.at(-1)!;
    h.media.onImageSaveFailed(first.token!, "disk full");
    expect(h.docEl.querySelector("img")).toBe(null);
    const second = h.posts.at(-1)!;
    expect(second.name).toBe("two.png");
    h.media.onImageSaved(second.token!, "assets/two.png");
    expect(h.docEl.querySelector("img")?.getAttribute("src")).toBe("assets/two.png");
  });

  it("a dropped file that is not a picture is left to the browser", async () => {
    drop([new File(["text"], "notes.txt", { type: "text/plain" })]);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.posts.filter((p) => p.type === "saveImage")).toHaveLength(0);
  });
});
