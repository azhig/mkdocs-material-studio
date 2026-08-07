// Client-side code highlighting for inline editing of a code block in the visual editor.
//
// The host render (superFences.ts) emits monochrome for blocks with line numbers
// or highlighted lines — so “color + numbers + highlighted lines at the same
// time” during live editing is done here, on highlight.js. The markup is built
// line by line (`<span class="cl">…</span>` per line) so that the number gutter
// (a CSS counter) and the highlighted-line background (`.cl.hll`) work, and the
// source text is restored by joining the lines.
//
// The module depends on neither the global DOM (beyond types) nor vscode — some
// of its functions are covered by unit tests.

import hljs from "highlight.js";

/** Escaping for safe insertion as HTML text. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Colored HTML via highlight.js; for an unknown language — escaped text. */
function hljsHighlight(text: string, lang: string): string {
  const l = lang.trim().toLowerCase();
  if (l && hljs.getLanguage(l)) {
    try {
      return hljs.highlight(text, { language: l, ignoreIllegals: true }).value;
    } catch {
      /* highlighting failed — fall back to escaped text */
    }
  }
  return escapeHtml(text);
}

/**
 * Splits the HTML output of highlight.js into lines while keeping the tags
 * balanced: if a span crosses a `\n`, it is closed at the end of the line and
 * reopened at the start of the next one. highlight.js emits only
 * `<span class="…">`/`</span>` and text with HTML entities (no `\n` inside
 * tags), so a character-by-character walk with a stack of open tags is enough.
 * Returns an array of lines WITHOUT the trailing `\n`.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openTags: string[] = []; // full opening tags, e.g. `<span class="hljs-x">`
  let buf = "";
  let i = 0;
  const flush = (): void => {
    // Close the open tags, flush the line, reopen them on the next one.
    lines.push(buf + "</span>".repeat(openTags.length));
    buf = openTags.join("");
  };
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const end = html.indexOf(">", i);
      const tag = end < 0 ? html.slice(i) : html.slice(i, end + 1);
      if (tag.startsWith("</")) {
        openTags.pop();
      } else if (!tag.endsWith("/>")) {
        openTags.push(tag);
      }
      buf += tag;
      i += tag.length;
    } else if (ch === "\n") {
      flush();
      i += 1;
    } else {
      buf += ch;
      i += 1;
    }
  }
  lines.push(buf + "</span>".repeat(openTags.length));
  return lines;
}

/**
 * The complete innerHTML for `<code>`: one `<span class="cl">` per line, with
 * the `hll` class on highlighted ones. Lines do NOT contain `\n` (the break
 * comes from `display:block`); the source text is restored by joining the
 * lines' textContent with `\n`.
 */
export function renderCodeHtml(text: string, lang: string, hl: Set<number>): string {
  // We do NOT trim the trailing `\n` — otherwise Enter at the end of the last
  // line would lose the new empty line (for the host path the trailing `\n` is
  // already stripped by codeLinesOf).
  const colored = hljsHighlight(text, lang);
  const lines = splitHighlightedLines(colored);
  return lines
    .map((line, i) => {
      const cls = hl.has(i + 1) ? "cl hll" : "cl";
      // An empty line must still take up height — a U+200B filler is not
      // needed, since `.cl { display:block; min-height }` holds the line.
      return `<span class="${cls}">${line}</span>`;
    })
    .join("");
}
