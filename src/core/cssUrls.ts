/**
 * Rewriting of links inside custom CSS. Kept apart from extraCss.ts (which
 * depends on vscode) — a pure function that can be unit-tested.
 */

/**
 * Replaces relative `url(...)` values with addresses the webview understands:
 * otherwise inline CSS would look for fonts and images next to the webview
 * document itself rather than next to the stylesheet. Absolute links, `data:`
 * and anchors such as `url(#filter)` are left untouched.
 */
export function rewriteCssUrls(css: string, resolve: (target: string) => string): string {
  return css.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (whole, _quote: string, target: string) => {
      const value = target.trim();
      if (value === "" || /^(data:|https?:|blob:|#|\/\/|\/)/i.test(value)) {
        return whole;
      }
      return `url("${resolve(value)}")`;
    },
  );
}
