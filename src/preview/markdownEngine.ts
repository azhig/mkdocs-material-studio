import MarkdownIt from "markdown-it";
import deflist from "markdown-it-deflist";
import footnote from "markdown-it-footnote";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import mark from "markdown-it-mark";
import taskLists from "markdown-it-task-lists";
import attrs from "markdown-it-attrs";
import anchor from "markdown-it-anchor";

import { admonitionPlugin } from "./mdPlugins/admonition";
import { contentTabsPlugin } from "./mdPlugins/contentTabs";
import { superFencesPlugin } from "./mdPlugins/superFences";
import { inlineHilitePlugin } from "./mdPlugins/inlineHilite";
import { criticPlugin } from "./mdPlugins/critic";
import { mdInHtmlPlugin } from "./mdPlugins/mdInHtml";
import { captionPlugin } from "./mdPlugins/caption";
import { abbrPlugin } from "./mdPlugins/abbr";
import { footnoteKeepPlugin } from "./mdPlugins/footnoteKeep";
import { keysPlugin } from "./mdPlugins/keys";
import { caretInsertPlugin } from "./mdPlugins/caretInsert";
import { arithmatexPlugin } from "./mdPlugins/arithmatex";
import { materialIconsPlugin } from "./mdPlugins/materialIcons";
import { snippetsPlugin } from "./mdPlugins/snippets";
import { mkdocstringsPlugin } from "./mdPlugins/mkdocstrings";
import { sourceLinePlugin } from "./mdPlugins/sourceLine";

/** Heading text exactly as markdown-it-anchor computes it (text + code_inline). */
function headingText(
  inline: { children?: Array<{ type: string; content: string }> | null } | undefined,
): string {
  return (inline?.children ?? [])
    .filter((t) => t.type === "text" || t.type === "code_inline")
    .map((t) => t.content)
    .join("");
}

/** The default markdown-it-anchor slug — reproduced so that the ids match. */
function autoSlug(text: string): string {
  return encodeURIComponent(String(text).trim().toLowerCase().replace(/\s+/g, "-"));
}

export interface EngineHooks {
  resolveIcon: (shortcode: string) => string | undefined;
  readSnippet: (relPath: string) => string | undefined;
}

/**
 * Builds a markdown-it instance with every pymdownx/Material extension.
 * Does not depend on vscode — suitable for unit tests.
 */
export function buildMarkdownEngine(hooks: EngineHooks): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    // python-markdown does no smart typography by default — and the visual editor
    // serializes rendered text back to the file, so a typographer would bake
    // `’`/`«…»` into sources that were written with plain quotes.
    typographer: false,
    breaks: false,
  });

  md.use(deflist);
  md.use(footnote);
  md.use(footnoteKeepPlugin);
  // The ref and the list item carry the original label (`[^label]`): the visual
  // editor serializes the marker back and finds the definition by the label.
  // Inline footnotes (`^[…]`) have no label and stay render-only.
  for (const rule of ["footnote_ref", "footnote_open"]) {
    const base = md.renderer.rules[rule];
    if (!base) {
      continue;
    }
    md.renderer.rules[rule] = (tokens, idx, options, env, slf) => {
      const html = base(tokens, idx, options, env, slf);
      const label = (tokens[idx].meta as { label?: string } | null)?.label;
      if (!label) {
        return html;
      }
      return html.replace(/^<(sup|li)/, `<$1 data-fn-label="${md.utils.escapeHtml(label)}"`);
    };
  }
  md.use(sub);
  md.use(sup);
  md.use(mark);
  md.use(taskLists, { enabled: true, label: true });
  md.use(attrs, { leftDelimiter: "{", rightDelimiter: "}" });
  md.use(anchor, { permalink: anchor.permalink.headerLink() });

  // We assign the heading ids ourselves, before markdown-it-anchor. Two reasons:
  //  * an auto id has to be told apart from an explicit `{ #id }` anchor — after
  //    the text is edited in the visual editor the auto id goes stale, and without the
  //    marker the serializer would take it for a custom one and write it into
  //    the markdown;
  //  * two identical user ids (a common case when pages are copied from the
  //    browser — Material drags `{ #id }` along with the “¶” anchor) make
  //    markdown-it-anchor THROW, and the render of the whole document dies.
  //    MkDocs (python-markdown) simply makes the id unique with a suffix in that
  //    case — we do the same. The author's id is kept in data-user-id: the
  //    serializer writes exactly that into the file, so someone else's document
  //    is not rewritten.
  md.core.ruler.before("anchor", "vs_heading_ids", (state) => {
    const used = new Set<string>();
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type !== "heading_open") {
        continue;
      }
      const custom = token.attrGet("id");
      const base = custom ?? autoSlug(headingText(state.tokens[i + 1]));
      token.meta = { ...(token.meta ?? {}), customId: custom !== null };
      let id = base;
      for (let n = 1; used.has(id); n++) {
        id = `${base}_${n}`;
      }
      used.add(id);
      token.attrSet("id", id);
      if (custom === null) {
        token.attrSet("data-auto-id", "1");
      } else {
        // An author's anchor is always marked: without the marker the serializer
        // treated as “the author's” only an id that differed from the slug of the
        // text, and `{ #validation }` on a “Validation” heading disappeared from
        // the file on the very first edit.
        token.attrSet("data-user-id", custom);
      }
    }
    return true;
  });

  // `{ .annotate }` at the end of a paragraph inside a list item. python-markdown
  // puts the class on that paragraph — Material's nested annotations rely on
  // exactly that — while markdown-it-attrs would lift it onto the enclosing
  // list, where neither the decoration nor the serializer would find it. The
  // class is applied here, right after the block parse and before the inline
  // contents are tokenized, so attrs never sees the curly.
  md.core.ruler.after("block", "vs_annotate_in_li", (state) => {
    // The continuation indent is not fully consumed by the list parser — a
    // stray space may precede the curly, hence \n\s*.
    const ANNOTATE_RE = /\n\s*\{\s*\.annotate\s*\}\s*$/;
    let inItem = 0;
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === "list_item_open") {
        inItem++;
      } else if (token.type === "list_item_close") {
        inItem--;
      } else if (
        inItem > 0 &&
        token.type === "inline" &&
        state.tokens[i - 1]?.type === "paragraph_open" &&
        ANNOTATE_RE.test(token.content)
      ) {
        token.content = token.content.replace(ANNOTATE_RE, "");
        state.tokens[i - 1].attrJoin("class", "annotate");
      }
    }
    return true;
  });

  md.use(admonitionPlugin);
  md.use(contentTabsPlugin);
  md.use(mdInHtmlPlugin);
  md.use(captionPlugin);
  md.use(abbrPlugin);
  md.use((m) => superFencesPlugin(m, hooks.readSnippet));
  md.use(inlineHilitePlugin);
  md.use(criticPlugin);
  md.use(keysPlugin);
  md.use(caretInsertPlugin);
  md.use(arithmatexPlugin);
  md.use((m) => materialIconsPlugin(m, hooks.resolveIcon));
  md.use((m) => snippetsPlugin(m, hooks.readSnippet));
  md.use(mkdocstringsPlugin);
  md.use(sourceLinePlugin); // last — it works on the finished tokens

  return md;
}
