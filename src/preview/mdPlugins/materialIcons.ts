import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * Material-style icons and emoji:
 *   :material-account:            → inline SVG (wrapped in .twemoji)
 *   :fontawesome-brands-github:   → SVG
 *   :smile:                       → an emoji character (from a small dictionary)
 *
 * SVG icons come from the assets via the supplied resolver (lazy file read).
 */

export type IconResolver = (shortcode: string) => string | undefined;

/** Emoji dictionary (shortcode → character). Shared by the renderer and the editor picker. */
export const EMOJI: Record<string, string> = {
  // Faces and gestures
  smile: "😄",
  smiley: "😃",
  grin: "😁",
  laughing: "😆",
  joy: "😂",
  rofl: "🤣",
  wink: "😉",
  blush: "😊",
  slight_smile: "🙂",
  thinking: "🤔",
  neutral_face: "😐",
  sunglasses: "😎",
  cry: "😢",
  sob: "😭",
  angry: "😠",
  rage: "😡",
  scream: "😱",
  sweat_smile: "😅",
  heart_eyes: "😍",
  kissing_heart: "😘",
  yum: "😋",
  tongue: "😛",
  sleeping: "😴",
  mask: "😷",
  clap: "👏",
  wave: "👋",
  raised_hands: "🙌",
  raising_hand: "🙋",
  man_raising_hand: "🙋‍♂️",
  woman_raising_hand: "🙋‍♀️",
  pray: "🙏",
  muscle: "💪",
  point_right: "👉",
  point_left: "👈",
  point_up: "☝️",
  point_down: "👇",
  ok_hand: "👌",
  thumbsup: "👍",
  "+1": "👍",
  thumbsdown: "👎",
  "-1": "👎",
  // Hearts and symbols
  heart: "❤️",
  orange_heart: "🧡",
  yellow_heart: "💛",
  green_heart: "💚",
  blue_heart: "💙",
  purple_heart: "💜",
  broken_heart: "💔",
  sparkling_heart: "💖",
  star: "⭐",
  star2: "🌟",
  sparkles: "✨",
  zap: "⚡",
  fire: "🔥",
  boom: "💥",
  100: "💯",
  // Marks and statuses
  check: "✔️",
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  x: "❌",
  warning: "⚠️",
  no_entry: "⛔",
  question: "❓",
  exclamation: "❗",
  bulb: "💡",
  bell: "🔔",
  lock: "🔒",
  unlock: "🔓",
  key: "🔑",
  gear: "⚙️",
  wrench: "🔧",
  hammer: "🔨",
  // Objects and work
  rocket: "🚀",
  tada: "🎉",
  gift: "🎁",
  trophy: "🏆",
  medal: "🏅",
  book: "📖",
  books: "📚",
  memo: "📝",
  pencil: "✏️",
  pushpin: "📌",
  paperclip: "📎",
  calendar: "📅",
  clipboard: "📋",
  mag: "🔍",
  link: "🔗",
  email: "📧",
  package: "📦",
  computer: "💻",
  keyboard: "⌨️",
  phone: "📱",
  camera: "📷",
  bug: "🐛",
  hourglass: "⏳",
  alarm_clock: "⏰",
  // Nature and the rest
  eyes: "👀",
  brain: "🧠",
  coffee: "☕",
  beer: "🍺",
  pizza: "🍕",
  sun: "☀️",
  cloud: "☁️",
  snowflake: "❄️",
  rainbow: "🌈",
  earth: "🌍",
  moon: "🌙",
  seedling: "🌱",
  four_leaf_clover: "🍀",
  cat: "🐱",
  dog: "🐶",
  unicorn: "🦄",
  penguin: "🐧",
  robot: "🤖",
  ghost: "👻",
  alien: "👽",
  skull: "💀",
  poop: "💩",
};

const SHORTCODE_RE = /:([a-z0-9][a-z0-9_+-]*):/iy;

export function materialIconsPlugin(md: MarkdownIt, resolveIcon: IconResolver): void {
  md.inline.ruler.before("emphasis", "material_icon", (state, silent) =>
    iconRule(state, silent, md, resolveIcon),
  );
}

function iconRule(
  state: StateInline,
  silent: boolean,
  md: MarkdownIt,
  resolveIcon: IconResolver,
): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x3a /* : */) {
    return false;
  }
  SHORTCODE_RE.lastIndex = state.pos;
  const match = SHORTCODE_RE.exec(state.src);
  if (!match || match.index !== state.pos) {
    return false;
  }
  const name = match[1].toLowerCase();

  // An attr_list suffix right after the shortcode: `:icon:{ .heart title="…" }` —
  // classes (color/animation) and attributes (the title tooltip) move onto the span.
  let extraLen = 0;
  let extraClasses: string[] = [];
  const extraAttrs: Array<[string, string]> = [];
  const after = state.src.slice(state.pos + match[0].length);
  const attrsMatch = /^\{([^}]*)\}/.exec(after);
  if (attrsMatch && isIconAttrs(attrsMatch[1])) {
    extraClasses = Array.from(attrsMatch[1].matchAll(/\.([\w-]+)/g)).map((m) => m[1]);
    for (const m of attrsMatch[1].matchAll(/([\w:-]+)="([^"]*)"/g)) {
      extraAttrs.push([m[1], m[2]]);
    }
    extraLen = attrsMatch[0].length;
  }
  const clsAttr = (base: string): string => {
    const all = [...(base ? [base] : []), ...extraClasses];
    const cls = all.length > 0 ? ` class="${all.join(" ")}"` : "";
    const rest = extraAttrs.map(([k, v]) => ` ${k}="${md.utils.escapeHtml(v)}"`).join("");
    return cls + rest;
  };

  // data-emoji keeps the original shortcode — for serialization in the visual editor.
  let html: string | undefined;
  const svg = resolveIcon(name);
  if (svg) {
    html = `<span${clsAttr("twemoji")} data-emoji=":${name}:">${svg}</span>`;
  } else if (EMOJI[name]) {
    html = `<span${clsAttr("")} data-emoji=":${name}:">${md.utils.escapeHtml(EMOJI[name])}</span>`;
  }

  if (html === undefined) {
    return false;
  }
  if (!silent) {
    const token = state.push("html_inline", "", 0);
    token.content = html;
  }
  state.pos += match[0].length + extraLen;
  return true;
}

/** The `{…}` body consists only of `.class` and `key="value"` (the icon's attr_list). */
function isIconAttrs(body: string): boolean {
  return /^\s*(\.[\w-]+|[\w:-]+="[^"]*")(\s+(\.[\w-]+|[\w:-]+="[^"]*"))*\s*$/.test(body);
}
