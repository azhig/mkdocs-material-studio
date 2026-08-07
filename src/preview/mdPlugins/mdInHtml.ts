import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import { lineText } from "./blockUtils";

/**
 * md_in_html containers (python-markdown):
 *
 *   <div class="grid cards" markdown>      ← Material grids
 *   …ordinary Markdown…
 *   </div>
 *
 *   <figure markdown="span">               ← image captions (method A)
 *   ![alt](img.png){ width="300" }
 *   <figcaption>Caption</figcaption>
 *   </figure>
 *
 * The opening tag carrying the markdown attribute must occupy its own line.
 * The content up to the balanced closing tag is parsed as Markdown; the
 * original opening tag is kept in data-md-html-open — the visual editor's serializer
 * restores the block byte for byte. The markdown attribute does not reach the
 * HTML output (as in python-markdown).
 */

const TAGS = ["div", "figure"];
const OPEN_RE = new RegExp(
  `^<(${TAGS.join("|")})(\\s[^>]*)?\\smarkdown(?:="[^"]*")?(\\s[^>]*)?>\\s*$`,
  "i",
);

export function mdInHtmlPlugin(md: MarkdownIt): void {
  md.block.ruler.before("html_block", "md_in_html", containerRule);
}

function containerRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }
  const openText = lineText(state, startLine).trim();
  const openMatch = OPEN_RE.exec(openText);
  if (!openMatch) {
    return false;
  }
  const tag = openMatch[1].toLowerCase();
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;

  // Balanced closing tag: count openings/closings line by line.
  let depth = 1;
  let closeLine = -1;
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(state, line);
    depth += count(text, openTag) - count(text, closeTag);
    if (depth <= 0) {
      closeLine = line;
      break;
    }
  }
  if (closeLine === -1) {
    return false;
  }
  if (silent) {
    return true;
  }

  const open = state.push("md_html_open", tag, 1);
  open.block = true;
  open.map = [startLine, closeLine + 1];
  open.meta = { blockType: "html" };
  for (const [name, value] of parseAttrs(openText, tag)) {
    if (name.toLowerCase() !== "markdown") {
      open.attrSet(name, value);
    }
  }
  open.attrSet("data-md-html-open", openText);

  state.md.block.tokenize(state, startLine + 1, closeLine);

  state.push("md_html_close", tag, -1);
  state.line = closeLine + 1;
  return true;
}

function count(haystack: string, needle: string): number {
  let n = 0;
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, i + needle.length)
  ) {
    n++;
  }
  return n;
}

/** Name/value pairs of the opening tag's attributes. */
function parseAttrs(tag: string, tagName: string): Array<[string, string]> {
  const body = tag.replace(new RegExp(`^<${tagName}`, "i"), "").replace(/>\s*$/, "");
  const out: Array<[string, string]> = [];
  const re = /([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.push([m[1], m[2] ?? m[3] ?? ""]);
  }
  return out;
}
