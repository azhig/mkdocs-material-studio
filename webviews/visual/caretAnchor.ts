// Where the caret was, in terms that survive the document being redrawn.
//
// A full render replaces every block of #doc. The nodes the selection pointed
// at are detached, and what the browser leaves behind is a selection at the
// very start of the editor: the page jumps to the top and the next keystroke
// lands in the first paragraph of the file. The anchor is taken before the
// replacement and put back after it, in coordinates the new DOM still has —
// which block, and how many characters into its text.
//
// The block is found by position first and by its source line second: an
// outside edit above the caret shifts the lines of everything below it while
// the order of the blocks stays as it was.

/** The caret's place in a document that is about to be redrawn. */
export interface CaretAnchor {
  /** Position of the block among the editor's children. */
  index: number;
  /** Characters of the block's own text before the caret. */
  offset: number;
  /**
   * The block's text — what the block is recognised by afterwards. An edit
   * above the caret moves the block down AND renumbers its source lines, so
   * neither coordinate survives on its own; the line the author was in reads
   * the same either way.
   */
  text: string;
  /**
   * Distance from the top of the viewport to the caret. The render changes the
   * height of everything above it — diagrams are drawn again from their source
   * — so keeping the scroll position would move the line under the reader's
   * eyes; keeping the caret where it was on screen does not.
   */
  screenTop: number | null;
}

/**
 * Text the caret cannot be in: the pieces the engine draws (a diagram, a
 * formula, a rendered key combination) and the editor's own controls. Their
 * text is not part of what the author typed, so it is left out of the count on
 * the way in and skipped on the way out.
 */
const NOT_TEXT = '[contenteditable="false"], .vgctl, .isl-tools';

function isCountable(node: Text, block: Element): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }
  const skipped = parent.closest(NOT_TEXT);
  return skipped === null || !block.contains(skipped);
}

/** The text nodes of a block that hold what the author typed, in order. */
function textNodes(block: Element): Text[] {
  const doc = block.ownerDocument;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (isCountable(node, block)) {
      found.push(node);
    }
  }
  return found;
}

/** Everything the author typed in the block, as one string. */
function blockText(block: Element): string {
  return textNodes(block)
    .map((node) => node.data)
    .join("");
}

/** The top-level block of the editor that holds the node, if any. */
function topBlockOf(docEl: HTMLElement, node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.parentNode !== docEl) {
    el = el.parentNode;
  }
  return el instanceof HTMLElement ? el : null;
}

/** How many characters of the block's text stand before (container, offset). */
function offsetWithin(block: Element, container: Node, offset: number): number {
  const nodes = textNodes(block);
  if (container.nodeType === Node.TEXT_NODE) {
    let seen = 0;
    for (const node of nodes) {
      if (node === container) {
        return seen + Math.min(offset, node.data.length);
      }
      seen += node.data.length;
    }
    return seen;
  }
  // A position between children (an empty paragraph, the point right after an
  // image): everything up to the child at `offset` counts.
  const boundary = container.childNodes[offset] ?? null;
  let seen = 0;
  for (const node of nodes) {
    if (boundary && !(boundary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) {
      break; // this node starts at or after the boundary — it is past the caret
    }
    seen += node.data.length;
  }
  return seen;
}

/** The text node and offset that sit `offset` characters into the block. */
function pointAt(block: Element, offset: number): { node: Node; offset: number } {
  const nodes = textNodes(block);
  let seen = 0;
  for (const node of nodes) {
    if (seen + node.data.length >= offset) {
      return { node, offset: offset - seen };
    }
    seen += node.data.length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.data.length } : { node: block, offset: 0 };
}

/** Where the caret sits on screen, or null when the browser will not say. */
function caretScreenTop(range: Range, block: Element): number | null {
  const rect = range.getBoundingClientRect();
  if (rect.height > 0 || rect.top !== 0) {
    return rect.top;
  }
  // A collapsed range in an empty line measures as nothing — the block it is
  // in is the next best thing. In happy-dom every rectangle is zero, and the
  // scroll is simply left alone.
  const blockRect = block.getBoundingClientRect();
  return blockRect.height > 0 || blockRect.top !== 0 ? blockRect.top : null;
}

/**
 * Takes the anchor before a render. Returns null when the caret is not in the
 * document — there is then nothing to keep, and nothing that may be moved.
 */
export function takeCaretAnchor(docEl: HTMLElement): CaretAnchor | null {
  const sel = docEl.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  const range = sel.getRangeAt(0);
  if (!docEl.contains(range.startContainer)) {
    return null;
  }
  const block = topBlockOf(docEl, range.startContainer);
  if (!block) {
    return null;
  }
  return {
    index: Array.prototype.indexOf.call(docEl.children, block),
    offset: offsetWithin(block, range.startContainer, range.startOffset),
    text: blockText(block),
    screenTop: caretScreenTop(range, block),
  };
}

/**
 * The block the anchor points at in the document as it is now.
 *
 * What the line says is the strongest evidence there is: an edit above the
 * caret moves the block down AND renumbers its source lines, so a block picked
 * by position alone can easily be the wrong one — and the wrong one is where
 * the author's next word would go. Position only breaks the tie between lines
 * that read the same, which a document has plenty of, and stands in when the
 * render changed the text itself (a formatter over the file, a rewritten
 * sentence).
 */
function anchoredBlock(docEl: HTMLElement, anchor: CaretAnchor): HTMLElement | null {
  const children = Array.from(docEl.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
  const byIndex = children[anchor.index];
  if (byIndex && blockText(byIndex) === anchor.text) {
    return byIndex; // nothing moved — the usual case
  }
  if (anchor.text.trim() === "") {
    // An empty line is evidence of nothing: every blank paragraph in the
    // document reads the same, and the nearest of them is as likely to be the
    // draft at the end of a card as the line the author was in.
    return byIndex ?? null;
  }
  let nearest: { block: HTMLElement; distance: number } | undefined;
  children.forEach((block, at) => {
    const distance = Math.abs(at - anchor.index);
    if (blockText(block) === anchor.text && (!nearest || distance < nearest.distance)) {
      nearest = { block, distance };
    }
  });
  return nearest?.block ?? byIndex ?? null;
}

/**
 * Puts the caret back where the anchor says, and the page back under it.
 * Reports whether it found a place: a caller that gets false has a document
 * whose blocks no longer match the one the anchor was taken from.
 */
export function restoreCaretAnchor(docEl: HTMLElement, anchor: CaretAnchor | null): boolean {
  if (!anchor) {
    return false;
  }
  const block = anchoredBlock(docEl, anchor);
  if (!block) {
    return false;
  }
  const point = pointAt(block, anchor.offset);
  const doc = docEl.ownerDocument;
  const range = doc.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  const sel = doc.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  if (anchor.screenTop !== null) {
    const now = caretScreenTop(range, block);
    const drift = now === null ? 0 : now - anchor.screenTop;
    if (drift !== 0) {
      doc.defaultView?.scrollBy(0, drift);
    }
  }
  return true;
}
