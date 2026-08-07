// Sanitizing of HTML pasted from the clipboard (browser, office editors, Google Docs).
//
// Why: the browser puts markup on the clipboard together with the styling of
// the source page — inline styles (`color`, `font-family`), service nodes and
// classes. Pasted as is, such a fragment looks alien (text in the site's dark
// theme color is barely visible on a light background) and drags junk into
// Markdown: the “¶” anchor of a Material page serializes into a link, and the
// `{ #id }` inside it into a duplicate anchor.
//
// What we keep: the structure the paste was made for — headings, lists, tables,
// code, links, images and inline emphasis. Everything else is unwrapped into
// text, attributes are stripped.

/** Tags the visual editor's serializer can turn into Markdown. */
const KEEP_TAGS = new Set([
  "P",
  "BR",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "DL",
  "DT",
  "DD",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "DEL",
  "MARK",
  "SUP",
  "SUB",
  "CODE",
  "PRE",
  "A",
  "IMG",
  "BLOCKQUOTE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "DETAILS",
  "SUMMARY", // collapsible admonition `???`
  "INPUT", // task list checkbox
]);

/**
 * Classes by which the serializer recognizes a Material block. They are kept
 * together with the carrying `div`/`details`: otherwise copying an admonition
 * or tabs inside the editor itself (and from a Material page) would collapse
 * the block into flat text. Admonition types (`note`, `tip`, …) survive as
 * siblings of `admonition`.
 */
const KEEP_CLASSES = new Set([
  "admonition",
  "admonition-title",
  "adm-body",
  "highlight",
  "filename",
  "linenums",
  // Per-line markup of a visual editor code block: `<span class="cl">` contains no
  // “\n” (the line break is drawn by CSS), so without the class the lines would
  // be glued into one.
  "cl",
  "hll",
  "tabbed-set",
  "tabbed-labels",
  "tabbed-content",
  "tabbed-block",
  "arithmatex",
  "mermaid",
  "mkdocstrings",
  "grid",
  "card",
  "task-list-item",
  "task-list-item-checkbox",
  "contains-task-list",
]);

/** Material admonition types — meaningful only next to the `admonition` class. */
const ADMONITION_TYPES = new Set([
  "note",
  "abstract",
  "summary",
  "tldr",
  "info",
  "todo",
  "tip",
  "hint",
  "important",
  "success",
  "check",
  "done",
  "question",
  "help",
  "faq",
  "warning",
  "caution",
  "attention",
  "failure",
  "fail",
  "missing",
  "danger",
  "error",
  "bug",
  "example",
  "snippet",
  "quote",
  "cite",
  "inline",
  "end",
  "left",
  "right",
]);

/** Attributes without which a tag loses its meaning. The rest are stripped. */
const KEEP_ATTRS: Record<string, string[]> = {
  A: ["href", "title"],
  // data-md-src carries the author's path while src points through the webview:
  // copying an image inside the editor must put the path back, not the address.
  IMG: ["src", "data-md-src", "alt", "title"],
  TH: ["align"],
  TD: ["align"],
  DETAILS: ["open"],
  INPUT: ["type", "checked", "disabled"],
};

/**
 * Service nodes of the source: Material and MkDocs pilcrow anchors, tables of
 * contents, code block buttons, highlight line numbers, hidden content.
 */
const DROP_SELECTOR = [
  "script",
  "style",
  "link",
  "meta",
  "noscript",
  "template",
  "svg",
  "iframe",
  "a.headerlink",
  "a.md-annotation__index",
  ".md-code__nav",
  ".md-clipboard",
  ".md-annotation",
  ".linenos",
  ".lineno",
  "[aria-hidden='true']",
  "[hidden]",
].join(",");

/**
 * Parses HTML from the clipboard and returns a fragment that is safe to paste.
 * `doc` is the document the nodes are created in (needed for happy-dom tests).
 */
export function sanitizePastedHtml(html: string, doc: Document = document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fragment = doc.createDocumentFragment();
  for (const node of Array.from(parsed.body.childNodes)) {
    fragment.appendChild(doc.importNode(node, true));
  }
  // Our own render (markdown-it-anchor) wraps the WHOLE heading text in this
  // anchor, unlike Material's “¶”, which is a glyph of its own: dropping it would
  // delete the heading itself. The link is service markup all the same, so only
  // the wrapper goes.
  for (const el of Array.from(fragment.querySelectorAll("a.header-anchor"))) {
    unwrap(el, doc);
  }
  for (const el of Array.from(fragment.querySelectorAll(DROP_SELECTOR))) {
    el.remove();
  }
  cleanChildren(fragment, doc);
  return fragment;
}

function cleanChildren(parent: Node, doc: Document): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 8 /* comment */) {
      node.remove();
      continue;
    }
    if (!(node instanceof Element)) {
      continue;
    }
    cleanChildren(node, doc);
    const structural = structuralClasses(node);
    if (!KEEP_TAGS.has(node.tagName) && structural.length === 0) {
      unwrap(node, doc);
      continue;
    }
    stripAttributes(node, structural);
  }
}

/**
 * The Material classes this element carries. An admonition type (`tip`) is
 * meaningful only together with `admonition` — otherwise any `note` class from
 * a foreign page would turn a paragraph into an admonition.
 */
function structuralClasses(el: Element): string[] {
  // `language-*` on <code> is the only trace of the code block language: the
  // info string (`data-fence-info`) is not carried over, the serializer rebuilds
  // it from the structure.
  const classes = Array.from(el.classList).filter(
    (c) => KEEP_CLASSES.has(c) || c.startsWith("language-"),
  );
  if (classes.includes("admonition") || el.tagName === "DETAILS") {
    classes.push(...Array.from(el.classList).filter((c) => ADMONITION_TYPES.has(c)));
  }
  return classes;
}

function stripAttributes(el: Element, structural: string[]): void {
  const keep = KEEP_ATTRS[el.tagName] ?? [];
  for (const name of Array.from(el.getAttributeNames())) {
    if (!keep.includes(name)) {
      el.removeAttribute(name);
    }
  }
  if (structural.length > 0) {
    el.setAttribute("class", structural.join(" "));
  }
}

/** Replaces an element with its content (span, div, section… from the source). */
function unwrap(el: Element, doc: Document): void {
  const parent = el.parentNode;
  if (!parent) {
    return;
  }
  // A block container becomes a line break so that paragraphs do not stick together.
  const block = /^(DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|FIGURE|FIGCAPTION)$/.test(
    el.tagName,
  );
  const children = Array.from(el.childNodes);
  if (block && children.length > 0 && el.previousSibling) {
    parent.insertBefore(doc.createElement("br"), el);
  }
  for (const child of children) {
    parent.insertBefore(child, el);
  }
  el.remove();
}

/** Whether the sanitized fragment holds anything beyond empty text. */
export function fragmentHasContent(fragment: DocumentFragment): boolean {
  return (
    (fragment.textContent ?? "").trim() !== "" || fragment.querySelector("img, hr, br") !== null
  );
}
