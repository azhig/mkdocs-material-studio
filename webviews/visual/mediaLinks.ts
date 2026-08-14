// Links, images, formulas — everything that puts something inline into the text
// rather than turning a block into another kind of block.
//
// The three share one problem: what goes in the file is a path or a piece of
// notation, but what the author works with is a picture, a page or a rendered
// formula. So each has a small form of its own, and each writes the one
// spelling MkDocs expects — a link to another page as a path relative to the
// page being edited, an image as a path under the docs folder, a formula
// between the delimiters pymdownx.arithmatex reads.
//
// Pasting and dropping an image also lands here: a picture arriving from the
// clipboard is written to a file next to the page, and the text gets a normal
// Markdown image once the extension answers with the path it chose. Everything
// else on the clipboard — markup, blocks, our own cut block — is pasteContent.

import { closePopup, formPopup, popupAtElement, popupAtSelection, type ComboItem } from "./popups";
import { dirty, markDirty, noteInlineIsland, scheduleSync, st } from "./editorCore";
import { pasteClipboard } from "./pasteContent";
import { dropPlaceholderBreak } from "./draftLines";
import { openButtonEdit, type InsertPoint } from "./blockInserts";
import { openMathDialog } from "./mathDialog";
import type { SiteNode } from "../../src/core/siteNavBuild";
import { t } from "../shared/i18n";

/** What the inline forms need from the editor around them. */
export interface MediaLinksHost {
  /** The document root. */
  readonly docEl: HTMLElement;
  /** Sends a message to the extension (saving an image, picking a file). */
  post(msg: unknown): void;
  /** The page being edited, as a path under the docs folder — links are
   *  written relative to it. */
  activePage(): string | undefined;
  /** The site's page tree, for the link suggestions. */
  chromeData(): { nav?: SiteNode[] } | undefined;
  /** The nearest ancestor with the given tag name, inside the document. */
  enclosingTag(node: Node | null, tagName: string): HTMLElement | null;
  /** The outermost block a node belongs to. */
  topBlockOf(node: Node | null): Element | null;
  /** Keeps an empty paragraph at the end, so there is always somewhere to type. */
  ensureTrailingDraft(): void;
  /** Where a new block would go, given the caret. */
  insertPoint(): InsertPoint;
  /** Inserts a ready piece of Markdown at that point. */
  insertMarkdownBlock(template: string, at?: InsertPoint): void;
}

let host: MediaLinksHost;

/** Wires the paste and drop handlers; the forms are opened on demand. */
export function initMediaLinks(next: MediaLinksHost): void {
  host = next;

  host.docEl.addEventListener("paste", (e) => {
    const anchor = document.getSelection()?.anchorNode ?? null;
    const anchorEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
    const inCode = anchorEl?.closest("pre, .vcode") !== null && anchorEl !== null;
    const files = imageFilesFromClipboard(e.clipboardData?.items);
    if (files.length > 0) {
      if (inCode) {
        return; // an image is not inserted inside a code block
      }
      e.preventDefault();
      void handleImageFiles(files, currentCaretRange());
      return;
    }
    if (inCode || e.defaultPrevented) {
      return; // a code block has its own handler — plain text is inserted there
    }
    if (pasteClipboard(e.clipboardData)) {
      e.preventDefault();
    }
  });

  host.docEl.addEventListener("dragover", (e) => {
    if (Array.from(e.dataTransfer?.items ?? []).some((it) => it.kind === "file")) {
      e.preventDefault(); // allow dropping files from outside
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    }
  });

  host.docEl.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) {
      return; // not an image file (for example, an internal reordering drag)
    }
    e.preventDefault();
    void handleImageFiles(files, caretRangeFromPoint(e.clientX, e.clientY));
  });
}

// --- link ---

/**
 * Link targets offered while typing: the headings of the current page (`#id`)
 * and the pages of the project, as a path relative to the page being edited —
 * exactly what MkDocs expects in the file. The page tree is the one the
 * navigation panel already receives.
 */
export function linkSuggestions(): ComboItem[] {
  const items: ComboItem[] = [];
  for (const h of Array.from(host.docEl.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"))) {
    const text = (h.textContent ?? "").replace(/¶$/, "").trim();
    // The render percent-encodes the id, but browsers resolve a fragment in
    // either form — so the readable one goes into the file. It is also what
    // MkDocs itself produces with Material's usual unicode slugify.
    items.push({ value: `#${safeDecode(h.id)}`, hint: text });
  }
  for (const page of chromePages(host.chromeData()?.nav ?? [])) {
    items.push({ value: relativeDocPath(host.activePage(), page.path), hint: page.title });
  }
  return items;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // a stray “%” in a hand-written anchor — show it as is
  }
}

export function chromePages(nodes: SiteNode[]): Array<{ path: string; title: string }> {
  const out: Array<{ path: string; title: string }> = [];
  for (const node of nodes) {
    if (node.kind === "page") {
      out.push({ path: node.path, title: node.title });
    } else if (node.kind === "section") {
      out.push(...chromePages(node.children));
    }
  }
  return out;
}

/** A path from one page to another, both given relative to the docs root. */
export function relativeDocPath(from: string | undefined, to: string): string {
  if (!from) {
    return to;
  }
  const fromDir = from.split("/").slice(0, -1);
  const toParts = to.split("/");
  let common = 0;
  while (
    common < fromDir.length &&
    common < toParts.length - 1 &&
    fromDir[common] === toParts[common]
  ) {
    common++;
  }
  const up = fromDir.length - common;
  const rest = toParts.slice(common);
  return (up > 0 ? "../".repeat(up) : "") + rest.join("/");
}

let savedRange: Range | null = null;

export function saveSelection(): void {
  const sel = document.getSelection();
  savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
}

export function restoreSelection(): void {
  if (savedRange) {
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRange);
  }
}

export function openLinkPopup(existing?: HTMLAnchorElement): void {
  // A `.md-button` is a link too, but its own form has the style switch.
  if (existing?.classList.contains("md-button")) {
    openButtonEdit(existing);
    return;
  }
  saveSelection();
  const pop = popupAtSelection();
  const selText = existing?.textContent ?? document.getSelection()?.toString() ?? "";
  formPopup(
    pop,
    [
      {
        name: "url",
        label: t("Link address"),
        value: existing?.getAttribute("href") ?? "",
        placeholder: t("https://… or page.md"),
        suggest: linkSuggestions,
      },
      { name: "text", label: t("Text"), value: selText },
      {
        name: "tip",
        label: t("Tooltip (optional)"),
        value: existing?.getAttribute("title") ?? "",
        placeholder: t("Shown on hover"),
      },
    ],
    "OK",
    (v) => {
      if (!v.url) {
        return;
      }
      if (existing) {
        existing.setAttribute("href", v.url);
        if (v.tip.trim()) {
          existing.setAttribute("title", v.tip.trim());
        } else {
          existing.removeAttribute("title");
        }
        if (v.text && v.text !== existing.textContent) {
          existing.textContent = v.text;
        }
        markDirty(existing);
        return;
      }
      restoreSelection();
      insertLinkAtSelection(v.url, v.text, v.tip.trim());
    },
  );
}

/** Wraps the selection in a link (or inserts one at the cursor) and marks the block dirty. */
export function insertLinkAtSelection(url: string, text: string, title?: string): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return;
  }
  const range = sel.getRangeAt(0);
  const a = document.createElement("a");
  a.setAttribute("href", url);
  if (title) {
    a.setAttribute("title", title);
  }
  if (range.collapsed) {
    a.textContent = text || url;
    range.insertNode(a);
  } else {
    try {
      range.surroundContents(a);
    } catch {
      a.textContent = text || range.toString();
      range.deleteContents();
      range.insertNode(a);
    }
  }
  const after = document.createRange();
  after.setStartAfter(a);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  markDirty(a);
}

/** The action chip shown when the cursor is inside a link. */
let linkChip: HTMLElement | null = null;
export function updateLinkChip(): void {
  const sel = document.getSelection();
  const a = sel && sel.isCollapsed ? host.enclosingTag(sel.anchorNode, "A") : null;
  const target = a && !a.classList.contains("header-anchor") ? (a as HTMLAnchorElement) : null;
  if (!target) {
    if (linkChip) {
      linkChip.remove();
      linkChip = null;
    }
    return;
  }
  if (linkChip?.dataset.for === target.getAttribute("href")) {
    return;
  }
  linkChip?.remove();
  const rect = target.getBoundingClientRect();
  const chip = document.createElement("div");
  chip.className = "vpop chip";
  chip.dataset.for = target.getAttribute("href") ?? "";
  chip.style.left = `${rect.left + window.scrollX}px`;
  chip.style.top = `${rect.bottom + window.scrollY + 4}px`;

  const url = document.createElement("span");
  url.className = "url";
  url.textContent = target.getAttribute("href") ?? "";
  const edit = document.createElement("button");
  edit.textContent = t("Edit");
  edit.addEventListener("click", () => {
    chip.remove();
    linkChip = null;
    openLinkPopup(target);
  });
  const unlink = document.createElement("button");
  unlink.className = "secondary";
  unlink.textContent = t("Remove");
  unlink.addEventListener("click", () => {
    const parent = target.parentNode;
    while (target.firstChild) {
      parent?.insertBefore(target.firstChild, target);
    }
    const block = host.topBlockOf(parent);
    target.remove();
    chip.remove();
    linkChip = null;
    if (block) {
      dirty.add(block);
      scheduleSync();
    }
  });
  chip.append(url, edit, unlink);
  document.body.appendChild(chip);
  linkChip = chip;
}

// --- image ---

// ---------------------------------------------------------------------------
// Images. One form for inserting and editing: the path (with a “Choose file…”
// button that opens the VS Code dialog), the description, the width and the
// alignment — the `{ align=left width="300" }` attributes of the Material
// reference. Clicking an image in the document opens the same form.
// ---------------------------------------------------------------------------

const ALIGNMENTS: Array<{ value: string; label: string }> = [
  { value: "", label: t("Default") },
  { value: "left", label: t("Left") },
  { value: "right", label: t("Right") },
];

/** The color scheme an image is meant for, the empty string meaning “both”. */
export type ImageTheme = "" | "light" | "dark";

/**
 * The anchors Material reads to hide one image of a pair: its own and the
 * GitHub one, which its stylesheet honours as well.
 */
const THEME_ANCHORS: ReadonlyArray<{ anchor: string; theme: Exclude<ImageTheme, ""> }> = [
  { anchor: "#only-light", theme: "light" },
  { anchor: "#only-dark", theme: "dark" },
  { anchor: "#gh-light-mode-only", theme: "light" },
  { anchor: "#gh-dark-mode-only", theme: "dark" },
];

/** Splits `logo.png#only-dark` into the file and the scheme it is addressed at. */
export function splitImageTheme(src: string): {
  path: string;
  theme: ImageTheme;
  anchor: string;
} {
  const lower = src.toLowerCase();
  for (const { anchor, theme } of THEME_ANCHORS) {
    if (lower.endsWith(anchor)) {
      return { path: src.slice(0, -anchor.length), theme, anchor: src.slice(-anchor.length) };
    }
  }
  return { path: src, theme: "", anchor: "" };
}

/**
 * Puts the scheme back into the address. An image already written in the GitHub
 * spelling keeps it while its scheme is unchanged — opening the form is not a
 * reason to rewrite a line the author chose.
 */
export function imageSrcForTheme(path: string, theme: ImageTheme, previous = ""): string {
  if (theme === "") {
    return path;
  }
  const before = splitImageTheme(previous);
  if (before.theme === theme) {
    return path + before.anchor;
  }
  return path + (theme === "light" ? "#only-light" : "#only-dark");
}

const IMAGE_THEMES: Array<{ value: ImageTheme; label: string }> = [
  { value: "", label: t("Both themes") },
  { value: "light", label: t("Light theme only") },
  { value: "dark", label: t("Dark theme only") },
];

export function openImagePopup(existing?: HTMLImageElement): void {
  if (!existing) {
    saveSelection();
  }
  const pop = existing ? popupAtElement(existing) : popupAtSelection();
  pop.classList.add("vimg");
  const form = document.createElement("form");

  const head = document.createElement("div");
  head.className = "vpop-title";
  head.textContent = existing ? t("Image") : t("Insert image");
  form.appendChild(head);

  const srcLabel = document.createElement("label");
  srcLabel.textContent = t("Path or URL");
  const srcRow = document.createElement("div");
  srcRow.className = "vimg-src";
  const src = document.createElement("input");
  src.type = "text";
  // The address in src goes through the webview; the field shows (and the file
  // receives) the path as the author wrote it — data-md-src.
  const existingSrc = existing?.getAttribute("data-md-src") ?? existing?.getAttribute("src") ?? "";
  // The scheme lives in the anchor of the address; the field shows the file and
  // the select below shows the scheme, so neither has to be typed by hand.
  const existingImage = splitImageTheme(existingSrc);
  src.value = existingImage.path;
  src.placeholder = "images/pic.png";
  const browse = document.createElement("button");
  browse.type = "button";
  browse.className = "secondary";
  browse.textContent = t("Choose file…");
  // What the dialog answered: the path for the file, the address for the screen.
  // Kept aside so the preview and the inserted picture both have something the
  // webview can actually load.
  let picked: PickedFile | null = null;
  browse.addEventListener("click", () => {
    void pickFile("image").then((answer) => {
      if (answer.rel) {
        picked = answer;
        src.value = answer.rel;
        refreshPreview();
      }
    });
  });
  srcRow.append(src, browse);
  srcLabel.appendChild(srcRow);
  form.appendChild(srcLabel);

  const altLabel = document.createElement("label");
  altLabel.textContent = t("Description (alt)");
  const alt = document.createElement("input");
  alt.type = "text";
  alt.value = existing?.getAttribute("alt") ?? "";
  alt.placeholder = t("Diagram");
  altLabel.appendChild(alt);
  form.appendChild(altLabel);

  const row2 = document.createElement("div");
  row2.className = "vimg-row";
  const widthLabel = document.createElement("label");
  widthLabel.textContent = t("Width");
  const width = document.createElement("input");
  width.type = "text";
  width.value = existing?.getAttribute("width") ?? "";
  width.placeholder = "300";
  widthLabel.appendChild(width);
  const heightLabel = document.createElement("label");
  heightLabel.textContent = t("Height");
  const height = document.createElement("input");
  height.type = "text";
  height.value = existing?.getAttribute("height") ?? "";
  height.placeholder = "150";
  heightLabel.appendChild(height);
  const alignLabel = document.createElement("label");
  alignLabel.textContent = t("Alignment");
  const align = document.createElement("select");
  for (const a of ALIGNMENTS) {
    const o = document.createElement("option");
    o.value = a.value;
    o.textContent = a.label;
    align.appendChild(o);
  }
  align.value = existing?.getAttribute("align") ?? "";
  alignLabel.appendChild(align);
  row2.append(widthLabel, heightLabel, alignLabel);
  form.appendChild(row2);

  const themeLabel = document.createElement("label");
  themeLabel.textContent = t("Shown in");
  const theme = document.createElement("select");
  for (const item of IMAGE_THEMES) {
    const o = document.createElement("option");
    o.value = item.value;
    o.textContent = item.label;
    theme.appendChild(o);
  }
  theme.value = existingImage.theme;
  themeLabel.appendChild(theme);
  form.appendChild(themeLabel);

  const preview = document.createElement("div");
  preview.className = "vimg-preview";
  const thumb = document.createElement("img");
  preview.appendChild(thumb);
  form.appendChild(preview);
  /**
   * An address this webview can load for the file the field names. A relative
   * path resolves against the webview's own base and simply 404s, so what goes
   * on screen comes from the picture being edited or from the dialog's answer;
   * a path typed by hand is tried as it is and the box hides if it fails.
   *
   * Never with the anchor: Material's stylesheet hides `#only-dark` in the light
   * scheme, which would blank the very picture the author is looking at.
   */
  function loadableSrc(value: string): string {
    if (picked && value === picked.rel && picked.webUri) {
      return picked.webUri;
    }
    if (existing && value === existingImage.path) {
      return splitImageTheme(existing.getAttribute("src") ?? "").path;
    }
    return value;
  }

  function refreshPreview(): void {
    const value = src.value.trim();
    thumb.src = loadableSrc(value);
    preview.classList.toggle("empty", value === "");
  }
  thumb.addEventListener("error", () => preview.classList.add("empty"));
  thumb.addEventListener("load", () => preview.classList.remove("empty"));
  src.addEventListener("change", refreshPreview);
  refreshPreview();

  const actions = document.createElement("div");
  actions.className = "row";
  if (existing) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = t("Delete");
    remove.addEventListener("click", () => {
      const block = host.topBlockOf(existing);
      closePopup();
      existing.remove();
      if (block) {
        dirty.add(block);
        scheduleSync(80);
      }
    });
    actions.appendChild(remove);
  }
  const grow = document.createElement("span");
  grow.className = "grow";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = existing ? t("Save") : t("Insert");
  actions.append(grow, cancel, ok);
  form.appendChild(actions);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = src.value.trim();
    if (!value) {
      return;
    }
    closePopup();
    const img = existing ?? document.createElement("img");
    const address = imageSrcForTheme(value, theme.value as ImageTheme, existingSrc);
    // Two addresses, as everywhere else: one the webview can display, one the
    // file gets. Writing the author's path into src blanked the picture until
    // the next full render — the block under the caret is not repatched.
    img.setAttribute("src", loadableSrc(value) + splitImageTheme(address).anchor);
    img.setAttribute("data-md-src", address);
    img.setAttribute("alt", alt.value);
    setOrRemove(img, "width", width.value.trim());
    setOrRemove(img, "height", height.value.trim());
    setOrRemove(img, "align", align.value);
    if (existing) {
      markDirty(img);
    } else {
      restoreSelection();
      insertInline(img);
    }
  });
  pop.appendChild(form);
  src.focus();
}

function setOrRemove(el: Element, name: string, value: string): void {
  if (value) {
    el.setAttribute(name, value);
  } else {
    el.removeAttribute(name);
  }
}

// The “Choose file…” answer arrives as a message — the request is matched to it
// by token, the same way saved images are. An empty path means the dialog was
// dismissed.
let pickAwaitToken: number | null = null;
let pickResolve: ((picked: PickedFile) => void) | null = null;

/** The chosen file: the path for the document, the address for the screen. */
export interface PickedFile {
  rel: string;
  webUri: string;
}

export function pickFile(kind: "image" | "snippet"): Promise<PickedFile> {
  return new Promise((resolve) => {
    pickAwaitToken = ++imageTokenSeq;
    pickResolve = resolve;
    host.post({ type: "pickFile", kind, token: pickAwaitToken });
  });
}

export function onFilePicked(token: number, relPath: string, webUri = ""): void {
  if (token !== pickAwaitToken) {
    return;
  }
  pickAwaitToken = null;
  const resolve = pickResolve;
  pickResolve = null;
  resolve?.({ rel: relPath, webUri });
}

// --- formula ---

/** Inserting a formula: inline at the cursor, or as a separate `$$` block. */
export function openMathPopup(): void {
  saveSelection();
  const point = host.insertPoint();
  openMathDialog({
    title: t("Formula"),
    tex: "",
    block: false,
    modeSwitch: true,
    okLabel: t("Insert"),
    onSave: (tex, block) => {
      if (block) {
        host.insertMarkdownBlock("$$\n" + tex + "\n$$", point);
        return;
      }
      restoreSelection();
      const span = document.createElement("span");
      span.className = "arithmatex";
      span.setAttribute("data-tex", tex);
      span.textContent = `$${tex}$`;
      insertInline(span);
    },
  });
}

/** Editing an inline formula: only data-tex matters, the render is refreshed by the sync. */
export function openInlineMathEdit(el: HTMLElement): void {
  openMathDialog({
    title: t("Formula"),
    tex: el.getAttribute("data-tex") ?? "",
    block: false,
    okLabel: t("Save"),
    anchor: el,
    danger: {
      label: t("Delete"),
      onClick: () => {
        const block = host.topBlockOf(el);
        el.remove();
        if (block) {
          dirty.add(block);
          scheduleSync(80);
        }
      },
    },
    onSave: (tex) => {
      el.setAttribute("data-tex", tex);
      // A placeholder until the sync brings back the rendered formula.
      el.textContent = `$${tex}$`;
      markDirty(el);
    },
  });
}

export function insertInline(el: Element): void {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || !host.docEl.contains(sel.anchorNode)) {
    // There is no cursor — go to the end of the last editable paragraph.
    host.ensureTrailingDraft();
    const last = host.docEl.lastElementChild;
    dropPlaceholderBreak(last);
    last?.appendChild(el);
  } else {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    // An empty line holds a lone <br>; next to the inserted element it would be
    // written out as a hard break — two trailing spaces in the file.
    dropPlaceholderBreak(range.startContainer);
    range.insertNode(el);
    const after = document.createRange();
    after.setStartAfter(el);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  markDirty(el);
  // What went in is a stand-in — the <kbd>s, the formula, the footnote number
  // are drawn by the engine. Ask the answer to this edit to bring the real one.
  noteInlineIsland(el);
}

// --- image: pasting/dragging with automatic saving to a file ---
// An image from the clipboard or dragged with the mouse is read as base64 and sent to
// the extension; it saves the file into a configurable folder and returns a
// relative link, which is inserted as an <img> at the cursor/drop position.

interface PendingImage {
  data: string;
  mime: string;
  name: string;
}
const imageQueue: PendingImage[] = [];
let imageInsertRange: Range | null = null;
let imageAwaitToken: number | null = null;
let imageTokenSeq = 0;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result ?? "");
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res); // strip the data:...;base64, prefix
    };
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** A clone of the current cursor range, if it is inside the editable document. */
function currentCaretRange(): Range | null {
  const sel = document.getSelection();
  if (sel && sel.rangeCount > 0 && host.docEl.contains(sel.anchorNode)) {
    return sel.getRangeAt(0).cloneRange();
  }
  return null;
}

/** A range from coordinates (for a drop) — with a fallback to caretPositionFromPoint. */
function caretRangeFromPoint(x: number, y: number): Range | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r && host.docEl.contains(r.startContainer) ? r : null;
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p && host.docEl.contains(p.offsetNode)) {
      const r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
      return r;
    }
  }
  return null;
}

async function handleImageFiles(files: File[], range: Range | null): Promise<void> {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) {
    return;
  }
  imageInsertRange = range ?? currentCaretRange();
  st.set(images.length > 1 ? t("Saving images ({0})…", images.length) : t("Saving the image…"));
  for (const f of images) {
    try {
      imageQueue.push({ data: await fileToBase64(f), mime: f.type, name: f.name });
    } catch {
      // an unreadable file — skip it
    }
  }
  pumpImageQueue();
}

/** Sends the next image from the queue (one at a time — to preserve the order). */
function pumpImageQueue(): void {
  if (imageAwaitToken !== null) {
    return; // waiting for the response to the previous one
  }
  const next = imageQueue.shift();
  if (!next) {
    st.set(t("Ready"));
    return;
  }
  imageAwaitToken = ++imageTokenSeq;
  host.post({
    type: "saveImage",
    token: imageAwaitToken,
    data: next.data,
    mime: next.mime,
    name: next.name,
  });
}

export function onImageSaved(token: number, relPath: string, webUri = ""): void {
  if (token !== imageAwaitToken) {
    return;
  }
  imageAwaitToken = null;
  insertImageAtRange(relPath, webUri);
  pumpImageQueue();
}

export function onImageSaveFailed(token: number, _error: string): void {
  if (token !== imageAwaitToken) {
    return;
  }
  imageAwaitToken = null;
  st.set(t("Could not save the image"));
  pumpImageQueue();
}

function insertImageAtRange(relPath: string, webUri: string): void {
  const img = document.createElement("img");
  // The pair a render produces (see rewriteHtmlAssetUrls): src is an address
  // this webview may load, data-md-src the path that goes into the file. Putting
  // the relative path into src left an empty frame — the webview cannot resolve
  // it, and a catch-up patch does not replace the block the caret sits in, so
  // the picture only appeared once something redrew the whole page.
  img.setAttribute("src", webUri || relPath);
  img.setAttribute("data-md-src", relPath);
  img.setAttribute("alt", "");
  const range = imageInsertRange;
  if (range && host.docEl.contains(range.startContainer)) {
    range.collapse(false);
    range.insertNode(img);
    const after = document.createRange();
    after.setStartAfter(img);
    after.collapse(true);
    imageInsertRange = after; // the next image will land after this one
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
  } else {
    host.ensureTrailingDraft();
    host.docEl.lastElementChild?.appendChild(img);
    imageInsertRange = null;
  }
  markDirty(img);
}

function imageFilesFromClipboard(items: DataTransferItemList | undefined): File[] {
  const files: File[] = [];
  for (const it of Array.from(items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) {
        files.push(f);
      }
    }
  }
  return files;
}
