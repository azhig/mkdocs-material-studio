// Deciding whether a block on the page has to be redrawn at all.
//
// After every edit the editor lines a fresh render up against the blocks on
// screen and replaces them one for one. Replacing them ALL is what it used to
// do, and on a page of two hundred blocks a single keystroke rebuilt two
// hundred nodes and every piece of chrome hanging off them — around a third of
// a second of blocked main thread per letter, which is what typing lag is.
//
// Almost none of those blocks had changed. The one thing that had moved in most
// of them was the file line they sit on, which shifts for everything below a
// paragraph the author opens — so the comparison is markup WITHOUT the lines,
// and the lines are handed over on their own.

/** Line numbers, wherever they sit: the block, a table row, a call-out's body. */
const SRC_LINE_ATTR = / data-src-(?:line|end)="\d+"/g;

/**
 * What a block says, as markup, with the file lines left out. Two blocks with
 * the same key are the same block as far as the page is concerned.
 */
export function renderKey(el: Element): string {
  return el.outerHTML.replace(SRC_LINE_ATTR, "");
}

/** The attributes that say where in the file a block came from. */
export function copySrcAttrs(from: Element, to: Element): void {
  for (const name of ["data-src-line", "data-src-end", "data-block-type"]) {
    const v = from.getAttribute(name);
    if (v !== null) {
      to.setAttribute(name, v);
    }
  }
}

/**
 * Hands a fresh render's line numbers to the block already on the page — every
 * one of them, down through the table rows and the call-out's paragraphs the
 * editor edits by line. It is only ever called for two blocks with the same
 * key, so they have the same shape and pair up in order; the length check is
 * there to make that an assumption the code states rather than one it relies on.
 */
export function copyNestedSrcAttrs(from: Element, to: Element): void {
  const source = from.querySelectorAll("[data-src-line]");
  const target = to.querySelectorAll("[data-src-line]");
  if (source.length !== target.length) {
    return;
  }
  for (let i = 0; i < source.length; i++) {
    copySrcAttrs(source[i], target[i]);
  }
}
