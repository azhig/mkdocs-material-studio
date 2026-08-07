// The batch of edits the visual editor sends back.
//
// It arrives as a message from a webview, so nothing about its shape is
// guaranteed — and the values become document positions. A stray NaN would make
// vscode.Range throw from inside a message handler, where the failure is far
// from the cause; a negative or reversed range would delete the wrong lines.
// Reading the batch and refusing it as a whole is cheaper than defending every
// use of it downstream.

/** A replacement of the half-open line range [start, end) with `text`. */
export interface SyncEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Reads a batch that came from the webview. Returns undefined if anything about
 * it is off — the caller then rejects the batch and re-renders, which is what
 * already happens when the editor's text has moved on.
 */
export function parseSyncEdits(value: unknown): SyncEdit[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const edits: SyncEdit[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object") {
      return undefined;
    }
    const { start, end, text } = raw as { start?: unknown; end?: unknown; text?: unknown };
    if (!isLine(start) || !isLine(end) || typeof text !== "string" || start > end) {
      return undefined;
    }
    edits.push({ start, end, text });
  }
  return edits;
}

/** A line number: a whole number that is not negative, NaN or Infinity. */
function isLine(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
