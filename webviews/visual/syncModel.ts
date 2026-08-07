// What the editor sends to the file, decided without touching the DOM.
//
// The visual editor knows the document as a list of top-level blocks, each
// either carrying a range of file lines or being a draft the file has not seen.
// Turning that state into a batch of edits is arithmetic — which lines to
// replace, where to insert, what to delete — and arithmetic is exactly what got
// a block cut out of a file when a detached node was mistaken for one the user
// had deleted. Here it is a pure function over a description of the blocks, so
// the cases can be written down as tests instead of clicked through by hand.

/** A replacement of the lines [start, end) with `text`; `end === start` inserts. */
export interface SyncEdit {
  start: number;
  end: number;
  text: string;
}

/** The lines of the file a block occupies. */
export interface BlockRange {
  start: number;
  end: number;
}

/** What the DOM says about one top-level block. */
export interface BlockView {
  /** The lines it occupies; absent for a draft the file has never seen. */
  range?: BlockRange;
  /** Its markdown. Absent when the block cannot be serialized at all. */
  text?: string;
  /** The user changed it since the last batch. */
  dirty?: boolean;
  /** Still in the document. A detached node is one the user removed. */
  connected?: boolean;
  /** An insert already in flight — its range arrives with the patch. */
  pending?: boolean;
  /** Service markup (the footnotes tail): neither a draft nor a file block. */
  service?: boolean;
  /** A live editor: it keeps its range and contributes no text. */
  live?: boolean;
}

export interface PlanInput {
  /** The blocks in document order, plus any detached ones still marked dirty. */
  blocks: BlockView[];
  /** The file as lines, without the trailing empty one. */
  lines: string[];
  /** Whether the file ends with a newline. */
  endsNL: boolean;
  /** Ranges of blocks removed from the DOM outright (seen by the observer). */
  removed?: BlockRange[];
  /** Edits to lines no block represents (footnote and abbreviation definitions). */
  sourceEdits?: SyncEdit[];
}

export interface EditPlan {
  edits: SyncEdit[];
  /** Indices of blocks that became inserts: mark them as in flight. */
  markPending: number[];
  /** Indices of blocks whose content was erased: drop their file range. */
  dropRange: number[];
  /** Indices of blocks handled by this batch: clear their dirty mark. */
  clearDirty: number[];
}

/** How many lines a piece of text adds. */
export function lineCountOf(text: string): number {
  if (text === "") {
    return 0;
  }
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

/** Deletes a block, absorbing the blank separator line that follows it. */
export function deleteEdit(start: number, end: number, lines: string[]): SyncEdit {
  let realEnd = end;
  if (realEnd < lines.length && (lines[realEnd] ?? "").trim() === "") {
    realEnd += 1;
  }
  return { start, end: realEnd, text: "" };
}

/** The inverse of a batch, in the coordinates of the document AFTER it is applied. */
export function invertEdits(edits: SyncEdit[], lines: string[]): SyncEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const inverse: SyncEdit[] = [];
  let delta = 0;
  for (const edit of sorted) {
    const newLines = lineCountOf(edit.text);
    const oldSlice = lines.slice(edit.start, edit.end);
    const start = edit.start + delta;
    if (edit.start === edit.end && edit.text !== "") {
      inverse.push({ start, end: start + newLines, text: "" });
    } else if (edit.text === "") {
      inverse.push({ start, end: start, text: oldSlice.join("\n") + "\n" });
    } else {
      inverse.push({ start, end: start + newLines, text: oldSlice.join("\n") + "\n" });
    }
    delta += newLines - (edit.end - edit.start);
  }
  return inverse;
}

/**
 * Two blocks claiming the same first line: pressing Enter inside a block splits
 * it, and the browser copies every attribute into the new half — data-src-*
 * included. Whoever comes first in document order keeps the range; the rest
 * become drafts and are inserted as new blocks.
 */
export function dropDuplicateRanges(blocks: BlockView[]): number[] {
  const seen = new Set<number>();
  const dropped: number[] = [];
  blocks.forEach((block, i) => {
    if (!block.range) {
      return;
    }
    if (seen.has(block.range.start)) {
      dropped.push(i);
      return;
    }
    seen.add(block.range.start);
  });
  return dropped;
}

/**
 * The batch: changed blocks become replacements, drafts with content become
 * inserts, erased ones and blocks the user removed become deletions. The ranges
 * are all in the coordinates of the CURRENT document, so the edits are
 * independent and apply as a single WorkspaceEdit.
 */
export function planEdits(input: PlanInput): EditPlan {
  const { blocks, lines, endsNL } = input;
  const edits: SyncEdit[] = [];
  const markPending: number[] = [];
  const dropRange: number[] = [];
  const clearDirty: number[] = [];

  const duplicates = new Set(dropDuplicateRanges(blocks));
  const seen = new Set<number>();
  let pendingNew: string[] = [];

  /** Drafts collected so far go in before the nearest following known block. */
  const flushNew = (anchor: number): void => {
    if (pendingNew.length === 0) {
      return;
    }
    const atEof = anchor >= lines.length;
    const before = anchor > 0 && (lines[anchor - 1] ?? "").trim() !== "";
    const after = !atEof && (lines[anchor] ?? "").trim() !== "";
    edits.push({
      start: anchor,
      end: anchor,
      // Inserting at the end of a file with no trailing newline needs one more
      // to close the last line.
      text:
        (atEof && !endsNL ? "\n" : "") +
        (before ? "\n" : "") +
        pendingNew.join("\n") +
        (after ? "\n" : ""),
    });
    pendingNew = [];
  };

  blocks.forEach((block, i) => {
    if (block.service || !block.connected) {
      return; // the footnotes tail is not content; detached ones are handled below
    }
    const range = duplicates.has(i) ? undefined : block.range;
    if (block.live) {
      seen.add(i);
      if (range) {
        flushNew(range.start);
      }
      return;
    }
    if (!range) {
      if (block.pending) {
        return; // already in flight — its range arrives with the patch
      }
      // A draft: empty ones are skipped, the rest become inserts.
      if ((block.text ?? "").trim() !== "") {
        pendingNew.push(block.text ?? "");
        markPending.push(i);
      }
      return;
    }
    seen.add(i);
    flushNew(range.start);
    if (!block.dirty) {
      return;
    }
    if (block.text === undefined) {
      clearDirty.push(i); // not serializable — leave the file alone
      return;
    }
    if (block.text.trim() === "") {
      // The user erased the content: the block leaves the file, while in the DOM
      // it stays as a draft so the caret is not lost.
      edits.push(deleteEdit(range.start, range.end, lines));
      dropRange.push(i);
    } else {
      edits.push({ start: range.start, end: range.end, text: block.text });
    }
    clearDirty.push(i);
  });
  flushNew(lines.length);

  // Blocks the user removed: they are known only through the dirty set, since
  // there is no node left in the document to walk to.
  blocks.forEach((block, i) => {
    if (block.dirty && !block.connected && block.range && !seen.has(i)) {
      edits.push(deleteEdit(block.range.start, block.range.end, lines));
    }
    if (block.dirty && !clearDirty.includes(i)) {
      clearDirty.push(i);
    }
  });

  // Deletions the observer saw directly, and edits to lines no block owns.
  for (const range of input.removed ?? []) {
    const del = deleteEdit(range.start, range.end, lines);
    const overlaps = edits.some((e) => !(del.end <= e.start || e.end <= del.start));
    if (!overlaps) {
      edits.push(del);
    }
  }
  edits.push(...(input.sourceEdits ?? []));

  return { edits, markPending, dropRange, clearDirty };
}
