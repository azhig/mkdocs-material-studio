// The clipboard for whole blocks.
//
// Two clipboards, always written together. The SYSTEM one carries the block in
// both flavours — the Markdown as text (that is what a plain editor, a chat
// window or another VS Code tab gets) and the rendered HTML (that is what our
// own paste path rebuilds the block from). Our OWN one keeps the same Markdown
// in a variable, because a webview is not always allowed to touch the system
// clipboard at all: without that copy a cut took the block out of the file and
// Cmd+V had nothing to put back.

/** The Markdown of the last block that was copied or cut. */
let blockClipboard = "";

/** Remembers what Cut/Copy took, for a paste the system clipboard cannot serve. */
export function rememberBlockClipboard(text: string): void {
  blockClipboard = text;
}

/**
 * Whether pasted plain text is our own last Cut/Copy — i.e. Markdown. Cmd+V of
 * such text must build the block, not glue `!!! note` into a paragraph as
 * literal characters.
 */
export function ownBlockClipboard(text: string): boolean {
  return blockClipboard.trim() !== "" && text.trim() === blockClipboard.trim();
}

/** The last block taken, for a paste that arrived with nothing on it at all. */
export function lastBlockClipboard(): string {
  return blockClipboard;
}

/**
 * Puts a block on the system clipboard, SYNCHRONOUSLY, and remembers it here.
 *
 * NOT `navigator.clipboard.write`: that is a promise a VS Code webview does not
 * always keep — the permission is not granted there and `ClipboardItem` may be
 * missing outright, so the cut took the block out of the file and put it
 * nowhere. `execCommand("copy")` over a hidden selection always fires a trusted
 * `copy` event, and the handler below fills both flavours by hand.
 *
 * Returns whether the system clipboard was actually written; our own copy is
 * kept either way.
 */
export function writeBlockClipboard(markdown: string, html: string): boolean {
  rememberBlockClipboard(markdown);
  const holder = document.createElement("div");
  holder.setAttribute("contenteditable", "true");
  // Off-screen rather than display:none — a hidden node cannot be selected, and
  // without a selection execCommand("copy") does nothing.
  holder.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0;";
  holder.textContent = markdown;
  document.body.appendChild(holder);
  const sel = document.getSelection();
  const saved = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  const range = document.createRange();
  range.selectNodeContents(holder);
  sel?.removeAllRanges();
  sel?.addRange(range);
  let written = false;
  const onCopy = (e: ClipboardEvent): void => {
    e.preventDefault();
    e.clipboardData?.setData("text/plain", markdown);
    e.clipboardData?.setData("text/html", html);
    written = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } catch {
    /* no execCommand (an old engine, or a test DOM) — see the fallback below */
  } finally {
    document.removeEventListener("copy", onCopy, true);
    holder.remove();
    sel?.removeAllRanges();
    if (saved) {
      sel?.addRange(saved);
    }
  }
  if (!written) {
    // An engine without execCommand: the asynchronous API is worth a try after all.
    void navigator.clipboard?.writeText?.(markdown).catch(() => {
      /* no system clipboard — our own copy still answers Cmd+V */
    });
  }
  return written;
}

/** What the system clipboard holds as text, or our own copy when it is unreadable. */
export async function readBlockClipboard(): Promise<string> {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* no access to the system clipboard — use our own */
  }
  return text.trim() ? text : blockClipboard;
}
