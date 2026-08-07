// Applying a batch of edits to text the way the provider applies it.
//
// The visual editor sends line ranges; the provider turns them into a
// WorkspaceEdit whose offsets are all taken in the document as it was, and VS
// Code then splices them from the end backwards. A test that applied the edits
// any other way would pass on a batch the real editor mangles, so this is the
// reference both the editPlan tests and the insertion matrix run against.

import {
  planEditOps,
  type DocPosition,
  type EditOp,
  type LineDoc,
} from "../../../src/wysiwyg/editPlan";
import type { SyncEdit } from "../../../src/wysiwyg/syncEdits";

/** A document seen the way vscode.TextDocument reports it. */
export function docOf(text: string): LineDoc {
  const lines = text.split("\n");
  return { lineCount: lines.length, lineLength: (i) => (lines[i] ?? "").length };
}

/** Offset of the start of every line. */
function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/** Applies the operations the way a WorkspaceEdit does: all against the original. */
export function applyOps(text: string, ops: EditOp[]): string {
  const offsets = lineOffsets(text);
  const at = (p: DocPosition): number => (offsets[p.line] ?? text.length) + p.ch;
  const spans = ops.map((op) =>
    op.kind === "insert"
      ? { start: at(op.at), end: at(op.at), text: op.text }
      : { start: at(op.start), end: at(op.end), text: op.kind === "replace" ? op.text : "" },
  );
  spans.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const s of spans) {
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return out;
}

/** The whole trip: a batch against this text gives that text. */
export function applyBatch(text: string, edits: readonly SyncEdit[]): string {
  return applyOps(text, planEditOps(docOf(text), edits));
}
