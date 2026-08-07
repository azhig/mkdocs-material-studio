import type MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import type { SnippetReader } from "./snippets";

/**
 * Code blocks in the pymdownx.superfences + Material style.
 *
 *   ```python title="app.py" hl_lines="2 3" linenums="1"
 *   ```mermaid                         → a diagram (rendered in the webview)
 *   ```{ .python .extra title="..." }  → the extended info-string form
 *
 * Colored highlighting (highlight.js) is applied to ordinary blocks. Blocks with
 * linenums/hl_lines use per-line markup (monochrome) — a compromise of the
 * lightweight renderer; in serve mode everything is displayed by real Pygments.
 *
 * The original info string is kept in data-fence-info: the visual editor's serializer
 * uses it as the source of truth (the .copy/.select classes and other pymdownx
 * parameters survive the round-trip even if the renderer does not understand them).
 */

interface FenceInfo {
  lang: string;
  title?: string;
  hlLines: Set<number>;
  linenums: boolean;
  extraClasses: string[];
}

export function superFencesPlugin(md: MarkdownIt, readSnippet?: SnippetReader): void {
  // markdown-it-attrs strips `{ .yaml .copy }` out of the info string before
  // rendering — save the original up front, parseInfo and the serializer need it.
  const backup = (state: {
    tokens: Array<{ type: string; info: string; meta: unknown }>;
  }): void => {
    for (const t of state.tokens) {
      if (t.type === "fence") {
        t.meta = { ...(t.meta as object), fenceInfo: t.info };
      }
    }
  };
  try {
    md.core.ruler.before("curly_attributes", "fence_info_backup", backup);
  } catch {
    md.core.ruler.push("fence_info_backup", backup);
  }

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const rawInfo = ((token.meta as { fenceInfo?: string } | null)?.fenceInfo ?? token.info).trim();
    const info = parseInfo(rawInfo);
    const { code, pristine } = expandSnippets(token.content, readSnippet);

    // The source-line markers (sourceLinePlugin sets them in token.attrs, but a
    // custom renderer must carry them over into the HTML itself).
    const srcLine = token.attrGet("data-src-line");
    const srcEnd = token.attrGet("data-src-end");
    const srcAttrs = srcLine
      ? ` data-src-line="${srcLine}" data-src-end="${srcEnd ?? srcLine}" data-block-type="code"`
      : "";
    const infoAttr = rawInfo ? ` data-fence-info="${md.utils.escapeHtml(rawInfo)}"` : "";
    // The author may have fenced the code with tildes — keep the styling for the serializer.
    const fenceAttr =
      token.markup && token.markup[0] === "~" ? ` data-fence="${token.markup}"` : "";
    const pristineAttr =
      pristine !== undefined ? ` data-fence-pristine="${md.utils.escapeHtml(pristine)}"` : "";

    if (info.lang === "mermaid") {
      return `<pre class="mermaid"${srcAttrs}${infoAttr}${fenceAttr}>${md.utils.escapeHtml(code)}</pre>\n`;
    }

    const useLineMode = info.linenums || info.hlLines.size > 0;
    const inner = useLineMode ? renderLineMode(md, code, info) : renderColored(md, code, info.lang);

    const titleHtml = info.title
      ? `<span class="filename">${md.utils.escapeHtml(info.title)}</span>`
      : "";
    const classes = ["highlight", ...(info.linenums ? ["linenums"] : []), ...info.extraClasses];
    return `<div class="${classes.join(" ")}"${srcAttrs}${infoAttr}${pristineAttr}${fenceAttr}>${titleHtml}${inner}</div>\n`;
  };
}

/**
 * Line includes `--8<-- "file"` inside a code block (pymdownx.snippets handles
 * them in a preprocessor, inside a fence as well). Returns the expanded code and
 * the source before substitution (if there was one) — for the serializer.
 */
function expandSnippets(
  content: string,
  read: SnippetReader | undefined,
): { code: string; pristine?: string } {
  if (!read || !content.includes("--8<--")) {
    return { code: content };
  }
  let changed = false;
  const out = content.split("\n").map((line) => {
    const m = /^--8<--\s+"([^"]+)"\s*$/.exec(line.trim());
    if (!m) {
      return line;
    }
    const included = read(m[1]);
    if (included === undefined) {
      return line;
    }
    changed = true;
    return included.replace(/\n$/, "");
  });
  return changed ? { code: out.join("\n"), pristine: content } : { code: content };
}

function renderColored(md: MarkdownIt, code: string, lang: string): string {
  let highlighted: string;
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      highlighted = md.utils.escapeHtml(code);
    }
  } else {
    highlighted = md.utils.escapeHtml(code);
  }
  const langClass = lang ? ` class="language-${lang} hljs"` : ' class="hljs"';
  return `<pre><code${langClass}>${highlighted}</code></pre>`;
}

function renderLineMode(md: MarkdownIt, code: string, info: FenceInfo): string {
  const lines = code.replace(/\n$/, "").split("\n");
  const rows = lines
    .map((line, i) => {
      const n = i + 1;
      const cls = info.hlLines.has(n) ? ' class="hll"' : "";
      return `<span${cls}>${md.utils.escapeHtml(line) || " "}\n</span>`;
    })
    .join("");
  const langClass = info.lang ? ` class="language-${info.lang}"` : "";
  return `<pre><code${langClass}>${rows}</code></pre>`;
}

function parseInfo(raw: string): FenceInfo {
  const info: FenceInfo = { lang: "", hlLines: new Set(), linenums: false, extraClasses: [] };
  const text = (raw || "").trim();
  if (!text) {
    return info;
  }

  // The { .lang .extra title="..." hl_lines="..." linenums="1" } form
  const braced = /^\{(.*)\}$/.exec(text);
  const body = braced ? braced[1].trim() : text;

  if (braced) {
    const classes = Array.from(body.matchAll(/(?:^|\s)\.([\w+-]+)/g)).map((m) => m[1]);
    info.lang = classes[0] ?? "";
    info.extraClasses = classes.slice(1);
  } else {
    info.lang = body.split(/\s+/)[0] ?? "";
  }

  const title = /title="([^"]*)"/.exec(body);
  if (title) {
    info.title = title[1];
  }
  const hl = /hl_lines="([^"]*)"/.exec(body);
  if (hl) {
    info.hlLines = parseLineRanges(hl[1]);
  }
  if (/(?:^|\s)linenums="?\d/.test(body)) {
    info.linenums = true;
  }
  return info;
}

function parseLineRanges(spec: string): Set<number> {
  const result = new Set<number>();
  for (const part of spec.split(/\s+/)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) {
        result.add(i);
      }
    } else if (/^\d+$/.test(part)) {
      result.add(Number(part));
    }
  }
  return result;
}
