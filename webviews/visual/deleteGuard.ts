// Deleting a selection that crosses structure.
//
// The browser's native answer to deleting a non-collapsed selection is to
// remove the range and MERGE the blocks at its two ends. Between two plain
// paragraphs that is what a text editor should do; across a container boundary
// it corrupts the document: cutting a tab set that stood before an admonition
// merged the admonition's title into the preceding paragraph — the file then
// read `Intro.Title` and `!!! success ""`. Backspace on a caret never takes
// this path, but Cut, typing over a selection and pasting over one all do.
//
// The guard watches beforeinput: when the selection is dangerous, the native
// deletion is cancelled and the range is deleted with Range.deleteContents,
// which never merges. The mutation observer sees an ordinary edit and syncs it.

/**
 * Elements whose boundary a native merge must not cross. Chrome elements
 * (a title, a summary, the tab labels) are listed on their own: a selection
 * from a title into the body would otherwise pull the body INTO the title.
 */
const STRUCTURE =
  ".admonition-title, summary, .tabbed-labels, .tabbed-block, .admonition, details, td, th";

function structureOf(node: Node | null, docEl: HTMLElement): Element | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!el || !docEl.contains(el)) {
    return null;
  }
  const hit = el.closest(STRUCTURE);
  return hit && docEl.contains(hit) ? hit : null;
}

/**
 * Whether deleting this selection natively could merge across structure: its
 * ends sit in different containers, or it swallows an island (a sealed,
 * contenteditable=false block — a tab set, a diagram) whose removal the
 * browser follows with a merge of the now-adjacent blocks.
 */
export function dangerousRange(range: Range, docEl: HTMLElement): boolean {
  if (range.collapsed) {
    return false;
  }
  // An endpoint at the root means whole blocks are selected. After deleting
  // such a range the browser merges whichever blocks became adjacent — cutting
  // a block that stood before an admonition pulled the admonition's title into
  // the paragraph above it.
  if (range.startContainer === docEl || range.endContainer === docEl) {
    return true;
  }
  if (structureOf(range.startContainer, docEl) !== structureOf(range.endContainer, docEl)) {
    return true;
  }
  const clone = range.cloneContents();
  return clone.querySelector('[contenteditable="false"]') !== null;
}

/** Deletes the range without letting any blocks merge, and settles the caret. */
export function deleteRangeSafely(range: Range, docEl: HTMLElement): void {
  range.deleteContents();
  const sel = document.getSelection();
  sel?.removeAllRanges();
  // deleteContents collapses the range to its start. A start that landed
  // between top-level blocks (an island was selected whole) is moved into the
  // edge of a neighbour — a caret directly in the root would type bare text there.
  if (range.startContainer === docEl) {
    const next = docEl.children[range.startOffset];
    const prev = docEl.children[range.startOffset - 1];
    const home = pickCaretHome(next) ?? pickCaretHome(prev);
    if (home) {
      range.selectNodeContents(home);
      range.collapse(home === pickCaretHome(next));
    }
  }
  sel?.addRange(range);
}

/** A block a caret can live in: editable, and not an island. */
function pickCaretHome(el: Element | undefined): Element | null {
  return el instanceof HTMLElement && el.getAttribute("contenteditable") !== "false" ? el : null;
}

/**
 * The beforeinput hook. Everything the browser deletes natively — Cut, typing
 * over a selection, a plain-text paste over one — announces itself here first.
 * (execCommand does not; callers of insertHTML run the guard by hand.)
 */
export function initDeleteGuard(docEl: HTMLElement): void {
  // Cut owns BOTH halves when the deletion is dangerous. Cancelling only the
  // deletion half (in beforeinput below) leaves the clipboard half to the
  // browser's cancelled default — whether it still writes is not promised
  // anywhere. So the selection is put on the clipboard here and deleted our
  // way, and nothing is left to the default action.
  docEl.addEventListener("cut", (e) => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || !e.clipboardData) {
      return;
    }
    const range = sel.getRangeAt(0);
    if (range.collapsed || !dangerousRange(range, docEl)) {
      return;
    }
    const box = document.createElement("div");
    box.appendChild(range.cloneContents());
    e.preventDefault();
    e.clipboardData.setData("text/html", box.innerHTML);
    e.clipboardData.setData("text/plain", range.toString());
    deleteRangeSafely(range, docEl);
  });

  docEl.addEventListener("beforeinput", (e) => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }
    const range = sel.getRangeAt(0);
    if (!dangerousRange(range, docEl)) {
      return;
    }
    const kind = e.inputType;
    if (kind.startsWith("delete")) {
      e.preventDefault();
      deleteRangeSafely(range, docEl);
      return;
    }
    // An insertion over the dangerous selection: delete our way, then let the
    // insertion happen at the now-collapsed caret.
    if (kind === "insertText" || kind === "insertParagraph" || kind === "insertLineBreak") {
      e.preventDefault();
      deleteRangeSafely(range, docEl);
      if (kind === "insertText" && e.data) {
        document.execCommand("insertText", false, e.data);
      } else if (kind === "insertParagraph") {
        document.execCommand("insertParagraph");
      } else if (kind === "insertLineBreak") {
        document.execCommand("insertLineBreak");
      }
      return;
    }
    if (kind === "insertFromPaste" || kind === "insertFromDrop") {
      // Only the plain-text path reaches here: a paste with HTML is taken over
      // by the paste handler before the browser gets to beforeinput.
      e.preventDefault();
      deleteRangeSafely(range, docEl);
      const text = e.dataTransfer?.getData("text/plain") ?? "";
      if (text) {
        document.execCommand("insertText", false, text);
      }
    }
  });
}
