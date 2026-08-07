import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { lineText } from "./blockUtils";
import { t } from "../../core/i18nCore";

/**
 * Includes (pymdownx.snippets), the line form: `--8<-- "path/file.md"`.
 * The file's content is substituted and parsed as Markdown. The path resolver
 * (which accounts for the base directories) is supplied from outside; when the
 * file is missing the line is replaced with a notice.
 */

export type SnippetReader = (relPath: string) => string | undefined;

const LINE_RE = /^--8<--\s+"([^"]+)"\s*$/;

export function snippetsPlugin(md: MarkdownIt, read: SnippetReader): void {
  md.block.ruler.before("fence", "snippet", (state, startLine, endLine, silent) =>
    snippetRule(state, startLine, endLine, silent, read),
  );
}

function snippetRule(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
  read: SnippetReader,
): boolean {
  const match = LINE_RE.exec(lineText(state, startLine).trim());
  if (!match) {
    return false;
  }
  if (silent) {
    return true;
  }

  // Found or not, the block is the same island: what goes back into the
  // Markdown is the marker, and the island is what says so. A notice rendered
  // as bare HTML with no source range of its own was taken for new content —
  // touching it wrote a `!!! warning "Snippet not found"` into the document,
  // one more with every touch, while the `--8<--` line stayed where it was.
  // The path is kept in data-snippet-path, and serialization reads it.
  const content = read(match[1]);
  const open = state.push("snippet_open", "div", 1);
  open.block = true;
  open.map = [startLine, startLine + 1];
  open.attrSet("class", "snippet-include");
  open.attrSet("data-snippet-path", match[1]);
  open.meta = { blockType: "snippet" };

  if (content === undefined) {
    const notice = state.push("html_block", "", 0);
    notice.content =
      `<div class="admonition warning">` +
      `<p class="admonition-title">${state.md.utils.escapeHtml(t("Snippet not found"))}</p>` +
      `<p>${state.md.utils.escapeHtml(match[1])}</p>` +
      // The one mistake everyone makes is a page-relative path, so the notice
      // says what the path is measured from.
      `<p>${state.md.utils.escapeHtml(t("The path is resolved from the project root (the mkdocs.yml folder)."))}</p>` +
      `</div>\n`;
  } else {
    // The content is parsed in a separate pass. A full parse has already run
    // the core rules (sourceLine included) — clear out the foreign file's
    // coordinates so the visual editor does not take them for document lines.
    const tokens = state.md.parse(content, state.env);
    for (const t of tokens) {
      t.map = null;
      for (const name of ["data-src-line", "data-src-end", "data-block-type"]) {
        const i = t.attrIndex(name);
        if (i >= 0) {
          t.attrs?.splice(i, 1);
        }
      }
      state.tokens.push(t);
    }
  }

  state.push("snippet_close", "div", -1);
  state.line = startLine + 1;
  return true;
}
