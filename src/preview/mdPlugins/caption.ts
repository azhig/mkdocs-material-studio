import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { lineText } from "./blockUtils";

/**
 * Caption blocks (pymdownx.blocks.caption), the Material way to caption an
 * image or a table:
 *
 *   ![alt](img.png){ width="300" }
 *   /// caption
 *   Caption
 *   ///
 *
 * Wraps the immediately preceding block in <figure> and appends a
 * <figcaption> holding the content. In the visual editor a figure is editable as text
 * only (a safe fallback — the original markup is not mangled).
 */

const OPEN_RE = /^\/\/\/\s+caption\s*$/;
const CLOSE_RE = /^\/\/\/\s*$/;

export function captionPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "caption_block", captionRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}

function captionRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }
  if (!OPEN_RE.test(lineText(state, startLine))) {
    return false;
  }
  // Look for the closing `///` line.
  let closeLine = -1;
  for (let line = startLine + 1; line < endLine; line++) {
    if (CLOSE_RE.test(lineText(state, line))) {
      closeLine = line;
      break;
    }
  }
  if (closeLine === -1) {
    return false;
  }
  if (silent) {
    return true;
  }

  // Index where the preceding top-level block starts (by nesting balance).
  let level = 0;
  let startIdx = -1;
  for (let i = state.tokens.length - 1; i >= 0; i--) {
    level += state.tokens[i].nesting;
    if (level === 0) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    return false;
  }

  const prevStartMap = state.tokens[startIdx].map?.[0] ?? startLine;

  const figureOpen = new state.Token("figure_open", "figure", 1);
  figureOpen.block = true;
  figureOpen.map = [prevStartMap, closeLine + 1];
  figureOpen.meta = { blockType: "figure" };
  state.tokens.splice(startIdx, 0, figureOpen);

  // The caption content (one or more lines) — as inline.
  const capText: string[] = [];
  for (let line = startLine + 1; line < closeLine; line++) {
    capText.push(lineText(state, line).trim());
  }
  const capOpen = state.push("figcaption_open", "figcaption", 1);
  capOpen.map = [startLine, closeLine + 1];
  const inline = state.push("inline", "", 0);
  inline.content = capText.join("\n");
  inline.map = [startLine + 1, closeLine];
  inline.children = [];
  state.push("figcaption_close", "figcaption", -1);
  state.push("figure_close", "figure", -1);

  state.line = closeLine + 1;
  return true;
}
