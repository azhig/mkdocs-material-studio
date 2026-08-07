/**
 * Rewriting of media links in the rendered HTML. Kept apart from the renderer
 * (which depends on vscode) — a pure function that can be unit-tested.
 */

/** The tags whose addresses point at files of the project rather than at the network. */
const MEDIA_TAG = /<(img|source|video|audio|embed)\b([^>]*)>/gi;
const SIMPLE_ATTR = /(\s(src|poster)\s*=\s*)(["'])([^"']*)\3/gi;
const SRCSET_ATTR = /(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi;

/**
 * A link that points at a file next to the document. Network schemes, `data:`,
 * protocol-relative addresses and pure anchors are left to the browser.
 */
function isLocal(value: string): boolean {
  const v = value.trim();
  if (v === "" || v.startsWith("#") || v.startsWith("//")) {
    return false;
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(v);
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Points the addresses of images, video and audio at the files of the project.
 * A webview has a base of its own, so `doc/assets/logo.svg` is looked for next
 * to the webview document and never found — every local link has to become an
 * address the webview is allowed to load.
 *
 * The original is kept in `data-md-src`: the visual editor serializes the image back
 * into Markdown from it, otherwise the file would be handed a `vscode-webview:`
 * address. `resolve` returns undefined for a link it cannot map — that one is
 * left as it was.
 */
export function rewriteHtmlAssetUrls(
  html: string,
  resolve: (target: string) => string | undefined,
): string {
  return html.replace(MEDIA_TAG, (whole, tag: string, attrs: string) => {
    // `<img … />` — the trailing slash is put back after the attributes.
    const selfClosing = /\/\s*$/.test(attrs);
    let body = selfClosing ? attrs.replace(/\s*\/\s*$/, "") : attrs;
    let original: string | undefined;
    let changed = false;

    body = body.replace(
      SIMPLE_ATTR,
      (attr: string, prefix: string, name: string, quote: string, value: string) => {
        if (!isLocal(value)) {
          return attr;
        }
        const next = resolve(decodeAttr(value).trim());
        if (next === undefined) {
          return attr;
        }
        if (name.toLowerCase() === "src") {
          original = value;
        }
        changed = true;
        return `${prefix}${quote}${encodeAttr(next)}${quote}`;
      },
    );

    body = body.replace(
      SRCSET_ATTR,
      (_attr: string, prefix: string, quote: string, value: string) => {
        // `a.png 1x, b.png 2x` — the address is the first token of an entry.
        const parts = value.split(",").map((entry) => {
          const trimmed = entry.trim();
          if (trimmed === "") {
            return entry;
          }
          const space = trimmed.search(/\s/);
          const url = space < 0 ? trimmed : trimmed.slice(0, space);
          const descriptor = space < 0 ? "" : trimmed.slice(space);
          if (!isLocal(url)) {
            return trimmed;
          }
          const next = resolve(decodeAttr(url));
          if (next === undefined) {
            return trimmed;
          }
          changed = true;
          return `${encodeAttr(next)}${descriptor}`;
        });
        return `${prefix}${quote}${parts.join(", ")}${quote}`;
      },
    );

    if (!changed) {
      return whole; // nothing local in the tag — the markup is left byte for byte
    }
    if (original !== undefined && !/\sdata-md-src\s*=/i.test(body)) {
      body += ` data-md-src="${original}"`;
    }
    return `<${tag}${body}${selfClosing ? " /" : ""}>`;
  });
}
