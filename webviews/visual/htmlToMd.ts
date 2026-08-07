// Serialization of HTML (the output of our markdown-it engine plus
// contenteditable edits) back into the MkDocs Markdown dialect
// (python-markdown + pymdownx).
//
// The safety principle: ONLY the block the user actually changed is serialized;
// untouched blocks stay byte for byte. If a node we cannot turn into Markdown
// losslessly (a raw HTML block, footnotes, unknown constructs) is encountered
// inside a block, UnsupportedBlockError is thrown — the calling code marks the
// block as “text only” and disallows free editing.
//
// The module depends on neither vscode nor the global DOM (it works on the
// nodes it is given) — suitable for unit tests in happy-dom.

export class UnsupportedBlockError extends Error {
  constructor(what: string) {
    super(`Block is not serializable: ${what}`);
  }
}

/** The inline serialization context. */
interface InlineCtx {
  inTableCell?: boolean;
}

const ELEMENT = 1;
const TEXT = 3;

/** The editor's service elements inside blocks — they do not reach the Markdown. */
function isServiceElement(el: Element): boolean {
  return (
    el.classList.contains("isl-tools") ||
    el.classList.contains("vlive") ||
    // Inline controls of grid cards: “×”/“+”/the handle (see wireGridControls).
    el.classList.contains("vgctl")
  );
}

/**
 * Serializes a top-level block into Markdown. Returns text with a trailing
 * newline (without the blank separator line between blocks).
 */
export function serializeTopBlock(el: Element): string {
  // Trailing blank lines do not belong to the block: the block's range in the
  // file ends at the last meaningful line, and an extra newline on replacement
  // would add a blank line to the document.
  const lines = trimTrailingEmpty(blockLines(el));
  return lines.join("\n") + "\n";
}

/** The “this block can be edited freely” check (a dry run of serialization). */
export function canSerialize(el: Element): boolean {
  try {
    serializeTopBlock(el);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** The Markdown lines of a single block element (without the trailing \n). */
function blockLines(el: Element): string[] {
  const tag = el.tagName;
  switch (tag) {
    case "P":
      return paragraphLines(el);
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return headingLines(el, Number(tag[1]));
    case "UL":
    case "OL":
      return listLines(el);
    case "BLOCKQUOTE":
      return blockquoteLines(el);
    case "HR":
      return ["---"];
    case "TABLE":
      return tableLines(el);
    case "PRE":
      return preLines(el);
    case "DL":
      return deflistLines(el);
    case "DIV":
      return divLines(el);
    case "DETAILS":
      if (el.classList.contains("admonition")) {
        return admonitionLines(el);
      }
      throw new UnsupportedBlockError("details");
    case "SECTION":
      throw new UnsupportedBlockError("section (footnotes)");
    default:
      throw new UnsupportedBlockError(tag.toLowerCase());
  }
}

function divLines(el: Element): string[] {
  const cls = el.classList;
  if (isServiceElement(el)) {
    return [];
  }
  const htmlOpen = el.getAttribute("data-md-html-open");
  if (htmlOpen !== null) {
    // An md_in_html container: the original opening tag + the content + </div>.
    const body = trimTrailingEmpty(containerLines(el));
    return [htmlOpen, "", ...body, "", "</div>"];
  }
  if (cls.contains("adm-body")) {
    // The wrapper around the editable body of details — transparent to serialization.
    return containerLines(el);
  }
  if (cls.contains("snippet-include")) {
    // An include (--8<--): the marker goes back into the Markdown, not the
    // expanded text.
    const path = el.getAttribute("data-snippet-path");
    if (!path) {
      throw new UnsupportedBlockError("snippet without data-snippet-path");
    }
    return [`--8<-- "${path}"`];
  }
  if (cls.contains("abbr-defs")) {
    // The hidden block of abbreviation definitions: we return the original
    // `*[…]: …` lines.
    const src = el.getAttribute("data-abbr-src") ?? "";
    return src.split("\n");
  }
  if (cls.contains("footnote-defs")) {
    // The hidden carrier of a footnote definition: the original `[^…]: …` lines
    // (the rendered text lives in the service list at the end of the document).
    const src = el.getAttribute("data-fn-src") ?? "";
    return src.split("\n");
  }
  if (cls.contains("mkdocstrings")) {
    // A stub card: the content is built by a Python plugin, which we do not
    // have. We return the block's original lines — byte for byte, together with
    // the YAML options.
    return (el.getAttribute("data-mkdocstrings-src") ?? "").split("\n");
  }
  if (cls.contains("highlight")) {
    return fenceLines(el);
  }
  if (cls.contains("arithmatex")) {
    const tex = el.getAttribute("data-tex") ?? "";
    const bracket = el.getAttribute("data-math-delim") === "bracket";
    const [open, close] = bracket ? ["\\[", "\\]"] : ["$$", "$$"];
    return [open, ...tex.split("\n"), close];
  }
  if (cls.contains("admonition")) {
    return admonitionLines(el);
  }
  if (cls.contains("tabbed-set")) {
    return tabbedLines(el);
  }
  if (cls.length === 0) {
    // A “transparent” div (the browser may have created it while editing):
    // serialize the content.
    return containerLines(el);
  }
  throw new UnsupportedBlockError(`div.${Array.from(cls).join(".")}`);
}

/** A paragraph: inlines + splitting on hard breaks; support for the attrs suffix. */
function paragraphLines(el: Element): string[] {
  const text = inlineChildren(el, {});
  // An empty paragraph, or one consisting only of <br> (a freshly created empty
  // tab, for instance), yields no content — otherwise a lone <br> would be
  // serialized into two “dangling” spaces.
  if (text.replace(/\x00b/g, "").trim() === "") {
    return [];
  }
  const attrs = attrsSuffix(el, []);
  const lines = escapeLineStarts(splitHardBreaks(text));
  if (attrs) {
    // python-markdown's block-level attr_list lives on a separate last line.
    lines.push(attrs);
  }
  return lines;
}

/**
 * A heading: usually a single line with hashes, but the author may have written
 * it in the setext style (the text with an “===” underline below it) — in that
 * case we preserve that spelling so an edit does not rewrite someone else's
 * document.
 */
function headingLines(el: Element, level: number): string[] {
  const line = headingLine(el, level);
  const under = el.getAttribute("data-setext");
  if (under && level <= 2 && !line.includes("{")) {
    return [line.replace(/^#+\s+/, ""), under];
  }
  return [line];
}

function headingLine(el: Element, level: number): string {
  // markdown-it-anchor (headerLink) wraps the content in <a class="header-anchor">.
  let source: Element = el;
  const only = onlyElementChild(el);
  if (only && only.classList.contains("header-anchor")) {
    source = only;
  }
  const text = inlineChildren(source, {})
    .replace(/\s*\n\s*/g, " ")
    .trim();
  // A custom anchor/classes (`## Text { #id .cls }`): an auto id from
  // markdown-it-anchor is marked with data-auto-id (by the engine) or equals
  // slugify(text) — we do not write it out; after the heading is edited the
  // auto id goes stale, which is why the marker is needed.
  // data-user-id is the anchor written by the author (the engine marks it
  // itself). That is exactly what we return to the file: the id in the HTML may
  // have been made unique because of a duplicate.
  const userId = el.getAttribute("data-user-id");
  const id = userId ?? el.getAttribute("id");
  const auto =
    userId === null && (el.hasAttribute("data-auto-id") || (id !== null && id === autoSlug(text)));
  const leading = id && !auto ? [`#${id}`] : [];
  const attrs = attrsSuffix(el, [], leading);
  return "#".repeat(level) + " " + text + (attrs ? ` ${attrs}` : "");
}

/** markdown-it-anchor's default slug — for recognizing auto ids of headings. */
function autoSlug(text: string): string {
  return encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, "-"));
}

function blockquoteLines(el: Element): string[] {
  return containerLines(el).map((line) => (line === "" ? ">" : "> " + line));
}

/** markdown-it's default code_block (indented code) → a canonical fence. */
function preLines(el: Element): string[] {
  if (el.classList.contains("mermaid")) {
    // After mermaid has rendered, textContent holds the SVG — the source is
    // kept in data-mermaid-src (set by the editor before rendering).
    const src = el.getAttribute("data-mermaid-src") ?? el.textContent ?? "";
    const code = src.replace(/\n$/, "");
    return [fenceFor(code) + "mermaid", ...code.split("\n"), fenceFor(code)];
  }
  const codeEl = el.querySelector(":scope > code");
  const code = ((codeEl ?? el).textContent ?? "").replace(/\n$/, "");
  const lang = languageFromClass(codeEl);
  return [fenceFor(code) + lang, ...code.split("\n"), fenceFor(code)];
}

/** A code block from our superFences render (div.highlight). */
function fenceLines(el: Element): string[] {
  const codeEl = el.querySelector(":scope > pre > code");
  if (!codeEl) {
    throw new UnsupportedBlockError("highlight without code");
  }
  // The source before snippet substitution (--8<--), if there was any.
  const pristine = el.getAttribute("data-fence-pristine");
  // The inline editor keeps the lines in `.cl` blocks (with no `\n` inside) —
  // we assemble them; otherwise plain textContent.
  const codeText = (): string => {
    const lineSpans = codeEl.querySelectorAll(":scope > .cl");
    if (lineSpans.length) {
      return Array.from(lineSpans, (l) => l.textContent ?? "").join("\n");
    }
    return (codeEl.textContent ?? "").replace(/\n$/, "");
  };
  const code = pristine !== null ? pristine.replace(/\n$/, "") : codeText();

  // The info string: the original saved by the render is the source of truth
  // (this way even the parameters the lightweight render does not understand
  // survive the round trip). On an inline edit of `.filename` we substitute the
  // title with its current text.
  const savedInfo = el.getAttribute("data-fence-info");
  if (savedInfo !== null) {
    const filename = el.querySelector(":scope > .filename");
    const info = filename ? overrideTitle(savedInfo, filename.textContent ?? "") : savedInfo;
    return [fenceFor(code, el) + info, ...code.split("\n"), fenceFor(code, el)];
  }

  // Fallback: reconstructing the info string from the block's structure.
  const lang = languageFromClass(codeEl);
  const opts: string[] = [];
  const titleEl = el.querySelector(":scope > .filename");
  if (titleEl) {
    opts.push(`title="${(titleEl.textContent ?? "").replace(/"/g, "'")}"`);
  }
  if (el.classList.contains("linenums")) {
    opts.push('linenums="1"');
  }
  const hl = hlLinesSpec(codeEl);
  if (hl) {
    opts.push(`hl_lines="${hl}"`);
  }
  const info = [lang, ...opts].filter(Boolean).join(" ");
  return [fenceFor(code, el) + info, ...code.split("\n"), fenceFor(code, el)];
}

/** Replaces `title="…"` in a fence info string with the inline title's text (an empty one removes it). */
export function overrideTitle(info: string, title: string): string {
  const t = title.trim().replace(/"/g, "'");
  if (/title="[^"]*"/.test(info)) {
    if (!t) {
      return info
        .replace(/\s*title="[^"]*"/, "")
        .replace(/\{\s+/, "{ ")
        .replace(/\s+\}/, " }")
        .trim();
    }
    return info.replace(/title="[^"]*"/, `title="${t}"`);
  }
  if (!t) {
    return info;
  }
  const braced = /^\{(.*)\}$/.exec(info.trim());
  if (braced) {
    return `{ ${braced[1].trim()} title="${t}" }`;
  }
  return (info.trim() ? info.trim() + " " : "") + `title="${t}"`;
}

/** Reconstructs hl_lines from the per-line markup (span.hll). */
function hlLinesSpec(codeEl: Element): string {
  const rows = Array.from(codeEl.children).filter((c) => c.tagName === "SPAN");
  const marked: number[] = [];
  rows.forEach((row, i) => {
    if (row.classList.contains("hll")) {
      marked.push(i + 1);
    }
  });
  if (marked.length === 0) {
    return "";
  }
  // Folding into ranges: [2,3,4,7] → "2-4 7".
  const parts: string[] = [];
  let start = marked[0];
  let prev = marked[0];
  for (const n of marked.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? String(start) : `${start}-${prev}`);
  return parts.join(" ");
}

function languageFromClass(codeEl: Element | null): string {
  if (!codeEl) {
    return "";
  }
  for (const cls of Array.from(codeEl.classList)) {
    if (cls.startsWith("language-")) {
      return cls.slice("language-".length);
    }
  }
  return "";
}

/** A fence with headroom: if the code contains ```, we use ````. */
function fenceFor(code: string, el?: Element): string {
  // The author may have fenced the code with tildes — we preserve that spelling.
  const authored = el?.getAttribute("data-fence");
  if (authored && /^~{3,}$/.test(authored)) {
    return authored;
  }
  return code.includes("```") ? "````" : "```";
}

// --- admonition / details ---------------------------------------------------

function admonitionLines(el: Element): string[] {
  const isDetails = el.tagName === "DETAILS";
  const marker = isDetails ? (el.hasAttribute("open") ? "???+" : "???") : "!!!";
  const classes = Array.from(el.classList).filter((c) => c !== "admonition");
  if (classes.length === 0) {
    throw new UnsupportedBlockError("admonition without a type");
  }

  const titleEl = findChild(
    el,
    (c) => c.classList.contains("admonition-title") || c.tagName === "SUMMARY",
  );
  let head = `${marker} ${classes.join(" ")}`;
  if (!titleEl) {
    // An explicitly suppressed title: `!!! note ""`.
    head += ' ""';
  } else {
    const title = inlineChildren(titleEl, {}).trim().replace(/"/g, "'");
    if (title !== defaultTitle(classes[0])) {
      head += ` "${title}"`;
    }
  }

  const body = containerLines(el, (c) => c === titleEl);
  const lines = [head];
  for (const line of body) {
    lines.push(line === "" ? "" : "    " + line);
  }
  return trimTrailingEmpty(lines);
}

function defaultTitle(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// --- content tabs -----------------------------------------------------------

/** The tab's title without the editor's inline service controls (the “×” button). */
function tabLabelTitle(label: Element): string {
  if (!label.querySelector(".vtab-x")) {
    return label.textContent ?? "";
  }
  const clone = label.cloneNode(true) as Element;
  clone.querySelectorAll(".vtab-x").forEach((n) => n.remove());
  return clone.textContent ?? "";
}

function tabbedLines(el: Element): string[] {
  const labels = Array.from(el.querySelectorAll(":scope > .tabbed-labels > label"));
  const blocks = Array.from(el.querySelectorAll(":scope > .tabbed-content > .tabbed-block"));
  if (labels.length === 0 || labels.length !== blocks.length) {
    throw new UnsupportedBlockError("tabbed-set with mismatched tabs");
  }
  const lines: string[] = [];
  labels.forEach((label, i) => {
    if (i > 0) {
      lines.push("");
    }
    const title = tabLabelTitle(label).trim().replace(/"/g, "'");
    lines.push(`=== "${title}"`);
    const body = trimTrailingEmpty(containerLines(blocks[i]));
    if (body.length > 0) {
      lines.push("");
      for (const line of body) {
        lines.push(line === "" ? "" : "    " + line);
      }
    }
  });
  return lines;
}

// --- lists ------------------------------------------------------------------

function listLines(list: Element): string[] {
  const ordered = list.tagName === "OL";
  const start = ordered ? Number(list.getAttribute("start") ?? "1") : 0;
  // We preserve the author's marker spelling (“*”, “+”, “1)”) — otherwise
  // editing one item would rewrite the style of the whole list in someone
  // else's document.
  const authored = list.getAttribute("data-marker") ?? "";
  const bullet = /^[-*+]$/.test(authored) ? authored : "-";
  const delim = authored === ")" ? ")" : ".";
  const items = Array.from(list.children).filter((c) => c.tagName === "LI");
  const loose = items.some((li) => Array.from(li.children).some((c) => c.tagName === "P"));

  const out: string[] = [];
  items.forEach((li, index) => {
    if (loose && index > 0) {
      out.push("");
    }
    const marker = ordered ? `${start + index}${delim} ` : `${bullet} `;
    const itemLines = listItemLines(li, loose);
    if (itemLines.length === 0) {
      out.push(marker.trimEnd());
      return;
    }
    out.push(marker + itemLines[0]);
    const pad = " ".repeat(4);
    for (const line of itemLines.slice(1)) {
      out.push(line === "" ? "" : pad + line);
    }
  });
  return out;
}

/** The content of one li: the task checkbox + the inline “head” + nested blocks. */
function listItemLines(li: Element, loose: boolean): string[] {
  const segments: string[][] = [];
  let head = "";
  let headAttr = "";
  let checkbox = "";

  const visit = (nodes: Iterable<Node>): void => {
    for (const node of nodes) {
      if (node.nodeType === TEXT) {
        head += escapeText(node.nodeValue ?? "", {});
        continue;
      }
      if (node.nodeType !== ELEMENT) {
        continue;
      }
      const child = node as Element;
      if (isServiceElement(child)) {
        continue;
      }
      if (child.tagName === "INPUT") {
        const input = child as HTMLInputElement;
        if (input.classList.contains("task-list-item-checkbox")) {
          checkbox = input.checked ? "[x] " : "[ ] ";
        }
        continue;
      }
      if (child.tagName === "LABEL") {
        // task-lists (label: true) wraps the checkbox and the text in a label.
        visit(Array.from(child.childNodes));
        continue;
      }
      if (isBlockTag(child.tagName)) {
        if (child.tagName === "P") {
          // A “loose” task item: the checkbox sits inside the first paragraph
          // rather than as a direct child of the li. We parse the paragraph by
          // the same rules, otherwise “[x] ” is lost and the task becomes a
          // plain item.
          if (
            checkbox === "" &&
            head.trim() === "" &&
            segments.length === 0 &&
            child.querySelector("input.task-list-item-checkbox")
          ) {
            visit(Array.from(child.childNodes));
            continue;
          }
          const text = inlineChildren(child, {});
          // An empty paragraph (e.g. <p><br></p> — a freshly created empty grid
          // card) yields no content; otherwise the <br> would be serialized
          // into “dangling” spaces.
          if (text.replace(/\x00b/g, "").trim() === "") {
            continue;
          }
          // The paragraph's attr_list (`{ .annotate }` of a nested annotation)
          // lives on its own last line, exactly like paragraphLines writes it.
          const attrs = attrsSuffix(child, []);
          if (head.trim() === "" && segments.length === 0) {
            head += text;
            headAttr = attrs;
          } else {
            const seg = escapeLineStarts(splitHardBreaks(text));
            if (attrs) {
              seg.push(attrs);
            }
            segments.push(seg);
          }
        } else {
          segments.push(blockLines(child));
        }
      } else {
        head += serializeInline(child, {});
      }
    }
  };
  visit(Array.from(li.childNodes));

  const lines: string[] = [];
  const headText = head.replace(/^\s+|\s+$/g, "");
  if (headText !== "" || checkbox !== "") {
    lines.push(...escapeLineStarts(splitHardBreaks(checkbox + headText)));
    if (headAttr) {
      lines.push(headAttr); // part of the paragraph — no blank line before it
    }
  }
  for (const seg of segments) {
    const isList = seg.length > 0 && /^(-|\d+\.)\s/.test(seg[0]);
    if (lines.length > 0 && (loose || !isList)) {
      lines.push("");
    }
    lines.push(...seg);
  }
  return lines;
}

function isBlockTag(tag: string): boolean {
  return (
    tag === "P" ||
    tag === "UL" ||
    tag === "OL" ||
    tag === "BLOCKQUOTE" ||
    tag === "PRE" ||
    tag === "TABLE" ||
    tag === "DIV" ||
    tag === "DETAILS" ||
    tag === "HR" ||
    tag === "DL" ||
    /^H[1-6]$/.test(tag)
  );
}

// --- tables -----------------------------------------------------------------

function tableLines(table: Element): string[] {
  const headRow = table.querySelector(":scope > thead > tr");
  if (!headRow) {
    throw new UnsupportedBlockError("table without thead");
  }
  const headCells = Array.from(headRow.children).filter(isCell);
  const aligns = headCells.map(cellAlign);

  const lines: string[] = [];
  lines.push(rowLine(headCells));
  // The author could have written the alignment row any way they liked
  // (“|:--|--:|”); we preserve that spelling as long as it still says what the
  // table says. It stops saying it when a column is added or removed, and when
  // the alignment buttons change one — those write the alignment onto the
  // cells, and keeping the authored row would quietly drop the change.
  const authored = table.getAttribute("data-delim-row");
  if (authored && sameList(delimAligns(authored), aligns)) {
    lines.push(authored);
  } else {
    lines.push(
      "| " +
        aligns
          .map((a) =>
            a === "center" ? ":---:" : a === "right" ? "---:" : a === "left" ? ":---" : "---",
          )
          .join(" | ") +
        " |",
    );
  }
  const bodyRows = Array.from(table.querySelectorAll(":scope > tbody > tr"));
  for (const row of bodyRows) {
    lines.push(rowLine(Array.from(row.children).filter(isCell)));
  }
  return lines;
}

function isCell(el: Element): boolean {
  return el.tagName === "TD" || el.tagName === "TH";
}

/** The alignment each column of an authored delimiter row asks for. */
function delimAligns(row: string): string[] {
  return row
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => {
      const spec = cell.trim();
      const left = spec.startsWith(":");
      const right = spec.endsWith(":");
      return left && right ? "center" : right ? "right" : left ? "left" : "";
    });
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function cellAlign(cell: Element): string {
  const style = cell.getAttribute("style") ?? "";
  const m = /text-align:\s*(left|center|right)/.exec(style);
  return m ? m[1] : (cell.getAttribute("align") ?? "");
}

function rowLine(cells: Element[]): string {
  const parts = cells.map((cell) => {
    const text = inlineChildren(cell, { inTableCell: true })
      .replace(/\s*\n\s*/g, " ")
      .trim()
      // Trailing <br>s are service ones (empty cells are created with a <br> inside).
      .replace(/(?:\s*<br>\s*)+$/, "");
    return text === "" ? "   " : text;
  });
  return "| " + parts.join(" | ") + " |";
}

// --- definition lists -------------------------------------------------------

function deflistLines(dl: Element): string[] {
  const loose = isLooseDeflist(dl);
  const lines: string[] = [];
  for (const child of Array.from(dl.children)) {
    if (child.tagName === "DT") {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(inlineChildren(child, {}).trim());
    } else if (child.tagName === "DD") {
      const body = ddLines(child);
      if (body.length === 0) {
        continue;
      }
      if (loose && lines.length > 0) {
        lines.push("");
      }
      lines.push(":   " + body[0]);
      for (const line of body.slice(1)) {
        lines.push(line === "" ? "" : "    " + line);
      }
    }
  }
  return lines;
}

/**
 * A “loose” definition list is one where the definition is separated from the
 * term by a blank line. Both variants render identically, so we reconstruct the
 * form from the gap in the source lines.
 */
function isLooseDeflist(dl: Element): boolean {
  let prevEnd: number | null = null;
  for (const child of Array.from(dl.children)) {
    const startAttr = child.getAttribute("data-src-line");
    if (startAttr === null) {
      prevEnd = null;
      continue;
    }
    const start = Number(startAttr);
    const endAttr = child.getAttribute("data-src-end");
    const end = endAttr === null ? start + 1 : Number(endAttr);
    if (child.tagName === "DD" && prevEnd !== null && start > prevEnd) {
      return true;
    }
    prevEnd = Math.max(end, start + 1);
  }
  return false;
}

function ddLines(dd: Element): string[] {
  const hasBlocks = Array.from(dd.children).some((c) => isBlockTag(c.tagName));
  if (!hasBlocks) {
    return escapeLineStarts(splitHardBreaks(inlineChildren(dd, {}))).filter(
      (l, i, all) => !(l === "" && (i === 0 || i === all.length - 1)),
    );
  }
  return containerLines(dd);
}

// --- containers -------------------------------------------------------------

/**
 * Serialization of a container's block children (blockquote, admonition,
 * tabbed-block…): the blocks are separated by a blank line.
 */
function containerLines(el: Element, skip?: (c: Element) => boolean): string[] {
  const lines: string[] = [];
  let pendingInline = "";

  const flushInline = (): void => {
    const text = pendingInline.replace(/^\s+|\s+$/g, "");
    pendingInline = "";
    if (text !== "") {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(...escapeLineStarts(splitHardBreaks(text)));
    }
  };

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === TEXT) {
      pendingInline += escapeText(node.nodeValue ?? "", {});
      continue;
    }
    if (node.nodeType !== ELEMENT) {
      continue;
    }
    const child = node as Element;
    if (skip?.(child) || isServiceElement(child)) {
      continue;
    }
    if (isBlockTag(child.tagName) && !isInlineDiv(child)) {
      flushInline();
      const seg = blockLines(child);
      if (seg.length === 0) {
        continue;
      }
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(...seg);
    } else {
      pendingInline += serializeInline(child, {});
    }
  }
  flushInline();
  return lines;
}

/** A div that is, by its content, an inline wrapper (left behind by browser edits). */
function isInlineDiv(el: Element): boolean {
  if (el.tagName !== "DIV" || el.classList.length > 0) {
    return false;
  }
  return !Array.from(el.children).some((c) => isBlockTag(c.tagName));
}

// ---------------------------------------------------------------------------
// Inlines
// ---------------------------------------------------------------------------

function inlineChildren(el: Element, ctx: InlineCtx): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === TEXT) {
      out += escapeText(node.nodeValue ?? "", ctx);
    } else if (node.nodeType === ELEMENT) {
      out += serializeInline(node as Element, ctx);
    }
  }
  return out;
}

function serializeInline(el: Element, ctx: InlineCtx): string {
  const tag = el.tagName;
  switch (tag) {
    case "STRONG":
    case "B":
      return wrapNonEmpty(el, ctx, "**");
    case "EM":
    case "I":
      return wrapNonEmpty(el, ctx, "*");
    case "DEL":
    case "S":
    case "STRIKE":
      if (el.classList.contains("critic")) {
        return `{--${inlineChildren(el, ctx)}--}`;
      }
      return wrapNonEmpty(el, ctx, "~~");
    case "MARK": {
      if (el.classList.contains("critic")) {
        return `{==${inlineChildren(el, ctx)}==}`;
      }
      // The highlight color is kept in an hl-* class (attr_list):
      // ==text=={ .hl-green }. attr_list only binds when it is right up against
      // the “==”, so the highlight's trailing space (moved out by wrapNonEmpty)
      // is placed AFTER the class.
      const marked = wrapNonEmpty(el, ctx, "==");
      if (!marked.includes("==")) {
        return marked;
      }
      const attrs = attrsSuffix(el, []);
      if (attrs === "") {
        return marked;
      }
      const tail = /\s*$/.exec(marked)?.[0] ?? "";
      return marked.slice(0, marked.length - tail.length) + attrs + tail;
    }
    case "INS":
      if (el.classList.contains("critic")) {
        return `{++${inlineChildren(el, ctx)}++}`;
      }
      return wrapNonEmpty(el, ctx, "^^");
    case "SUB":
      return wrapNonEmpty(el, ctx, "~");
    case "SUP":
      return supInline(el, ctx);
    case "CODE":
      return codeInline(el);
    case "A":
      return anchorInline(el, ctx);
    case "IMG":
      return imageInline(el);
    case "BR":
      // A hard break is marked with a sentinel: splitHardBreaks turns it into
      // “two spaces + a newline”. Soft breaks (a \n in the text) stay as they are.
      return ctx.inTableCell ? "<br>" : "\x00b";
    case "SPAN":
      // The visual editor's decorative annotation marker → the original `(n)`.
      if (el.classList.contains("md-annotation")) {
        return `(${el.getAttribute("data-annotation-index") ?? ""})`;
      }
      return spanInline(el, ctx);
    case "KBD":
      // A lone <kbd> from raw HTML — we keep it as an HTML inline.
      return `<kbd>${inlineChildren(el, ctx)}</kbd>`;
    case "ABBR":
      // The wrapper is derived from the `*[…]: …` definition — only the label
      // goes back into the text.
      return inlineChildren(el, ctx);
    case "LABEL":
      return inlineChildren(el, ctx);
    case "INPUT":
      return "";
    case "U":
    case "FONT":
      // contenteditable garbage: unwrap it.
      return inlineChildren(el, ctx);
    default:
      // SVG tags arrive in lower case (namespace); outside of icon wrappers
      // (data-emoji) they cannot be serialized.
      if (tag.toLowerCase() === "svg") {
        throw new UnsupportedBlockError("svg outside an icon");
      }
      // An unknown inline tag — we unwrap its content (being lenient towards
      // editing artifacts), except for the clearly structural ones.
      if (isBlockTag(tag)) {
        throw new UnsupportedBlockError(`${tag.toLowerCase()} inside an inline`);
      }
      return inlineChildren(el, ctx);
  }
}

function wrapNonEmpty(el: Element, ctx: InlineCtx, marker: string): string {
  const inner = inlineChildren(el, ctx);
  if (inner.trim() === "") {
    return inner;
  }
  // Emphasis markers do not work across edge whitespace — we move it outside.
  const lead = /^\s*/.exec(inner)?.[0] ?? "";
  const tail = /\s*$/.exec(inner.slice(lead.length))?.[0] ?? "";
  const core = inner.slice(lead.length, inner.length - tail.length);
  return `${lead}${marker}${core}${marker}${tail}`;
}

function supInline(el: Element, ctx: InlineCtx): string {
  if (el.classList.contains("footnote-ref")) {
    // A named footnote carries its label in data-fn-label (set by the render) —
    // the marker round-trips exactly. Inline footnotes (`^[…]`) have no label:
    // the render only numbers them, the original cannot be restored.
    const label = el.getAttribute("data-fn-label");
    if (label) {
      return `[^${label}]`;
    }
    throw new UnsupportedBlockError("footnote");
  }
  return wrapNonEmpty(el, ctx, "^");
}

function codeInline(el: Element): string {
  let text = (el.textContent ?? "").replace(/\u00a0/g, " ");
  if (text === "") {
    return "";
  }
  // Inline highlighting (pymdownx.inlinehilite): the render stripped the
  // `#!language` prefix.
  const inlineLang = el.getAttribute("data-inline-lang");
  if (inlineLang) {
    text = `#!${inlineLang} ${text}`;
  }
  const fence = text.includes("`") ? "``" : "`";
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function anchorInline(el: Element, ctx: InlineCtx): string {
  if (el.classList.contains("header-anchor")) {
    return inlineChildren(el, ctx);
  }
  if (el.classList.contains("footnote-backref")) {
    throw new UnsupportedBlockError("footnote");
  }
  const href = el.getAttribute("href") ?? "";
  const text = inlineChildren(el, ctx);
  const attrs = attrsSuffix(el, []);
  if (!attrs && (text === href || (text === "" && href === ""))) {
    return text;
  }
  const title = el.getAttribute("title");
  const titlePart = title ? ` "${title.replace(/"/g, "'")}"` : "";
  return `[${text}](${escapeUrl(href)}${titlePart})${attrs}`;
}

function imageInline(el: Element): string {
  const alt = (el.getAttribute("alt") ?? "").replace(/([\\[\]])/g, "\\$1");
  // src points at the file through the webview; the author's path is kept aside
  // (see rewriteHtmlAssetUrls) — that is what goes back into the document.
  const src = el.getAttribute("data-md-src") ?? el.getAttribute("src") ?? "";
  const title = el.getAttribute("title");
  const titlePart = title ? ` "${title.replace(/"/g, "'")}"` : "";
  // attr_list attributes in Material's canonical order: align, width, height,
  // loading — key=value/key="value" following the reference documentation.
  const extra: string[] = [];
  const align = el.getAttribute("align");
  if (align) {
    extra.push(`align=${align}`);
  }
  const width = el.getAttribute("width");
  if (width) {
    extra.push(`width="${width}"`);
  }
  const height = el.getAttribute("height");
  if (height) {
    extra.push(`height="${height}"`);
  }
  const loading = el.getAttribute("loading");
  if (loading) {
    extra.push(`loading=${loading}`);
  }
  const suffix = attrsSuffix(el, extra);
  return `![${alt}](${escapeUrl(src)}${titlePart})${suffix}`;
}

function spanInline(el: Element, ctx: InlineCtx): string {
  if (el.classList.contains("critic")) {
    if (el.classList.contains("comment")) {
      return `{>>${el.textContent ?? ""}<<}`;
    }
    if (el.classList.contains("subst")) {
      const delEl = findChild(el, (c) => c.tagName === "DEL");
      const insEl = findChild(el, (c) => c.tagName === "INS");
      const before = delEl ? inlineChildren(delEl, ctx) : "";
      const after = insEl ? inlineChildren(insEl, ctx) : "";
      return `{~~${before}~>${after}~~}`;
    }
  }
  const emoji = el.getAttribute("data-emoji");
  if (emoji) {
    // attr_list classes and attributes (`:icon:{ .heart title="…" }`) go into
    // the suffix.
    const extra: string[] = [];
    const title = el.getAttribute("title");
    if (title) {
      extra.push(`title="${title.replace(/"/g, "'")}"`);
    }
    return emoji + attrsSuffix(el, extra);
  }
  const keys = el.getAttribute("data-keys");
  if (keys) {
    return keys;
  }
  const tex = el.getAttribute("data-tex");
  if (tex !== null) {
    return el.getAttribute("data-math-delim") === "paren" ? `\\(${tex}\\)` : `$${tex}$`;
  }
  if (el.classList.contains("katex") || el.classList.contains("katex-html")) {
    // KaTeX without data-tex cannot be serialized (it should not occur outside
    // the wrapper).
    throw new UnsupportedBlockError("formula without a source");
  }
  // An ordinary span (including the browser's styling garbage) — unwrap it.
  return inlineChildren(el, ctx);
}

// ---------------------------------------------------------------------------
// Text, escaping, utilities
// ---------------------------------------------------------------------------

/**
 * Escaping of plain text. The character set is the intersection of what
 * python-markdown and CommonMark consider escapable, so that both engines read
 * the text the same way.
 */
function escapeText(raw: string, ctx: InlineCtx): string {
  let s = raw.replace(/\u00a0/g, " ");
  s = s.replace(/[\\`*{}[\]]/g, "\\$&");
  // “<” is only dangerous as the start of a tag (`<b>`, `</b>`, `<!--`); a “>”
  // in the middle of a line is harmless — a blockquote is only introduced by a
  // “>” at the start (see escapeLineStarts).
  s = s.replace(/<(?=[a-zA-Z/!?])/g, "\\<");
  // An underscore inside a word (`snake_case`) does not open emphasis \u2014 we
  // escape it only at a word boundary, otherwise ordinary text would end up
  // littered with backslashes.
  s = s.replace(/_/g, (m, at: number, whole: string) => {
    const prev = whole[at - 1] ?? " ";
    const next = whole[at + 1] ?? " ";
    const word = /[\p{L}\p{N}]/u;
    return word.test(prev) && word.test(next) ? m : "\\" + m;
  });
  s = s.replace(/&(?=[a-zA-Z#])/g, "&amp;");
  if (ctx.inTableCell) {
    s = s.replace(/\|/g, "\\|");
  }
  return s;
}

function escapeUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");
}

/** Splitting into lines: hard breaks (the <br> sentinel) → “␠␠”, soft ones stay as they are. */
function splitHardBreaks(text: string): string[] {
  // The sentinel swallows the following \n if there is one (a <br> from the
  // render has one, a browser-inserted one does not), and always yields exactly
  // one line break.
  const normalized = text.replace(/\x00b\s*\n?/g, "\x00b\n");
  return normalized.split("\n").map((line) => {
    const trimmed = line.replace(/\s+$/g, "");
    return trimmed.endsWith("\x00b") ? trimmed.slice(0, -2) + "  " : trimmed;
  });
}

/**
 * Escapes the characters that are meaningful only at the start of a line
 * (markers of headings, lists, blockquotes, tabs), so that a paragraph's text
 * does not turn into markup.
 */
function escapeLineStarts(lines: string[]): string[] {
  // “=” is not escaped: python-markdown does not understand “\=” and would show
  // it as is.
  return lines.map((line) =>
    line.replace(/^(\s*)([#>+-]|\d+[.)])(\s|$)/, (_m, sp: string, mark: string, tail: string) => {
      const escaped = mark.length === 1 ? `\\${mark}` : mark.replace(/([.)])$/, "\\$1");
      return `${sp}${escaped}${tail}`;
    }),
  );
}

/**
 * The `{ .class #id }` attrs suffix for elements with user-defined classes
 * (markdown-it-attrs / attr_list). Service classes are filtered out.
 */
function attrsSuffix(el: Element, extra: string[], leading: string[] = []): string {
  const SERVICE = new Set([
    "header-anchor",
    "task-list-item",
    "task-list-item-checkbox",
    "contains-task-list",
    "task-list",
    "enabled",
    "footnote-ref",
    "twemoji",
    "viemoji-live",
    "keys",
    "arithmatex",
    // The visual editor's service classes — they are not part of the content.
    "visland",
    "vnoedit",
    "vfocus",
    "vempty",
    "vsyncing",
    "adm-body",
    // The hidden companion list of annotations (a visual editor decoration).
    "annotation-list",
  ]);
  const classes = Array.from(el.classList).filter((c) => !SERVICE.has(c));
  const parts = [...leading, ...classes.map((c) => `.${c}`), ...extra];
  if (parts.length === 0) {
    return "";
  }
  return `{ ${parts.join(" ")} }`;
}

function trimTrailingEmpty(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }
  return out;
}

function onlyElementChild(el: Element): Element | null {
  let found: Element | null = null;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === TEXT && (node.nodeValue ?? "").trim() !== "") {
      return null;
    }
    if (node.nodeType === ELEMENT) {
      if (found) {
        return null;
      }
      found = node as Element;
    }
  }
  return found;
}

function findChild(el: Element, pred: (c: Element) => boolean): Element | null {
  for (const child of Array.from(el.children)) {
    if (pred(child)) {
      return child;
    }
  }
  return null;
}
