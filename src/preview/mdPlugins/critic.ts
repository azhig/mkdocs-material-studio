import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * Critic Markup (pymdownx.critic), the inline forms:
 *
 *   {++added++}         → <ins class="critic">
 *   {--removed--}       → <del class="critic">
 *   {~~was~>became~~}   → <span class="critic subst"><del>…</del><ins>…</ins></span>
 *   {==highlighted==}   → <mark class="critic">
 *   {>>comment<<}       → <span class="critic comment">
 *
 * The content is parsed as inline markup (except the comment — that is text).
 * The critic classes are also used by the visual editor's serializer on the way back.
 */

export function criticPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("emphasis", "critic", criticRule);
}

function criticRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x7b /* { */ || start + 2 >= state.posMax) {
    return false;
  }

  // Substitution {~~old~>new~~}.
  if (src.startsWith("{~~", start)) {
    const end = src.indexOf("~~}", start + 3);
    if (end === -1 || end > state.posMax) {
      return false;
    }
    const sep = src.indexOf("~>", start + 3);
    if (sep === -1 || sep > end) {
      return false;
    }
    if (!silent) {
      const wrap = state.push("critic_subst_open", "span", 1);
      wrap.attrSet("class", "critic subst");
      emitNested(state, "del", "critic", start + 3, sep);
      emitNested(state, "ins", "critic", sep + 2, end);
      state.push("critic_subst_close", "span", -1);
    }
    state.pos = end + 3;
    return true;
  }

  const kinds: Array<[string, string, string, string, boolean]> = [
    ["{++", "++}", "ins", "critic", false],
    ["{--", "--}", "del", "critic", false],
    ["{==", "==}", "mark", "critic", false],
    ["{>>", "<<}", "span", "critic comment", true],
  ];
  for (const [open, close, tag, cls, raw] of kinds) {
    if (!src.startsWith(open, start)) {
      continue;
    }
    const end = src.indexOf(close, start + open.length);
    if (end === -1 || end > state.posMax) {
      continue;
    }
    if (!silent) {
      if (raw) {
        const openTok = state.push("critic_open", tag, 1);
        openTok.attrSet("class", cls);
        const text = state.push("text", "", 0);
        text.content = src.slice(start + open.length, end);
        state.push("critic_close", tag, -1);
      } else {
        emitNested(state, tag, cls, start + open.length, end);
      }
    }
    state.pos = end + close.length;
    return true;
  }
  return false;
}

/** A tag whose content (src[from..to)) is parsed as inline. */
function emitNested(state: StateInline, tag: string, cls: string, from: number, to: number): void {
  const open = state.push("critic_open", tag, 1);
  open.attrSet("class", cls);
  const oldPos = state.pos;
  const oldMax = state.posMax;
  state.pos = from;
  state.posMax = to;
  state.md.inline.tokenize(state);
  state.pos = oldPos;
  state.posMax = oldMax;
  state.push("critic_close", tag, -1);
}
