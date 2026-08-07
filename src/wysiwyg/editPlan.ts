// Where a batch of edits lands in the file.
//
// The visual editor sends line ranges; the file needs character positions. The
// translation is small but every case in it is a way to eat the document: a
// replacement reaching the end of the file adds a newline that was never there,
// an insert past the last line has nowhere to go, a range built from a stale
// line count deletes the wrong text. It used to live inside the provider, where
// the only way to check it was to type into a real editor and look. Here it is
// arithmetic over a description of the document, so the cases can be written
// down as tests.

import type { SyncEdit } from "./syncEdits";

/** The little a document has to tell us for an edit to be placed in it. */
export interface LineDoc {
  /** Number of lines; a document always has at least one, possibly empty. */
  readonly lineCount: number;
  /** Length of the given line, without its newline. */
  lineLength(line: number): number;
}

/** A position in the document: a line and an offset within it. */
export interface DocPosition {
  line: number;
  ch: number;
}

/** One operation on the document, ready to become a WorkspaceEdit call. */
export type EditOp =
  | { kind: "insert"; at: DocPosition; text: string }
  | { kind: "delete"; start: DocPosition; end: DocPosition }
  | { kind: "replace"; start: DocPosition; end: DocPosition; text: string };

/**
 * Turns a batch into operations. The ranges are all in the coordinates of the
 * document as it is now, so the operations are independent and apply together —
 * one operation per edit, in the order they arrived.
 */
export function planEditOps(doc: LineDoc, edits: readonly SyncEdit[]): EditOp[] {
  return edits.map((edit) => {
    if (edit.start === edit.end && edit.text !== "") {
      return { kind: "insert", at: insertPosition(doc, edit.start), text: edit.text };
    }
    const { start, end } = lineRange(doc, edit.start, edit.end);
    if (edit.text === "") {
      return { kind: "delete", start, end };
    }
    return { kind: "replace", start, end, text: closeText(doc, edit) };
  });
}

/** The range [startLine, endLine), with the end of the file handled properly. */
export function lineRange(
  doc: LineDoc,
  startLine: number,
  endLine: number,
): { start: DocPosition; end: DocPosition } {
  const last = lastLine(doc);
  const start = { line: Math.max(0, Math.min(startLine, last)), ch: 0 };
  // Past the last line there is no line 0 to stop at: the range has to end where
  // the text does, otherwise it would reach for a position the file has not got.
  if (endLine >= doc.lineCount) {
    return { start, end: { line: last, ch: doc.lineLength(last) } };
  }
  return { start, end: { line: endLine, ch: 0 } };
}

/**
 * A block's markdown ends with a newline. When the replacement reaches the end
 * of the file that newline has nothing to close — it would add an empty line to
 * the document on every save.
 */
export function closeText(doc: LineDoc, edit: SyncEdit): string {
  return edit.end >= doc.lineCount ? edit.text.replace(/\n$/, "") : edit.text;
}

/** Where an insert at the given line goes; past the end that is the end. */
export function insertPosition(doc: LineDoc, line: number): DocPosition {
  if (line >= doc.lineCount) {
    const last = lastLine(doc);
    return { line: last, ch: doc.lineLength(last) };
  }
  return { line, ch: 0 };
}

function lastLine(doc: LineDoc): number {
  return Math.max(0, doc.lineCount - 1);
}
