import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { tokenizeIndented, findIndentedContentEnd, lineText } from "./blockUtils";

/**
 * The admonition + details plugin (pymdownx).
 *
 *   !!! type "Title"           → <div class="admonition type">
 *   ??? type "Title"           → <details class="admonition type">
 *   ???+ type "Title"          → <details class="admonition type" open>
 *
 * The content is indented by 4 spaces. The title is optional; empty quotes ("")
 * remove the title. Several type words → extra classes.
 */

const MARKER_RE = /^(!{3}|\?{3}\+?)\s+(.*)$/;

export function admonitionPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "admonition", admonitionRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.admonition_title_open = (tokens, idx, options, _env, self) =>
    self.renderToken(tokens, idx, options);
}

function admonitionRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  const markerIndent = state.sCount[startLine];
  if (markerIndent - state.blkIndent >= 4) {
    return false; // this is indented code already
  }
  const text = lineText(state, startLine);
  const match = MARKER_RE.exec(text);
  if (!match) {
    return false;
  }
  if (silent) {
    return true;
  }

  const marker = match[1];
  const isDetails = marker.startsWith("?");
  const isOpen = marker === "???+";
  const { classes, title, hasQuotes } = parseTypeAndTitle(match[2]);

  const contentIndent = markerIndent + 4;
  const lastContent = findIndentedContentEnd(state, startLine + 1, contentIndent);
  const contentEnd = lastContent === -1 ? startLine + 1 : lastContent + 1;

  const classStr = ["admonition", ...classes].join(" ");
  const tag = isDetails ? "details" : "div";

  const openToken = state.push("admonition_open", tag, 1);
  openToken.block = true;
  openToken.map = [startLine, contentEnd];
  openToken.attrSet("class", classStr);
  if (isOpen) {
    openToken.attrSet("open", "");
  }
  openToken.meta = { blockType: "admonition" };

  // Title: details always has a summary; on a div it is shown by default and is
  // removed only by explicit empty quotes (`!!! note ""`).
  const suppressed = hasQuotes && title === "";
  const showTitle = isDetails || !suppressed;
  if (showTitle) {
    const titleTag = isDetails ? "summary" : "p";
    const titleText = title !== "" ? title : defaultTitle(classes);
    const tOpen = state.push("admonition_title_open", titleTag, 1);
    tOpen.attrSet("class", "admonition-title");
    tOpen.map = [startLine, startLine + 1];

    const inline = state.push("inline", "", 0);
    inline.content = titleText;
    inline.map = [startLine, startLine + 1];
    inline.children = [];

    state.push("admonition_title_close", titleTag, -1);
  }

  if (contentEnd > startLine + 1) {
    tokenizeIndented(state, startLine + 1, contentEnd, contentIndent);
  }

  state.push("admonition_close", tag, -1);
  state.line = contentEnd;
  return true;
}

/** Parses `type1 type2 "Title"`. */
function parseTypeAndTitle(rest: string): { classes: string[]; title: string; hasQuotes: boolean } {
  const trimmed = rest.trim();
  const titleMatch = /"([^"]*)"\s*$/.exec(trimmed);
  let title = "";
  let typesPart = trimmed;
  const hasQuotes = titleMatch !== null;
  if (titleMatch) {
    title = titleMatch[1];
    typesPart = trimmed.slice(0, titleMatch.index).trim();
  }
  const classes = typesPart ? typesPart.split(/\s+/) : [];
  return { classes, title, hasQuotes };
}

function defaultTitle(classes: string[]): string {
  if (classes.length === 0) {
    return "";
  }
  const first = classes[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}
