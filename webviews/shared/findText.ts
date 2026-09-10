/**
 * The page as text the finder can work on, and the way back from a match to the
 * DOM: which text nodes it covers, and what has to be opened for it to be seen.
 *
 * Only reading happens here — the highlight itself never touches the document
 * (see findBar.ts), because in the visual editor every DOM change is an edit of
 * the author's file.
 *
 * Covered by test/unit/findText.test.ts.
 */

import type { FindMatch } from "./findModel";

export interface TextChunk {
  /** The text node the chunk came from; null for an artificial block boundary. */
  node: Text | null;
  text: string;
}

/**
 * Interface furniture, not content: the copy button of a code block, the tools
 * hanging off an island, the editor's popups. A search that walked into these
 * would report matches nobody can point at, and “Copy” would be a hit on every
 * page with code in it.
 */
const SKIP =
  "script, style, template, noscript, .md-code__nav, .isl-tools, .vpop, .vbubble," +
  " .vlive-bar, .vtable-menu, .vtip, [data-find-skip]";

/**
 * Tags that end a run of text. Anything else — `<b>`, `<a>`, `<code>` — is part
 * of the sentence around it, so a match may run straight through it.
 */
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BR",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

const BOUNDARY = "\n";

/**
 * The text of the subtree, chunk by chunk, in reading order.
 *
 * Hidden carriers are left out — the footnote definitions block is `hidden` and
 * holds the same text as the notes drawn at the bottom of the page, so counting
 * it would report every footnote twice. A collapsed call-out or an unopened tab
 * IS searched: what is folded away is still on the page, and `revealMatch`
 * opens it when the reader gets there.
 */
export function collectChunks(root: Element): TextChunk[] {
  const chunks: TextChunk[] = [];
  const pushBoundary = (): void => {
    if (chunks.length > 0 && chunks[chunks.length - 1].text !== BOUNDARY) {
      chunks.push({ node: null, text: BOUNDARY });
    }
  };
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return (node.nodeValue ?? "") === ""
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
        const el = node as Element;
        if ((el as HTMLElement).hidden || el.matches(SKIP)) {
          return NodeFilter.FILTER_REJECT;
        }
        return BLOCK_TAGS.has(el.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push({ node: node as Text, text: node.nodeValue ?? "" });
    } else {
      pushBoundary();
    }
  }
  return chunks;
}

/** The chunk texts, as the pure finder wants them. */
export function chunkTexts(chunks: readonly TextChunk[]): string[] {
  return chunks.map((c) => c.text);
}

/** A DOM range over the match, or null if it fell entirely on boundaries. */
export function rangeOfMatch(chunks: readonly TextChunk[], match: FindMatch): Range | null {
  const real = match.parts.filter((p) => chunks[p.chunk]?.node);
  if (real.length === 0) {
    return null;
  }
  const first = real[0];
  const last = real[real.length - 1];
  const firstNode = chunks[first.chunk].node as Text;
  const range = firstNode.ownerDocument.createRange();
  range.setStart(firstNode, Math.min(first.start, firstNode.length));
  const lastNode = chunks[last.chunk].node as Text;
  range.setEnd(lastNode, Math.min(last.end, lastNode.length));
  return range;
}

/**
 * Opens whatever hides the match: a folded call-out (`<details>`) and every tab
 * it sits in. Returns whether anything was opened — the caller needs to know,
 * because in the editor this is a DOM change and has to be made in the editor's
 * own “this was not the author” mode, and because the layout it moves has to
 * settle before the scroll is measured.
 */
export function revealMatch(node: Node, root: Element): boolean {
  let opened = false;
  let el: Element | null = node.parentElement;
  while (el && el !== root.parentElement) {
    if (el.tagName === "DETAILS" && !(el as HTMLDetailsElement).open) {
      (el as HTMLDetailsElement).open = true;
      opened = true;
    }
    if (el.classList.contains("tabbed-block") && selectTab(el)) {
      opened = true;
    }
    el = el.parentElement;
  }
  return opened;
}

/** Checks the radio of the tab this block belongs to (the Material markup). */
function selectTab(block: Element): boolean {
  const content = block.parentElement;
  const set = content?.parentElement;
  if (!content || !set || !set.classList.contains("tabbed-set")) {
    return false;
  }
  const index = Array.from(content.children).indexOf(block);
  const input = set.querySelectorAll<HTMLInputElement>(":scope > input[type=radio]")[index];
  if (!input || input.checked) {
    return false;
  }
  input.checked = true;
  return true;
}
