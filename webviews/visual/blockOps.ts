/**
 * Block operations on Markdown lines: lists, headings, quotes, indentation.
 *
 * They work on text rather than on the DOM: in HTML the same thing is
 * represented in different ways (a “loose” item keeps its text in a <p>, a task
 * in a <label> with a checkbox, a sub-item in a nested <ul>), and DOM-based
 * transformations kept tripping over those differences. In Markdown everything
 * is unambiguous: marker, indent, text.
 *
 * The functions are pure — they take the block's lines and return new lines.
 */

export type ListKind = "ul" | "ol" | "task";

/** The indent of one nesting level (python-markdown's tab_length). */
const INDENT = "    ";

export interface ListLine {
  indent: string;
  marker: string; // “-”, “*”, “1.”, “1)” — empty if the line is not an item
  checked: boolean | null; // the `[x]`/`[ ]` state, null — not a task
  text: string;
}

const ITEM_RE = /^(\s*)([-*+]|\d+[.)])[ \t]+(?:\[([ xX])\][ \t]+)?(.*)$/;

/** Parses a line: a list item or a plain line. */
export function parseListLine(line: string): ListLine {
  const m = ITEM_RE.exec(line);
  if (!m) {
    return { indent: /^\s*/.exec(line)?.[0] ?? "", marker: "", checked: null, text: line.trim() };
  }
  return {
    indent: m[1],
    marker: m[2],
    checked: m[3] === undefined ? null : m[3].toLowerCase() === "x",
    text: m[4],
  };
}

/** The item marker of the requested kind: “- ”, “3. ”, “- [x] ”. */
function markerFor(kind: ListKind, index: number, checked: boolean | null): string {
  if (kind === "ol") {
    return `${index + 1}. `;
  }
  return kind === "task" ? `- [${checked ? "x" : " "}] ` : "- ";
}

/** Lines at the block's base level (no deeper) — the operations act on those. */
function isOwnLevel(line: string, baseIndent: string): boolean {
  if (line.trim() === "") {
    return false;
  }
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  return indent.length <= baseIndent.length;
}

/**
 * Paragraphs → list. Every non-empty stretch of text becomes an item; the blank
 * separator lines are dropped (the result is a tight list).
 * Paragraph continuation lines are aligned under the item's content.
 */
export function toList(lines: string[], kind: ListKind, baseIndent = ""): string[] {
  const out: string[] = [];
  let index = 0;
  let inItem = false;
  for (const line of lines) {
    if (line.trim() === "") {
      inItem = false; // a blank line closes the paragraph but does not enter the list
      continue;
    }
    const body = line.slice(Math.min(baseIndent.length, /^\s*/.exec(line)?.[0].length ?? 0));
    if (inItem) {
      out.push(baseIndent + "  " + body.trim());
      continue;
    }
    out.push(baseIndent + markerFor(kind, index, false) + body.trim());
    index++;
    inItem = true;
  }
  return out.length > 0 ? out : [baseIndent + markerFor(kind, 0, false)];
}

/** Changing the list kind: markers at our own level are rewritten, nested ones are not. */
export function retypeList(lines: string[], kind: ListKind, baseIndent = ""): string[] {
  let index = 0;
  return lines.map((line) => {
    if (!isOwnLevel(line, baseIndent)) {
      return line;
    }
    const item = parseListLine(line);
    if (item.marker === "") {
      return line; // an item's continuation line
    }
    const marker = markerFor(kind, index, item.checked);
    index++;
    return item.indent + marker + item.text;
  });
}

/**
 * Removing list-ness: items at our own level become paragraphs separated by a
 * blank line (otherwise adjacent lines would stick together into a single
 * paragraph). Nested sub-items are lifted one level up — otherwise the
 * four-space indent would turn them into a code block.
 */
export function fromList(lines: string[], baseIndent = ""): string[] {
  const out: string[] = [];
  const pushGap = (): void => {
    if (out.length > 0 && out[out.length - 1].trim() !== "") {
      out.push("");
    }
  };
  for (const line of lines) {
    if (line.trim() === "") {
      continue; // we place the separators ourselves
    }
    if (isOwnLevel(line, baseIndent)) {
      const item = parseListLine(line);
      pushGap();
      out.push(baseIndent + (item.marker === "" ? item.text : item.text));
      continue;
    }
    // Deeper than the base level: lift one level up (the sub-list stays a list).
    const dedented = line.startsWith(baseIndent + INDENT)
      ? baseIndent + line.slice((baseIndent + INDENT).length)
      : line;
    const item = parseListLine(dedented);
    if (item.marker !== "" && isOwnLevel(dedented, baseIndent)) {
      pushGap();
    }
    out.push(dedented);
  }
  return out;
}

/** A heading of the requested level (0 — a plain paragraph) from the block's lines. */
export function setHeading(lines: string[], level: number, baseIndent = ""): string[] {
  const text = lines
    .map((l) => l.replace(/^\s*#{1,6}\s+/, "").trim())
    .filter((l) => l !== "")
    .join(" ");
  if (level === 0) {
    return [baseIndent + text];
  }
  return [baseIndent + "#".repeat(level) + " " + text];
}

/** Lines → blockquote (blank lines inside are marked with “>” as well). */
export function toQuote(lines: string[], baseIndent = ""): string[] {
  return lines.map((line) => {
    const body = line.startsWith(baseIndent) ? line.slice(baseIndent.length) : line.trimStart();
    return body.trim() === "" ? baseIndent + ">" : baseIndent + "> " + body;
  });
}

/** Removing the blockquote: we strip “>” at every level of the block's lines. */
export function fromQuote(lines: string[], baseIndent = ""): string[] {
  return lines.map((line) => {
    const body = line.startsWith(baseIndent) ? line.slice(baseIndent.length) : line.trimStart();
    return baseIndent + body.replace(/^>[ \t]?/, "");
  });
}

/** The heading level of a line (0 — not a heading). */
export function headingLevel(line: string): number {
  return /^\s*(#{1,6})\s+/.exec(line)?.[1].length ?? 0;
}

/**
 * The bounds of the list item that starts at line `at`: the item itself plus
 * everything that belongs to it (continuations and nested sub-items — lines
 * with a larger indent and the blank lines between them).
 */
export function itemRange(lines: string[], at: number): { start: number; end: number } {
  const own = parseListLine(lines[at] ?? "").indent.length;
  let end = at + 1;
  let pending = end;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "") {
      end++;
      continue; // a blank line can occur inside a “loose” item
    }
    const indent = (/^\s*/.exec(line)?.[0] ?? "").length;
    if (indent <= own) {
      break;
    }
    end++;
    pending = end;
  }
  return { start: at, end: pending };
}

/** Shifts an item's lines one level deeper/shallower. */
export function shiftLines(lines: string[], deeper: boolean): string[] {
  return lines.map((line) => {
    if (line.trim() === "") {
      return line;
    }
    if (deeper) {
      return INDENT + line;
    }
    return line.startsWith(INDENT) ? line.slice(INDENT.length) : line.replace(/^\s+/, "");
  });
}

// --- content tabs -----------------------------------------------------------

export interface TabSpan {
  title: string;
  start: number; // the `=== "Title"` line
  end: number; // one past the last line of the body
}

/** Parses a set of tabs: the headers at our own level and the bounds of their bodies. */
export function parseTabs(lines: string[], baseIndent = ""): TabSpan[] {
  const head = new RegExp(`^${baseIndent}={3}\\+?\\s+"?([^"]*)"?\\s*$`);
  const spans: TabSpan[] = [];
  lines.forEach((line, i) => {
    const m = head.exec(line);
    if (m) {
      spans.push({ title: m[1], start: i, end: lines.length });
    }
  });
  spans.forEach((span, i) => {
    const next = spans[i + 1];
    let end = next ? next.start : lines.length;
    while (end > span.start + 1 && (lines[end - 1] ?? "").trim() === "") {
      end--;
    }
    span.end = end;
  });
  return spans;
}

/** A new tab at the end of the set (its body is a blank line for the cursor). */
export function addTab(lines: string[], title: string, baseIndent = ""): string[] {
  const out = [...lines];
  if (out.length > 0) {
    out.push("");
  }
  // The body of a new tab is a blank indented line: pymdownx treats the tab as
  // empty, and the editor puts the cursor into it (we do not write trailing
  // spaces).
  out.push(`${baseIndent}=== "${title}"`, "", "");
  return out;
}

export function removeTab(lines: string[], index: number, baseIndent = ""): string[] {
  const spans = parseTabs(lines, baseIndent);
  const span = spans[index];
  if (!span || spans.length <= 1) {
    return lines; // we do not delete the last tab — that would be deleting the block
  }
  const out = dropDoubleBlank([...lines.slice(0, span.start), ...lines.slice(span.end)]);
  // Blank lines at the block's edges belonged to the tab that was cut out.
  while (out.length > 0 && out[out.length - 1].trim() === "") {
    out.pop();
  }
  while (out.length > 0 && out[0].trim() === "") {
    out.shift();
  }
  return out;
}

export function renameTab(
  lines: string[],
  index: number,
  title: string,
  baseIndent = "",
): string[] {
  const span = parseTabs(lines, baseIndent)[index];
  if (!span) {
    return lines;
  }
  const out = [...lines];
  const marker = /^\s*===\+/.test(out[span.start]) ? "===+" : "===";
  out[span.start] = `${baseIndent}${marker} "${title}"`;
  return out;
}

/** Reordering a tab (dragging its label). */
export function moveTab(lines: string[], from: number, to: number, baseIndent = ""): string[] {
  const spans = parseTabs(lines, baseIndent);
  if (!spans[from] || !spans[to] || from === to) {
    return lines;
  }
  const chunks = spans.map((s) => lines.slice(s.start, s.end));
  const head = lines.slice(0, spans[0].start);
  const [moved] = chunks.splice(from, 1);
  chunks.splice(to, 0, moved);
  const out = [...head];
  chunks.forEach((chunk, i) => {
    if (i > 0) {
      out.push("");
    }
    out.push(...chunk);
  });
  return out;
}

// --- grid cards -------------------------------------------------------------

/** The bounds of the cards (list items) inside a grid block. */
export function parseCards(
  lines: string[],
  baseIndent = "",
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  lines.forEach((line, i) => {
    const item = parseListLine(line);
    if (item.marker !== "" && item.indent.length === baseIndent.length) {
      spans.push({ start: i, end: i + 1 });
    }
  });
  spans.forEach((span, i) => {
    const next = spans[i + 1];
    let end = next ? next.start : lines.length;
    // Blank lines and the block's closing tag (`</div>`) are not part of the card.
    while (end > span.start + 1) {
      const prev = lines[end - 1] ?? "";
      const closing = !next && /^\s*<\/\w+>/.test(prev);
      if (prev.trim() !== "" && !closing) {
        break;
      }
      end--;
    }
    span.end = end;
  });
  return spans;
}

export function addCard(lines: string[], title: string, baseIndent = ""): string[] {
  const spans = parseCards(lines, baseIndent);
  const at = spans.length > 0 ? spans[spans.length - 1].end : lines.length;
  const block = spans.length > 0 ? ["", `${baseIndent}- ${title}`] : [`${baseIndent}- ${title}`];
  return [...lines.slice(0, at), ...block, ...lines.slice(at)];
}

export function removeCard(lines: string[], index: number, baseIndent = ""): string[] {
  const spans = parseCards(lines, baseIndent);
  const span = spans[index];
  if (!span || spans.length <= 1) {
    return lines;
  }
  const out = [...lines.slice(0, span.start), ...lines.slice(span.end)];
  return dropDoubleBlank(out);
}

export function moveCard(lines: string[], from: number, to: number, baseIndent = ""): string[] {
  const spans = parseCards(lines, baseIndent);
  if (!spans[from] || !spans[to] || from === to) {
    return lines;
  }
  const chunks = spans.map((s) => lines.slice(s.start, s.end));
  const head = lines.slice(0, spans[0].start);
  const tail = lines.slice(spans[spans.length - 1].end);
  const [moved] = chunks.splice(from, 1);
  chunks.splice(to, 0, moved);
  const body: string[] = [];
  chunks.forEach((chunk, i) => {
    if (i > 0) {
      body.push("");
    }
    body.push(...chunk);
  });
  return [...head, ...body, ...tail];
}

/** Collapses consecutive blank lines that appeared after a cut. */
function dropDoubleBlank(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && out.length > 0 && out[out.length - 1].trim() === "") {
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Renumbering an ordered list after levels have been shifted: the items of each
 * level are counted anew, otherwise you end up with “1. 3. 4.”.
 */
export function renumber(lines: string[]): string[] {
  const counters = new Map<number, number>();
  let prevIndent = -1;
  return lines.map((line) => {
    const item = parseListLine(line);
    if (item.marker === "" || !/^\d+[.)]$/.test(item.marker)) {
      return line;
    }
    const level = item.indent.length;
    if (level > prevIndent) {
      counters.set(level, 0);
    }
    for (const key of Array.from(counters.keys())) {
      if (key > level) {
        counters.delete(key);
      }
    }
    const next = (counters.get(level) ?? 0) + 1;
    counters.set(level, next);
    prevIndent = level;
    const dot = item.marker.endsWith(")") ? ")" : ".";
    const box = item.checked === null ? "" : `[${item.checked ? "x" : " "}] `;
    return `${item.indent}${next}${dot} ${box}${item.text}`;
  });
}
