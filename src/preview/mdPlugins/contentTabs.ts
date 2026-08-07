import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { tokenizeIndented, findIndentedContentEnd, lineText } from "./blockUtils";

/**
 * Content tabs plugin (pymdownx.tabbed, alternate_style).
 *
 *   === "Tab A"
 *       content A
 *   === "Tab B"
 *       content B
 *
 * Consecutive `=== "..."` markers are merged into a single tab set.
 * Emits the Material HTML structure (tabbed-set/tabbed-labels/tabbed-content).
 */

const MARKER_RE = /^===(\+)?\s+"([^"]*)"\s*$/;

interface TabEnv {
  tabbedCounter?: number;
}

export function contentTabsPlugin(md: MarkdownIt): void {
  md.block.ruler.before("fence", "content_tabs", tabsRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.tabbed_set_open = (tokens, idx) => {
    const token = tokens[idx];
    const setId = token.meta.setId as number;
    const count = token.meta.count as number;
    // A custom renderer must carry the source markers over from token.attrs itself.
    const srcLine = token.attrGet("data-src-line");
    const srcEnd = token.attrGet("data-src-end");
    const srcAttrs = srcLine
      ? ` data-src-line="${srcLine}" data-src-end="${srcEnd ?? srcLine}" data-block-type="tabbed"`
      : "";
    return `<div class="tabbed-set tabbed-alternate" data-tabs="${setId}:${count}"${srcAttrs}>`;
  };
  md.renderer.rules.tabbed_set_close = () => "</div>";
  md.renderer.rules.tabbed_input = (tokens, idx) => {
    const { setId, index, checked } = tokens[idx].meta;
    return `<input ${checked ? "checked " : ""}id="__tabbed_${setId}_${index}" name="__tabbed_${setId}" type="radio">`;
  };
  md.renderer.rules.tabbed_labels_open = () => `<div class="tabbed-labels">`;
  md.renderer.rules.tabbed_labels_close = () => `</div>`;
  md.renderer.rules.tabbed_label = (tokens, idx) => {
    const { setId, index, title } = tokens[idx].meta;
    return `<label for="__tabbed_${setId}_${index}">${md.utils.escapeHtml(title as string)}</label>`;
  };
  md.renderer.rules.tabbed_content_open = () => `<div class="tabbed-content">`;
  md.renderer.rules.tabbed_content_close = () => `</div>`;
  md.renderer.rules.tabbed_block_open = () => `<div class="tabbed-block">`;
  md.renderer.rules.tabbed_block_close = () => `</div>`;
}

function tabsRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const markerIndent = state.sCount[startLine];
  if (markerIndent - state.blkIndent >= 4) {
    return false;
  }
  if (!MARKER_RE.test(lineText(state, startLine))) {
    return false;
  }
  if (silent) {
    return true;
  }

  // Collect every consecutive tab of the set.
  const contentIndent = markerIndent + 4;
  const tabs: { title: string; contentStart: number; contentEnd: number }[] = [];
  // endLine, not state.lineMax: inside a blockquote ended by a blank line the
  // two differ, and a set that trusted lineMax would run past the quote.
  const lastLine = Math.min(endLine, state.lineMax);
  let line = startLine;
  while (line < lastLine) {
    if (state.sCount[line] !== markerIndent) {
      break;
    }
    const m = MARKER_RE.exec(lineText(state, line));
    if (!m) {
      break;
    }
    const title = m[2];
    const lastContent = findIndentedContentEnd(state, line + 1, contentIndent, lastLine);
    const contentEnd = lastContent === -1 ? line + 1 : lastContent + 1;
    tabs.push({ title, contentStart: line + 1, contentEnd });
    line = contentEnd;
    // Skip blank lines between tabs.
    while (line < lastLine && state.isEmpty(line)) {
      line++;
    }
  }

  if (tabs.length === 0) {
    return false;
  }

  const env = state.env as TabEnv;
  env.tabbedCounter = (env.tabbedCounter ?? 0) + 1;
  const setId = env.tabbedCounter;

  const setOpen = state.push("tabbed_set_open", "div", 1);
  setOpen.block = true;
  setOpen.map = [startLine, line];
  setOpen.meta = { setId, count: tabs.length, blockType: "tabbed" };

  // Radio buttons.
  tabs.forEach((_, i) => {
    const input = state.push("tabbed_input", "input", 0);
    input.meta = { setId, index: i + 1, checked: i === 0 };
  });

  // Labels.
  state.push("tabbed_labels_open", "div", 1);
  tabs.forEach((tab, i) => {
    const label = state.push("tabbed_label", "label", 0);
    label.meta = { setId, index: i + 1, title: tab.title };
  });
  state.push("tabbed_labels_close", "div", -1);

  // Content.
  state.push("tabbed_content_open", "div", 1);
  for (const tab of tabs) {
    const blockOpen = state.push("tabbed_block_open", "div", 1);
    blockOpen.map = [tab.contentStart, tab.contentEnd];
    if (tab.contentEnd > tab.contentStart) {
      tokenizeIndented(state, tab.contentStart, tab.contentEnd, contentIndent);
    }
    state.push("tabbed_block_close", "div", -1);
  }
  state.push("tabbed_content_close", "div", -1);

  state.push("tabbed_set_close", "div", -1);
  state.line = line;
  return true;
}
