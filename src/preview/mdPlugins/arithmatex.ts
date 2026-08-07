import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import katex from "katex";

/**
 * Math (pymdownx.arithmatex): `$…$` and `$$…$$` → KaTeX (rendered on the host
 * side, so the webview needs no KaTeX JS — only the CSS).
 */

export function arithmatexPlugin(md: MarkdownIt): void {
  // The \(…\) form must be caught before the escape rule (otherwise “\(” becomes “(”).
  md.inline.ruler.before("escape", "math_inline_paren", mathInlineParen);
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.before("fence", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote"],
  });

  // Wrappers carrying data-tex keep the original LaTeX — the visual editor
  // serializes the formula back without loss. data-math-delim records the
  // delimiter style ($…$ by default, or \(…\)/\[…\]) for a byte-for-byte round-trip.
  md.renderer.rules.math_inline = (tokens, idx) => {
    const tex = tokens[idx].content;
    const delim = delimAttr(tokens[idx]);
    return `<span class="arithmatex" data-tex="${escapeAttr(tex)}"${delim}>${renderMath(tex, false)}</span>`;
  };
  md.renderer.rules.math_block = (tokens, idx) => {
    const token = tokens[idx];
    const tex = token.content;
    // A custom renderer must carry the source markers over from token.attrs itself.
    const srcLine = token.attrGet("data-src-line");
    const srcEnd = token.attrGet("data-src-end");
    const srcAttrs = srcLine
      ? ` data-src-line="${srcLine}" data-src-end="${srcEnd ?? srcLine}" data-block-type="math"`
      : "";
    return `<div class="arithmatex" data-tex="${escapeAttr(tex)}"${delimAttr(token)}${srcAttrs}>${renderMath(tex, true)}</div>\n`;
  };
}

function delimAttr(token: { meta?: { delim?: string } }): string {
  const delim = token.meta?.delim;
  return delim && delim !== "dollar" ? ` data-math-delim="${delim}"` : "";
}

function renderMath(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false });
  } catch {
    return `<span class="katex-error">${escapeHtml(latex)}</span>`;
  }
}

function mathInline(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) {
    return false;
  }
  // Do not start on “$ ” (a space) and do not count an escaped “\$”.
  const after = state.src.charCodeAt(state.pos + 1);
  if (after === 0x20 || after === 0x09 || Number.isNaN(after)) {
    return false;
  }
  let pos = state.pos + 1;
  let found = -1;
  while (pos < state.posMax) {
    const ch = state.src.charCodeAt(pos);
    if (ch === 0x5c /* \ */) {
      pos += 2;
      continue;
    }
    if (ch === 0x24) {
      // The closing “$” must not follow a space.
      if (state.src.charCodeAt(pos - 1) !== 0x20) {
        found = pos;
      }
      break;
    }
    pos++;
  }
  if (found < 0) {
    return false;
  }
  const content = state.src.slice(state.pos + 1, found);
  if (!content) {
    return false;
  }
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
    token.meta = { delim: "dollar" };
  }
  state.pos = found + 1;
  return true;
}

/** The inline `\(…\)` form (pymdownx.arithmatex). */
function mathInlineParen(state: StateInline, silent: boolean): boolean {
  if (
    state.src.charCodeAt(state.pos) !== 0x5c /* \ */ ||
    state.src.charCodeAt(state.pos + 1) !== 0x28 /* ( */
  ) {
    return false;
  }
  const end = state.src.indexOf("\\)", state.pos + 2);
  if (end < 0 || end > state.posMax) {
    return false;
  }
  const content = state.src.slice(state.pos + 2, end).trim();
  if (!content) {
    return false;
  }
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
    token.meta = { delim: "paren" };
  }
  state.pos = end + 2;
  return true;
}

function mathBlock(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const firstLine = state.src.slice(start, state.eMarks[startLine]);
  // Two delimiter styles: $$ … $$ and \[ … \].
  const style = firstLine.startsWith("$$")
    ? { open: "$$", close: "$$", delim: "dollar", re: /^\$\$(.+)\$\$\s*$/, closeRe: /\$\$\s*$/ }
    : firstLine.startsWith("\\[")
      ? {
          open: "\\[",
          close: "\\]",
          delim: "bracket",
          re: /^\\\[(.+)\\\]\s*$/,
          closeRe: /\\\]\s*$/,
        }
      : null;
  if (!style) {
    return false;
  }
  if (silent) {
    return true;
  }

  // Single-line case: <open> ... <close>
  const singleLine = style.re.exec(firstLine);
  if (singleLine) {
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content = singleLine[1].trim();
    token.map = [startLine, startLine + 1];
    token.meta = { blockType: "math", delim: style.delim };
    state.line = startLine + 1;
    return true;
  }

  // Multi-line: collect up to the line carrying the closing delimiter.
  let nextLine = startLine;
  let content = firstLine.slice(2);
  let closed = false;
  if (style.closeRe.test(content.trim())) {
    content = content.trim().replace(style.closeRe, "");
    closed = true;
  }
  while (!closed && nextLine < endLine) {
    nextLine++;
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineText = state.src.slice(lineStart, state.eMarks[nextLine]);
    if (style.closeRe.test(lineText.trim())) {
      content += "\n" + lineText.replace(style.closeRe, "");
      closed = true;
    } else {
      content += "\n" + lineText;
    }
  }

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = content.trim();
  token.map = [startLine, nextLine + 1];
  token.meta = { blockType: "math", delim: style.delim };
  state.line = nextLine + 1;
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

function escapeAttr(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}
