// The text the visual editor is working on, before it is written to the file.
//
// The editor used to write every keystroke straight into the TextDocument. That
// is what VS Code's own editors do — but it made the file dirty a few times a
// second, and with auto-save on, each of those saves ran whatever formatters
// the project has. Every one of them came back as somebody else's edit, and the
// page was redrawn under the author's hands.
//
// So the working text lives here instead: batches from the webview are applied
// to a plain string, the page is rendered from it, and the document is touched
// once — when the author saves. This module is the arithmetic of that, with no
// vscode in sight.

import type { SyncEdit } from "./syncEdits";

/** Splits text into lines, remembering whether the last one ended in a newline. */
function toLines(text: string): { lines: string[]; endsNL: boolean } {
  const endsNL = text === "" || text.endsWith("\n");
  const lines = text.split("\n");
  if (endsNL && lines.length > 0) {
    lines.pop();
  }
  return { lines, endsNL };
}

function fromLines(lines: string[], endsNL: boolean): string {
  return lines.length === 0 ? "" : lines.join("\n") + (endsNL ? "\n" : "");
}

/**
 * Applies a batch to the text. The ranges are all in the coordinates of the
 * text as it is now — the same contract the document edits have — so they are
 * applied from the bottom up and do not move one another.
 */
export function applySyncEdits(text: string, edits: readonly SyncEdit[]): string {
  const { lines, endsNL } = toLines(text);
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (const edit of sorted) {
    const replacement = edit.text === "" ? [] : edit.text.replace(/\n$/, "").split("\n");
    lines.splice(edit.start, edit.end - edit.start, ...replacement);
  }
  return fromLines(lines, endsNL || lines.length === 0);
}

/**
 * The one edit that turns `from` into `to`: the lines they share at the top and
 * at the bottom are left alone, and everything between them is replaced.
 *
 * One edit rather than a minimal diff on purpose. It is a single undo step, and
 * the region it touches is the region the author has been working in — a real
 * diff would buy a smaller range at the price of a batch whose parts have to be
 * reasoned about together. Returns undefined when the two are already equal.
 */
export function draftEdit(from: string, to: string): SyncEdit | undefined {
  if (from === to) {
    return undefined;
  }
  const before = toLines(from);
  const after = toLines(to);
  let head = 0;
  while (
    head < before.lines.length &&
    head < after.lines.length &&
    before.lines[head] === after.lines[head]
  ) {
    head++;
  }
  let tail = 0;
  while (
    tail < before.lines.length - head &&
    tail < after.lines.length - head &&
    before.lines[before.lines.length - 1 - tail] === after.lines[after.lines.length - 1 - tail]
  ) {
    tail++;
  }
  const end = before.lines.length - tail;
  const replacement = after.lines.slice(head, after.lines.length - tail);
  // A replacement that reaches the end of the file carries no trailing newline
  // of its own: the file's last line keeps whatever ending it had. Anywhere
  // else the lines are joined the way the batch format expects them.
  const atEnd = end >= before.lines.length;
  const text =
    replacement.length === 0 ? "" : replacement.join("\n") + (atEnd && !after.endsNL ? "" : "\n");
  return { start: head, end, text };
}

/** Whether the draft has anything in it the file does not. */
export function isDraftDirty(fileText: string, draft: string): boolean {
  return fileText !== draft;
}
