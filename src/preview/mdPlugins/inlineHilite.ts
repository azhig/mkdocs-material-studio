import type MarkdownIt from "markdown-it";
import hljs from "highlight.js";

/**
 * Inline code highlighting (pymdownx.inlinehilite):
 *
 *   `#!python range()` → <code class="highlight language-python">range()</code>
 *
 * The `#!language` prefix is stripped from the output and kept in
 * data-inline-lang, so the visual editor's serializer restores it byte for byte.
 */

const SHEBANG_RE = /^#!([\w+-]+)\s+([\s\S]+)$/;

export function inlineHilitePlugin(md: MarkdownIt): void {
  const fallback =
    md.renderer.rules.code_inline ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const m = SHEBANG_RE.exec(token.content);
    if (!m) {
      return fallback(tokens, idx, options, env, self);
    }
    const [, lang, code] = m;
    let inner: string;
    if (hljs.getLanguage(lang)) {
      try {
        inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        inner = md.utils.escapeHtml(code);
      }
    } else {
      inner = md.utils.escapeHtml(code);
    }
    return `<code class="highlight language-${lang}" data-inline-lang="${lang}">${inner}</code>`;
  };
}
