/**
 * Clearing inline formatting (“Clear formatting”).
 *
 * Lives in a module of its own: the logic is non-trivial (splitting wrappers,
 * protecting service markup) and is covered by unit tests without launching the
 * editor. The rule is simple: we remove the styling (bold, italic, underline,
 * strikethrough, code, highlight) and keep the content — text, links, images,
 * footnotes, CriticMarkup edits, formulas, emoji.
 */

/** Inline tags that clearing removes. */
const CLEARABLE_TAGS = new Set([
  "STRONG",
  "B",
  "EM",
  "I",
  "S",
  "DEL",
  "STRIKE",
  "U",
  "INS",
  "MARK",
  "CODE",
  "KBD",
  "SUP",
  "SUB",
  "SMALL",
  "BIG",
  "VAR",
  "SAMP",
  "TT",
  "FONT",
]);

/** Markup that clearing must preserve: this is content, not styling. */
function isProtectedInline(el: Element): boolean {
  return (
    el.closest(".critic, .footnote-ref, .arithmatex, .twemoji, .md-annotation, pre, .vcode") !==
    null
  );
}

/** Removes inline styling inside a subtree (links and images stay). */
export function stripInlineFormatting(root: DocumentFragment | HTMLElement): void {
  const all = Array.from(root.querySelectorAll<HTMLElement>("*"));
  // Protection is computed BEFORE unwrapping: a removed ancestor can no longer
  // be found via closest.
  const guarded = new Set(all.filter((el) => isProtectedInline(el)));
  for (const el of all) {
    if (guarded.has(el) || !el.parentNode) {
      continue;
    }
    if (CLEARABLE_TAGS.has(el.tagName)) {
      while (el.firstChild) {
        el.parentNode.insertBefore(el.firstChild, el);
      }
      el.remove();
      continue;
    }
    if (el.tagName === "SPAN") {
      // contenteditable garbage of the form <span style="font-weight:700">.
      el.removeAttribute("style");
      el.removeAttribute("class");
    }
  }
}

/**
 * Lifts a node out of its clearable ancestors, splitting each into a “before”
 * and an “after”. Needed when part of the text inside existing markup is
 * cleared: `**all bold**` with the middle cleared must become
 * `**al**l bol**d**`.
 */
function liftOutOfFormatting(node: Node, limit: Element): void {
  let parent = node.parentElement;
  while (
    parent &&
    parent !== limit &&
    CLEARABLE_TAGS.has(parent.tagName) &&
    !isProtectedInline(parent)
  ) {
    const grand = parent.parentNode;
    if (!grand) {
      return;
    }
    const left = parent.cloneNode(false);
    const right = parent.cloneNode(false);
    while (parent.firstChild && parent.firstChild !== node) {
      left.appendChild(parent.firstChild);
    }
    parent.removeChild(node);
    while (parent.firstChild) {
      right.appendChild(parent.firstChild);
    }
    if (left.firstChild) {
      grand.insertBefore(left, parent);
    }
    grand.insertBefore(node, parent);
    if (right.firstChild) {
      grand.insertBefore(right, parent);
    }
    grand.removeChild(parent);
    parent = node.parentElement;
  }
}

/**
 * Clears a single piece of the selection (within the bounds of one block) and
 * returns the edges of the cleared text — the caller restores the selection
 * from them.
 */
export function clearRangePiece(piece: Range, block: Element): { first: Node; last: Node } | null {
  const frag = piece.extractContents();
  stripInlineFormatting(frag);
  // A temporary wrapper keeps the piece whole while the outer wrappers are split.
  const holder = block.ownerDocument.createElement("span");
  holder.appendChild(frag);
  piece.insertNode(holder);
  liftOutOfFormatting(holder, block);
  const first = holder.firstChild;
  const last = holder.lastChild;
  const parent = holder.parentNode;
  while (holder.firstChild) {
    parent?.insertBefore(holder.firstChild, holder);
  }
  holder.remove();
  // We do not merge adjacent text nodes (normalize): the selection is restored
  // from first/last, and merging would invalidate those references.
  return first && last ? { first, last } : null;
}
