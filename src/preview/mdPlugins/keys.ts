import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * Keys (pymdownx.keys): `++ctrl+alt+del++` → a set of <kbd>.
 * Matches the Material markup: <span class="keys"><kbd class="key-…">…</kbd>+…</span>.
 */

// A Map rather than an object: the name comes out of the document, and on a
// plain object `++constructor++` would look up Object's own constructor and
// print its source into the page.
const KEY_MAP = new Map<string, string>([
  ["ctrl", "Ctrl"],
  ["control", "Ctrl"],
  ["alt", "Alt"],
  ["shift", "Shift"],
  ["meta", "Meta"],
  ["cmd", "Cmd"],
  ["win", "Win"],
  ["tab", "Tab"],
  ["esc", "Esc"],
  ["escape", "Esc"],
  ["enter", "Enter"],
  ["return", "Return"],
  ["space", "Space"],
  ["del", "Del"],
  ["delete", "Delete"],
  ["backspace", "Backspace"],
  ["insert", "Insert"],
  ["home", "Home"],
  ["end", "End"],
  ["page-up", "Page Up"],
  ["page-down", "Page Down"],
  ["caps-lock", "Caps Lock"],
  ["up", "↑"],
  ["down", "↓"],
  ["left", "←"],
  ["right", "→"],
  ["arrow-up", "↑"],
  ["arrow-down", "↓"],
  ["arrow-left", "←"],
  ["arrow-right", "→"],
  ...Array.from({ length: 12 }, (_, i): [string, string] => [`f${i + 1}`, `F${i + 1}`]),
]);

export function keysPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("emphasis", "keys", (state, silent) => keysRule(state, silent, md));
}

function keysRule(state: StateInline, silent: boolean, md: MarkdownIt): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x2b /* + */ || state.src.charCodeAt(start + 1) !== 0x2b) {
    return false;
  }
  const rest = state.src.slice(start + 2);
  const end = rest.indexOf("++");
  if (end < 0) {
    return false;
  }
  const inner = rest.slice(0, end);
  // Allow only letters/digits/hyphen separated by “+” — a guard against false
  // positives on a plain “++”.
  if (!inner || !/^[A-Za-z0-9+-]+$/.test(inner)) {
    return false;
  }
  if (silent) {
    return true;
  }

  const keys = inner.split("+").filter(Boolean);
  // data-keys keeps the original notation — for serialization in the visual editor.
  let html = `<span class="keys" data-keys="++${inner}++">`;
  keys.forEach((key, i) => {
    const norm = key.toLowerCase();
    const known = KEY_MAP.get(norm);
    const label = known ?? key;
    const cls = known ? ` class="key-${norm}"` : "";
    html += `<kbd${cls}>${md.utils.escapeHtml(label)}</kbd>`;
    if (i < keys.length - 1) {
      html += "<span>+</span>";
    }
  });
  html += "</span>";

  const token = state.push("html_inline", "", 0);
  token.content = html;
  state.pos = start + 2 + end + 2;
  return true;
}
