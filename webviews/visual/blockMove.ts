/**
 * Moving a block and editing its source — line operations on the file.
 * A pure module with no DOM, covered by test/unit/blockMove.test.ts.
 *
 * Our block operations are markdown-first: both drag-and-drop and “Markdown
 * source” move/replace THE FILE'S LINES rather than rebuilding the DOM. For a
 * nested block this is essential: re-serializing the parent (an admonition,
 * tabs) would also rewrite the untouched sibling blocks, whereas a targeted
 * line edit leaves them byte for byte.
 */

export interface LineEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * The block's range together with its blank separator line: when a block is
 * moved the separator has to travel with it, otherwise a hole of two blank
 * lines stays behind and at the new place the block sticks to its neighbour.
 * The last block of the file has no separator below it — we take the one above
 * instead, otherwise the file would be left with a blank tail.
 */
export function blockSpan(
  lines: string[],
  start: number,
  end: number,
): { start: number; end: number } {
  if (end < lines.length && (lines[end] ?? "").trim() === "") {
    return { start, end: end + 1 };
  }
  if (end >= lines.length && start > 0 && (lines[start - 1] ?? "").trim() === "") {
    return { start: start - 1, end };
  }
  return { start, end };
}

/**
 * The edits that move the block `[start, end)` to line `anchor` (inserting
 * BEFORE it; `anchor === lines.length` means the end of the file). Both edits
 * are in the coordinates of the ORIGINAL text and do not overlap, so they are
 * applied as a single WorkspaceEdit.
 *
 * An empty array means “nowhere to move”: the anchor is inside the block itself.
 */
export function moveBlockEdits(
  lines: string[],
  start: number,
  end: number,
  anchor: number,
  endsNL = true,
): LineEdit[] {
  const span = blockSpan(lines, start, end);
  if (anchor >= span.start && anchor <= span.end) {
    return []; // back onto its own spot — no edit needed
  }
  const body = lines.slice(start, end).join("\n") + "\n";
  const atEof = anchor >= lines.length;
  // Separators are decided by the neighbours at the insertion point: a blank
  // line is only needed where there is none yet, otherwise the document keeps
  // accumulating extra blank lines.
  const before = anchor > 0 && (lines[anchor - 1] ?? "").trim() !== "";
  const after = !atEof && (lines[anchor] ?? "").trim() !== "";
  const text = (atEof && !endsNL ? "\n" : "") + (before ? "\n" : "") + body + (after ? "\n" : "");
  return [
    { start: span.start, end: span.end, text: "" },
    { start: anchor, end: anchor, text },
  ];
}

/**
 * Strips the common indent of a nested block: in the source editor the user
 * sees the markdown without the “service” four spaces of the admonition/tab and
 * edits it as plain text. The indent is put back on save (indentLines).
 */
export function dedentLines(lines: string[]): { indent: string; lines: string[] } {
  let indent: string | null = null;
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    const cur = /^[ \t]*/.exec(line)?.[0] ?? "";
    if (indent === null || cur.length < indent.length) {
      indent = cur;
    }
  }
  if (!indent) {
    return { indent: "", lines };
  }
  const width = indent.length;
  return {
    indent,
    lines: lines.map((l) => (l.startsWith(indent) ? l.slice(width) : l.trimStart())),
  };
}

/** Puts the common indent back on non-empty lines (empty ones stay empty). */
export function indentLines(lines: string[], indent: string): string[] {
  if (indent === "") {
    return lines;
  }
  return lines.map((l) => (l.trim() === "" ? "" : indent + l));
}
