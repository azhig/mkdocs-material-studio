// The HTML shell of a webview panel. Every panel builds its own markup, but the
// three things that must not be got wrong are the same everywhere: the nonce
// that decides which scripts may run, the escaping of the values interpolated
// into that markup, and the policy that ties them together.

import { randomBytes } from "node:crypto";

/**
 * A fresh nonce for the page's Content-Security-Policy. It is the single reason
 * the page's own scripts are allowed to run, so it has to be unguessable:
 * `Math.random()` is a predictable sequence, and a predictable nonce would let
 * any markup that slipped into the page execute.
 */
export function makeNonce(): string {
  return randomBytes(16).toString("base64");
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes a value for HTML — correct both as text and inside a quoted
 * attribute. The shells interpolate translated strings, and a quotation mark in
 * a translation would otherwise close the attribute halfway through the word.
 */
export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** `<` ends a script block early; the two separators used to end a line of JavaScript. */
const SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * JSON for a value inlined into a `<script>` block. `JSON.stringify` alone is
 * not enough there: the browser looks for `</script>` before it looks at the
 * JavaScript, so a string containing one would end the block and the rest of
 * the data would be read as markup.
 */
export function embedJson(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(/[<\u2028\u2029]/g, (c) => SCRIPT_ESCAPES[c]);
}

/** What a panel needs on top of its own resources. */
export interface CspExtras {
  /** Image sources besides the webview's own — a page may show a picture from `https:` or a data URL. */
  img?: string[];
  /** Font sources besides the webview's own — a theme may pull a font from a CDN. */
  font?: string[];
  /** Whether the page fetches anything itself (the visual editor loads its icons). */
  connect?: boolean;
}

/**
 * The policy for a panel: nothing is allowed by default, styles and resources
 * come from the extension, and scripts run only with this page's nonce.
 */
export function contentSecurityPolicy(
  webviewSource: string,
  nonce: string,
  extras: CspExtras = {},
): string {
  const directives = [
    "default-src 'none'",
    `style-src ${webviewSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${[webviewSource, ...(extras.img ?? [])].join(" ")}`,
    `font-src ${[webviewSource, ...(extras.font ?? [])].join(" ")}`,
  ];
  if (extras.connect) {
    directives.push(`connect-src ${webviewSource}`);
  }
  return directives.join("; ");
}
