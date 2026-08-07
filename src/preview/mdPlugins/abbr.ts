import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";
import { lineText } from "./blockUtils";

/**
 * Abbreviations (the abbr extension / Material tooltips):
 *
 *   *[HTML]: Hyper Text Markup Language
 *
 * The definitions are collected into a block (hidden in the preview), and every
 * occurrence of a label in the text is wrapped in <abbr title="…"> — a tooltip.
 *
 * Round-trip: the hidden block is serialized back into the original `*[…]: …`
 * lines; the <abbr> itself is unwrapped back into text (the wrapper is derived
 * from the definition).
 */

const DEF_RE = /^\*\[([^\]]+)\]:\s*(.*)$/;

interface AbbrEnv {
  abbreviations?: Record<string, string>;
}

export function abbrPlugin(md: MarkdownIt): void {
  md.block.ruler.before("reference", "abbr_def", abbrDefRule, { alt: ["paragraph"] });
  md.core.ruler.push("abbr_replace", abbrReplace);

  md.renderer.rules.abbr_defs = (tokens, idx) => {
    const src = tokens[idx].content;
    // Hidden block: the definitions are invisible but stay in the DOM for serialization.
    const attrs = tokens[idx].attrGet("data-src-line")
      ? ` data-src-line="${tokens[idx].attrGet("data-src-line")}" data-src-end="${tokens[idx].attrGet("data-src-end")}" data-block-type="abbr"`
      : "";
    return `<div class="abbr-defs" hidden data-abbr-src="${md.utils.escapeHtml(src)}"${attrs}></div>\n`;
  };
}

function abbrDefRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }
  if (!DEF_RE.test(lineText(state, startLine))) {
    return false;
  }
  if (silent) {
    return true;
  }

  const env = state.env as AbbrEnv;
  env.abbreviations = env.abbreviations ?? {};

  // Capture consecutive definition lines as a single block.
  const raw: string[] = [];
  let line = startLine;
  while (line < endLine) {
    const text = lineText(state, line);
    const m = DEF_RE.exec(text);
    if (!m) {
      break;
    }
    env.abbreviations[m[1]] = m[2];
    raw.push(text);
    line++;
  }

  const token = state.push("abbr_defs", "", 0);
  token.block = true;
  token.content = raw.join("\n");
  token.map = [startLine, line];
  token.meta = { blockType: "abbr" };
  state.line = line;
  return true;
}

/** Wraps occurrences of the labels in <abbr>. */
function abbrReplace(state: StateCore): void {
  const env = state.env as AbbrEnv;
  const abbrs = env.abbreviations;
  if (!abbrs || Object.keys(abbrs).length === 0) {
    return;
  }
  const labels = Object.keys(abbrs).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${labels.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])`,
    "u",
  );

  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) {
      continue;
    }
    block.children = wrapChildren(block.children, state, pattern, abbrs);
  }
}

function wrapChildren(
  children: Token[],
  state: StateCore,
  pattern: RegExp,
  abbrs: Record<string, string>,
): Token[] {
  const out: Token[] = [];
  let inLink = 0;
  for (const child of children) {
    if (child.type === "link_open") inLink++;
    if (child.type === "link_close") inLink--;
    // Leave alone the text inside code and inside already built links/tags.
    if (child.type !== "text" || inLink > 0) {
      out.push(child);
      continue;
    }
    out.push(...splitText(child, state, pattern, abbrs));
  }
  return out;
}

function splitText(
  token: Token,
  state: StateCore,
  pattern: RegExp,
  abbrs: Record<string, string>,
): Token[] {
  const text = token.content;
  const re = new RegExp(pattern.source, "gu");
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const t = new state.Token("text", "", 0);
      t.content = text.slice(last, m.index);
      out.push(t);
    }
    const open = new state.Token("abbr_open", "abbr", 1);
    open.attrSet("title", abbrs[m[1]]);
    out.push(open);
    const label = new state.Token("text", "", 0);
    label.content = m[1];
    out.push(label);
    out.push(new state.Token("abbr_close", "abbr", -1));
    last = m.index + m[0].length;
  }
  if (out.length === 0) {
    return [token];
  }
  if (last < text.length) {
    const t = new state.Token("text", "", 0);
    t.content = text.slice(last);
    out.push(t);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
