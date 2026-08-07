// Runtime of the lightweight preview webview.
// Handles messages from the extension, applies the palette, renders the
// content, loads mermaid on demand and provides scroll sync / clicks.

import { decorateCodeNav } from "../shared/codeNav";
import { t } from "../shared/i18n";
import { initReadOnlyMenu } from "./contextMenu";
import {
  applyExtraCss,
  initMermaid,
  renderMermaid,
  reRenderMermaidTheme,
  watchMermaidReveal,
} from "../shared/mermaid";
import {
  applyBackground,
  applyPalette,
  effectiveScheme,
  initScheme,
  toggleTheme,
  type PaletteMsg,
} from "../shared/scheme";
import {
  renderSiteHeader,
  renderSiteNav,
  type SiteChromeData,
  type SiteChromeHooks,
} from "../shared/siteChrome";

interface PreviewConfig {
  mermaidUri: string;
  nonce: string;
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState?: () => { theme?: string | null } | undefined;
  setState?: (state: unknown) => void;
}
declare function acquireVsCodeApi(): VsCodeApi;
declare const window: Window & {
  __mkdocsPreview?: PreviewConfig;
};

const vscodeApi = acquireVsCodeApi();
const config = window.__mkdocsPreview ?? { mermaidUri: "", nonce: "" };
initMermaid(config);

// The page is read-only, so the stock webview menu (Cut, Copy, Paste) is
// replaced with a Copy-only one.
initReadOnlyMenu({ copySelection: () => document.execCommand("copy") });

const pane = document.getElementById("pane") as HTMLElement;
const content = document.getElementById("content") as HTMLElement;
// A diagram in an unopened tab or a folded call-out waits for the reveal.
watchMermaidReveal(content);
const overlay = document.getElementById("overlay") as HTMLElement;
const siteHead = document.getElementById("siteHead") as HTMLElement;
const siteNav = document.getElementById("siteNav") as HTMLElement;
const btnConfig = document.getElementById("btnConfig") as HTMLButtonElement | null;
const btnHead = document.getElementById("btnHead") as HTMLButtonElement;
const btnNav = document.getElementById("btnNav") as HTMLButtonElement;
const btnToc = document.getElementById("btnToc") as HTMLButtonElement;
const btnTheme = document.getElementById("btnTheme") as HTMLButtonElement | null;
const pageToc = document.getElementById("pageToc") as HTMLElement;

btnConfig?.addEventListener("click", () => vscodeApi.postMessage({ type: "openConfig" }));
btnHead?.addEventListener("click", () =>
  vscodeApi.postMessage({ type: "setChrome", header: !btnHead.classList.contains("on") }),
);
btnNav?.addEventListener("click", () =>
  vscodeApi.postMessage({ type: "setChrome", nav: !btnNav.classList.contains("on") }),
);
btnToc?.addEventListener("click", () =>
  vscodeApi.postMessage({ type: "setChrome", toc: !btnToc.classList.contains("on") }),
);
btnTheme?.addEventListener("click", () => toggleTheme());

// Opening a block is bound to a DOUBLE click on purpose: the preview is a place
// to read, and a single click has to remain a single click — selecting text,
// following a link, putting the caret nowhere. Delegation solves the nesting
// problem: a click on text inside an admonition resolves to the block itself;
// a typed block (admonition/code) opens its parameters form, any other block
// with data-src-line just reveals its source line.
content.addEventListener("dblclick", (e) => {
  const from = e.target as HTMLElement;
  const el =
    (from.closest("[data-block-type]") as HTMLElement | null) ??
    (from.closest("[data-src-line]") as HTMLElement | null);
  if (!el) {
    return;
  }
  const line = Number(el.getAttribute("data-src-line"));
  const endAttr = el.getAttribute("data-src-end");
  const endLine = endAttr ? Number(endAttr) : line;
  const blockType = el.getAttribute("data-block-type") ?? undefined;
  vscodeApi.postMessage({ type: "blockClick", line, endLine, blockType });
});

// Following links: reading a site includes moving to the next page, and inside
// the preview a plain <a href="setup.md"> leads nowhere — the webview cannot
// navigate to a file. So every click is intercepted: an anchor scrolls the page
// here, everything else goes to the extension, which knows where the document
// lies and what `setup.md`, `setup/` or `../setup` stand for.
content.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
    return;
  }
  const a = (e.target as HTMLElement).closest?.("a") as HTMLAnchorElement | null;
  const href = a?.getAttribute("href") ?? "";
  if (href === "") {
    return;
  }
  e.preventDefault();
  if (href.startsWith("#")) {
    // markdown-it-anchor wraps the WHOLE heading in a link to itself: scrolling
    // there would yank the page on the way to a double click on the heading.
    if (!a?.classList.contains("header-anchor")) {
      revealAnchor(href.slice(1));
    }
    return;
  }
  vscodeApi.postMessage({ type: "openDocLink", href });
});

/** Scrolls to a heading (or a footnote) by its id, the way a `#section` link would. */
function revealAnchor(hash: string): void {
  if (hash === "") {
    return;
  }
  let target: HTMLElement | null = null;
  for (const id of [hash, decodeSafe(hash)]) {
    target = content.querySelector<HTMLElement>(`#${cssEscape(id)}, [name="${cssEscape(id)}"]`);
    if (target) {
      break;
    }
  }
  if (!target) {
    return;
  }
  suppressScroll = true;
  content.scrollTop = target.offsetTop - content.offsetTop;
  setTimeout(() => (suppressScroll = false), 120);
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** CSS.escape is there in the webview, but the harness runs older engines too. */
function cssEscape(value: string): string {
  const escape = (window as unknown as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  return escape ? escape(value) : value.replace(/["\\\]]/g, "\\$&");
}

let suppressScroll = false;
/** When the reader last scrolled the preview themselves. */
let userScrolledAt = 0;
/** How long after that we refuse the counter-sync from the editor. */
const USER_SCROLL_HOLD_MS = 400;
/** Smaller than this we do not move: a jump visible to the eye with no benefit. */
const SCROLL_EPSILON_PX = 8;

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type: string; [k: string]: unknown };
  switch (msg.type) {
    case "overlay":
      if (msg.kind === "none") {
        hideOverlay();
      } else {
        showOverlay(String(msg.kind), msg.text as string);
      }
      break;
    case "render":
      pane.style.display = "flex";
      applyBackground(String(msg.background ?? "material"));
      applyPalette(msg.palette as PaletteMsg | undefined);
      renderContent(String(msg.html), String(msg.docId ?? ""));
      break;
    case "extraCss":
      applyExtraCss(String(msg.css ?? ""), "extraCss");
      break;
    case "siteChrome":
      chromeData = msg.data as SiteChromeData;
      refreshChrome();
      break;
    case "siteActive":
      activePage = typeof msg.active === "string" ? msg.active : undefined;
      refreshChrome();
      break;
    case "chromeState":
      showHead = msg.header === true;
      showNav = msg.nav === true;
      showToc = msg.toc === true;
      refreshChrome();
      break;
    case "scrollTo":
      scrollToSourceLine(Number(msg.line));
      break;
    case "revealAnchor":
      // A link with a `#section`: the page has just been replaced, so the scroll
      // waits for the new content to be laid out.
      requestAnimationFrame(() => revealAnchor(String(msg.hash ?? "")));
      break;
  }
});

// --- site header and left navigation panel (the “Header” and “Navigation” buttons) ---

let chromeData: SiteChromeData | undefined;
let activePage: string | undefined;
let showHead = false;
let showNav = false;
let showToc = false;

const chromeHooks: SiteChromeHooks = {
  openPage: (path) => vscodeApi.postMessage({ type: "openPage", path }),
  openLink: (href) => vscodeApi.postMessage({ type: "openLink", href }),
};

/** Redraws the header and the panels for the current button state and data. */
function refreshChrome(): void {
  document.body.classList.toggle("mv-show-head", showHead);
  document.body.classList.toggle("mv-show-nav", showNav);
  document.body.classList.toggle("mv-show-toc", showToc);
  btnHead?.classList.toggle("on", showHead);
  btnNav?.classList.toggle("on", showNav);
  btnToc?.classList.toggle("on", showToc);
  // Draw only what is visible: rebuilding the page tree is not free.
  if (showHead) {
    renderSiteHeader(siteHead, chromeData, activePage, chromeHooks);
  } else {
    siteHead.textContent = "";
  }
  if (showNav) {
    renderSiteNav(siteNav, chromeData, activePage, chromeHooks);
  } else {
    siteNav.textContent = "";
  }
  if (showToc) {
    refreshToc();
  } else {
    pageToc.textContent = "";
    tocEntries = [];
  }
}

// --- “On this page”: headings of the rendered page ---

interface TocEntry {
  heading: HTMLElement;
  item: HTMLElement;
}
let tocEntries: TocEntry[] = [];
let tocActive: HTMLElement | null = null;

/** Rebuilds the table of contents from the headings of the rendered page. */
function refreshToc(): void {
  if (!showToc) {
    return;
  }
  pageToc.textContent = "";
  tocEntries = [];
  tocActive = null;

  const headings = Array.from(
    content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  ).filter((h) => (h.textContent ?? "").trim() !== "");
  const head = document.createElement("div");
  head.className = "mvt-head";
  head.textContent = t("On this page");
  pageToc.appendChild(head);

  if (headings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mvt-empty";
    empty.textContent = t("No headings");
    pageToc.appendChild(empty);
    return;
  }

  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));
    const item = document.createElement("button");
    item.className = `mvt-item mvt-l${level}`;
    // The “¶” permalink Material adds must not end up in the title. The engine's
    // own anchor is a different beast: markdown-it-anchor wraps the WHOLE heading
    // text in <a class="header-anchor">, so removing it would leave a blank item.
    const label = heading.cloneNode(true) as HTMLElement;
    label.querySelectorAll("a.headerlink").forEach((a) => a.remove());
    item.textContent = (label.textContent ?? "").trim();
    item.title = item.textContent;
    item.addEventListener("click", () => {
      suppressScroll = true;
      content.scrollTop = heading.offsetTop - content.offsetTop;
      setTimeout(() => (suppressScroll = false), 120);
      highlightToc(item);
    });
    pageToc.appendChild(item);
    tocEntries.push({ heading, item });
  }
  syncTocToScroll();
}

/** Marks the section that is currently on screen — scrollspy, as on the site. */
function syncTocToScroll(): void {
  if (tocEntries.length === 0) {
    return;
  }
  const top = content.scrollTop + 8;
  let current = tocEntries[0].item;
  for (const entry of tocEntries) {
    if (entry.heading.offsetTop - content.offsetTop <= top) {
      current = entry.item;
    } else {
      break;
    }
  }
  highlightToc(current);
}

function highlightToc(item: HTMLElement): void {
  if (tocActive === item) {
    return;
  }
  tocActive?.classList.remove("on");
  item.classList.add("on");
  // Keep the active item in view — but scroll the panel only, never the page.
  const view = pageToc.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  if (rect.top < view.top) {
    pageToc.scrollTop -= view.top - rect.top;
  } else if (rect.bottom > view.bottom) {
    pageToc.scrollTop += rect.bottom - view.bottom;
  }
  tocActive = item;
}

function syncThemeButton(): void {
  if (!btnTheme) {
    return;
  }
  const dark = effectiveScheme() === "slate";
  btnTheme.classList.toggle("on", dark);
  btnTheme.title = dark ? t("Dark theme — switch to light") : t("Light theme — switch to dark");
}

// The scheme, the palette and the page background live in shared/scheme.ts —
// the preview only says which button to sync and what to do once it changes.
initScheme(
  {
    afterApply: syncThemeButton,
    onSchemeChange: () => void reRenderMermaidTheme(content),
    persist: (override) => {
      const prev = vscodeApi.getState?.() ?? {};
      vscodeApi.setState?.({ ...prev, theme: override });
    },
  },
  vscodeApi.getState?.()?.theme,
);

/** The document currently shown — to tell a redraw from a navigation. */
let shownDocId = "";

function renderContent(html: string, docId: string): void {
  // Live updates while typing replace the whole markup, and scrollTop is lost
  // with it: the reader was thrown to the top of the page mid-reading.
  const keepScroll = docId !== "" && docId === shownDocId ? content.scrollTop : 0;
  shownDocId = docId;
  content.innerHTML = html;
  decorateAnnotations();
  decorateCodeButtons();
  refreshToc();
  // Always set it: for the same page this restores the previous position, for a
  // new one it is zero (the browser does not reset scrollTop itself if the
  // height happens to match).
  suppressScroll = true;
  content.scrollTop = keepScroll;
  setTimeout(() => (suppressScroll = false), 120);
  void renderMermaid(content);
}

/** Copy button on every code block — as in Material (content.code.copy). */
function decorateCodeButtons(): void {
  for (const block of Array.from(content.querySelectorAll<HTMLElement>("div.highlight"))) {
    if (block.classList.contains("mermaid")) {
      continue;
    }
    decorateCodeNav(block, {
      codeText: (el) =>
        (el.querySelector(":scope > pre > code")?.textContent ?? "").replace(/\n$/, ""),
    });
  }
}

// --- pymdownx annotations (Material): (N) markers with pop-up explanations ---

function decorateAnnotations(): void {
  hideAnnotationTip();
  for (const host of Array.from(content.querySelectorAll<HTMLElement>(".annotate"))) {
    const list = annotationSource(host);
    if (!list) {
      continue;
    }
    const items = Array.from(list.children).filter((c) => c.tagName === "LI");
    const used = markAnnotationRefs(host, list, items);
    if (used > 0) {
      list.classList.add("annotation-list");
    }
  }
  decorateCodeAnnotations();
}

/** Annotations in code: `# (1)!` in a comment + the list right after the block. */
function decorateCodeAnnotations(): void {
  for (const block of Array.from(content.querySelectorAll<HTMLElement>("div.highlight"))) {
    const next = block.nextElementSibling;
    if (!next || next.tagName !== "OL" || !/\(\d+\)!/.test(block.textContent ?? "")) {
      continue;
    }
    const items = Array.from(next.children).filter((c) => c.tagName === "LI");
    let used = 0;
    // Highlighted comments: the marker replaces the whole comment (as in Material).
    for (const comment of Array.from(block.querySelectorAll<HTMLElement>(".hljs-comment"))) {
      const m = /\((\d+)\)!/.exec(comment.textContent ?? "");
      const item = m ? items[Number(m[1]) - 1] : undefined;
      if (!m || !item) {
        continue;
      }
      comment.textContent = "";
      comment.appendChild(annotationMarker(Number(m[1]), item as HTMLElement));
      used++;
    }
    // Monochrome mode (linenums/hl_lines): replace the trailing `# (N)!` in the text.
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (
        /\(\d+\)!/.test((n as Text).data) &&
        !(n as Text).parentElement?.closest(".hljs-comment")
      ) {
        nodes.push(n as Text);
      }
    }
    for (const node of nodes) {
      const m = /(?:#|\/\/|;|--|<!--)?\s*\((\d+)\)!(?:\s*-->)?\s*$/.exec(
        node.data.replace(/\n$/, ""),
      );
      const item = m ? items[Number(m[1]) - 1] : undefined;
      if (!m || !item) {
        continue;
      }
      const keepNL = node.data.endsWith("\n") ? "\n" : "";
      const head = node.data.replace(/\n$/, "").slice(0, m.index).replace(/\s+$/, " ");
      node.data = head;
      const marker = annotationMarker(Number(m[1]), item as HTMLElement);
      node.after(marker, document.createTextNode(keepNL));
      used++;
    }
    if (used > 0) {
      next.classList.add("annotation-list");
    }
  }
}

function annotationMarker(idx: number, item: HTMLElement): HTMLElement {
  const marker = document.createElement("span");
  // The circle shows a “+” (drawn in CSS), not the number — Material's site
  // renders annotations that way, and the preview follows the site.
  marker.className = "md-annotation";
  marker.setAttribute("data-annotation-index", String(idx));
  marker.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAnnotationTip(marker, item);
  });
  return marker;
}

/** The explanation list: the sibling ol after a simple block, the last direct ol of a container. */
function annotationSource(host: HTMLElement): HTMLElement | null {
  if (/^(P|UL|OL|BLOCKQUOTE|TABLE|H\d)$/.test(host.tagName)) {
    const next = host.nextElementSibling;
    return next && next.tagName === "OL" ? (next as HTMLElement) : null;
  }
  for (let c = host.lastElementChild; c; c = c.previousElementSibling) {
    if (c.tagName === "OL") {
      return c as HTMLElement;
    }
  }
  return null;
}

/** Replaces textual `(N)` with circle markers; returns the number of replacements. */
function markAnnotationRefs(host: HTMLElement, list: HTMLElement, items: Element[]): number {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = (n as Text).parentElement;
    if (!el || list.contains(n) || el.closest("pre, code")) {
      continue;
    }
    if (/\((\d+)\)/.test((n as Text).data)) {
      targets.push(n as Text);
    }
  }
  let used = 0;
  for (const node of targets) {
    const frag = document.createDocumentFragment();
    let rest = node.data;
    let m: RegExpExecArray | null;
    while ((m = /\((\d+)\)/.exec(rest)) !== null) {
      const idx = Number(m[1]);
      const item = items[idx - 1];
      if (!item) {
        break;
      }
      frag.appendChild(document.createTextNode(rest.slice(0, m.index)));
      frag.appendChild(annotationMarker(idx, item as HTMLElement));
      used++;
      rest = rest.slice(m.index + m[0].length);
    }
    if (frag.childNodes.length > 0) {
      frag.appendChild(document.createTextNode(rest));
      node.replaceWith(frag);
    }
  }
  return used;
}

let annotipFor: Element | null = null;

function toggleAnnotationTip(marker: HTMLElement, item: HTMLElement): void {
  if (annotipFor === marker) {
    hideAnnotationTip();
    return;
  }
  showAnnotationTip(marker, item);
}

function showAnnotationTip(marker: HTMLElement, item: HTMLElement): void {
  if (annotipFor === marker) {
    return;
  }
  hideAnnotationTip();
  let tip = document.getElementById("annotip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "annotip";
    document.body.appendChild(tip);
  }
  tip.innerHTML = item.innerHTML;
  tip.classList.add("show");
  const rect = marker.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 340)) + "px";
  tip.style.top = rect.bottom + 6 + "px";
  annotipFor = marker;
  marker.classList.add("on"); // the “+” turns into an “×” while the tip is open
}

function hideAnnotationTip(): void {
  document.getElementById("annotip")?.classList.remove("show");
  annotipFor?.classList.remove("on");
  annotipFor = null;
}

document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest?.(".md-annotation, #annotip")) {
    hideAnnotationTip();
  }
});

// Footnote tooltips (the Material content.footnote.tooltips feature): hovering
// the [1] marker shows the footnote text without jumping to the end of the page.
content.addEventListener("mouseover", (e) => {
  const host = (e.target as HTMLElement).closest?.(".footnote-ref") as HTMLElement | null;
  if (!host) {
    return;
  }
  // The marker is <sup class="footnote-ref"><a href="#fn…">, the link may also be the host itself.
  const ref = (host.tagName === "A" ? host : host.querySelector("a")) as HTMLElement | null;
  if (!ref) {
    return;
  }
  const id = ref.getAttribute("href")?.replace(/^#/, "");
  const item = id ? document.getElementById(id) : null;
  if (item) {
    const copy = item.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".footnote-backref").forEach((a) => a.remove());
    showAnnotationTip(ref, copy);
  }
});
content.addEventListener("mouseout", (e) => {
  if ((e.target as HTMLElement).closest?.(".footnote-ref")) {
    hideAnnotationTip();
  }
});

// --- scroll sync preview → editor ---
// The message is sent not on every scroll event but once per frame: otherwise a
// single gesture sends dozens of messages, the editor jitters, and its reply
// sync pulls the preview back.
let scrollFrame = 0;
content.addEventListener("scroll", () => {
  userScrolledAt = suppressScroll ? userScrolledAt : Date.now();
  // The table of contents is highlighted synchronously: it is a cheap loop, and
  // tying it to requestAnimationFrame would freeze it whenever the tab is in the
  // background — the browser stops delivering frames there, and the pending
  // callback keeps the throttle flag raised.
  syncTocToScroll();
  if (suppressScroll || scrollFrame !== 0) {
    return;
  }
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const line = topVisibleSourceLine();
    if (line >= 0) {
      vscodeApi.postMessage({ type: "reveal", line });
    }
  });
});

function topVisibleSourceLine(): number {
  const els = content.querySelectorAll<HTMLElement>("[data-src-line]");
  const top = content.scrollTop;
  let best = -1;
  for (const el of Array.from(els)) {
    if (el.offsetTop - content.offsetTop <= top + 4) {
      best = Number(el.getAttribute("data-src-line"));
    } else {
      break;
    }
  }
  return best;
}

function scrollToSourceLine(line: number): void {
  // While the reader scrolls the preview themselves, the counter-sync only gets
  // in the way: it aligns the view to the start of the block, i.e. throws them back.
  if (Date.now() - userScrolledAt < USER_SCROLL_HOLD_MS) {
    return;
  }
  const els = content.querySelectorAll<HTMLElement>("[data-src-line]");
  let target: HTMLElement | undefined;
  for (const el of Array.from(els)) {
    if (Number(el.getAttribute("data-src-line")) <= line) {
      target = el;
    } else {
      break;
    }
  }
  if (!target) {
    return;
  }
  const top = target.offsetTop - content.offsetTop;
  if (Math.abs(top - content.scrollTop) < SCROLL_EPSILON_PX) {
    return; // already there — a needless jump of a couple of pixels is only noticeable
  }
  suppressScroll = true;
  content.scrollTop = top;
  setTimeout(() => (suppressScroll = false), 120);
}

// --- overlay ---
function showOverlay(kind: string, text?: string): void {
  overlay.className = "show " + kind;
  const isError = kind === "error";
  overlay.innerHTML =
    '<div class="box"><span>' +
    escapeHtml(text ?? "") +
    "</span>" +
    (isError && text ? "<pre>" + escapeHtml(text) + "</pre>" : "") +
    "</div>";
}
function hideOverlay(): void {
  overlay.className = "";
}
function escapeHtml(s: string): string {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

vscodeApi.postMessage({ type: "ready" });
