import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

/**
 * Tokenizes a range of lines as a nested block with the given indent.
 *
 * Used by the pymdownx container constructs (admonition, tabbed), where the
 * content is set off by a 4-space indent. Preserves the line token.map, which
 * matters for scroll sync and click-to-edit (M6).
 */
export function tokenizeIndented(
  state: StateBlock,
  startLine: number,
  endLine: number,
  blkIndent: number,
): void {
  const oldParentType = state.parentType;
  const oldLineMax = state.lineMax;
  const oldBlkIndent = state.blkIndent;

  state.blkIndent = blkIndent;
  state.lineMax = endLine;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (state as any).parentType = "root";
  state.md.block.tokenize(state, startLine, endLine);

  state.blkIndent = oldBlkIndent;
  state.lineMax = oldLineMax;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (state as any).parentType = oldParentType;
}

/**
 * Determines the line range of an indented block's content.
 * The content is the lines indented >= contentIndent; blank lines are allowed.
 * Returns the index of the last non-blank content line (inclusive), or -1.
 *
 * The search stops at endLine — the bound the block rule was called with. That
 * is not always state.lineMax: a blockquote ended by a blank line tokenizes its
 * body with a narrower end and leaves lineMax alone, so a container inside the
 * quote that trusted lineMax would reach past the quote and swallow whatever
 * follows it.
 */
export function findIndentedContentEnd(
  state: StateBlock,
  startLine: number,
  contentIndent: number,
  endLine: number,
): number {
  const last = Math.min(endLine, state.lineMax);
  let lastContent = -1;
  let line = startLine;
  while (line < last) {
    const isEmpty = state.isEmpty(line);
    if (isEmpty) {
      line++;
      continue;
    }
    if (state.sCount[line] < contentIndent) {
      break;
    }
    lastContent = line;
    line++;
  }
  return lastContent;
}

/** Text of a line, respecting its boundaries. */
export function lineText(state: StateBlock, line: number): string {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}
