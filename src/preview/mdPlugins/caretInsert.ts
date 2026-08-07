import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * Inserted text (pymdownx.caret): `^^insert^^` → <ins>insert</ins>.
 * Registered before sup so that a doubled `^^` is not parsed as superscript.
 */
export function caretInsertPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("sup", "caret_insert", caretRule);
}

function caretRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5e /* ^ */ || state.src.charCodeAt(start + 1) !== 0x5e) {
    return false;
  }
  const rest = state.src.slice(start + 2);
  const end = rest.indexOf("^^");
  if (end <= 0) {
    return false;
  }
  const inner = rest.slice(0, end);
  if (/\n/.test(inner)) {
    return false;
  }
  if (silent) {
    return true;
  }

  state.push("ins_open", "ins", 1);
  const oldMax = state.posMax;
  state.pos = start + 2;
  state.posMax = start + 2 + end;
  state.md.inline.tokenize(state);
  state.pos = start + 2 + end + 2;
  state.posMax = oldMax;
  state.push("ins_close", "ins", -1);
  return true;
}
