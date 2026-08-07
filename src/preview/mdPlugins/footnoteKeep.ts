import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";

/**
 * markdown-it-footnote consumes the `[^label]: …` definitions: their tokens are
 * moved into the rendered list at the end of the document, and the source lines
 * are represented by nothing at their original position. For a plain preview
 * that is fine, but the visual editor rebuilds a block's file range from its DOM —
 * a definition nested in a list item, a grid or an admonition would silently
 * vanish on the first edit of the container. A hidden carrier block (the same
 * trick the abbr plugin uses) keeps the original lines in the DOM, so any
 * container round-trips byte for byte.
 */
export function footnoteKeepPlugin(md: MarkdownIt): void {
  md.core.ruler.before("footnote_tail", "footnote_def_keep", keepDefs);

  md.renderer.rules.footnote_defs = (tokens, idx) => {
    const src = tokens[idx].content;
    const attrs = tokens[idx].attrGet("data-src-line")
      ? ` data-src-line="${tokens[idx].attrGet("data-src-line")}" data-src-end="${tokens[idx].attrGet("data-src-end")}" data-block-type="footnote-def"`
      : "";
    return `<div class="footnote-defs" hidden data-fn-src="${md.utils.escapeHtml(src)}"${attrs}></div>\n`;
  };
}

/**
 * Inserts a carrier token in front of every footnote_reference_open/close
 * group; footnote_tail then strips the group itself, and the carrier stays at
 * the definition's position in the stream (also inside containers).
 */
function keepDefs(state: StateCore): boolean {
  if (!state.tokens.some((t) => t.type === "footnote_reference_open")) {
    return true;
  }
  const srcLines = state.src.split("\n");
  const out: Token[] = [];
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== "footnote_reference_open") {
      out.push(tok);
      continue;
    }
    // The definition's line range: the union of the inner tokens' maps (the
    // reference_open token itself carries no map).
    let map: [number, number] | null = null;
    for (let j = i + 1; j < tokens.length && tokens[j].type !== "footnote_reference_close"; j++) {
      const m = tokens[j].map;
      if (m) {
        map = map ? [Math.min(map[0], m[0]), Math.max(map[1], m[1])] : [m[0], m[1]];
      }
    }
    if (map) {
      // The lines are stored relative to the container: everything the first
      // line carries before `[^` (spaces of a list item, `> ` of a quote) is
      // the container's prefix — the serializer adds it back, like it does for
      // any other nested block.
      const first = srcLines[map[0]] ?? "";
      const markerAt = first.indexOf("[^");
      const prefix = markerAt > 0 ? first.slice(0, markerAt) : "";
      const strip = (l: string): string => {
        if (prefix === "" || l.startsWith(prefix)) {
          return l.slice(prefix.length);
        }
        // A shortened service line: a bare “>” in a quote, an empty line in a list.
        if (l.trim() === "" || prefix.trim().startsWith(l.trim())) {
          return "";
        }
        return l;
      };
      const raw = srcLines.slice(map[0], map[1]).map(strip);
      while (raw.length > 0 && raw[raw.length - 1].trim() === "") {
        raw.pop();
      }
      const keeper = new state.Token("footnote_defs", "", 0);
      keeper.block = true;
      keeper.content = raw.join("\n");
      keeper.map = [map[0], map[1]];
      keeper.meta = { blockType: "footnote-def" };
      out.push(keeper);
    }
    out.push(tok);
  }
  state.tokens = out;
  return true;
}
