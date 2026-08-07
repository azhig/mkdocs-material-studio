// URLs inside user CSS (extra_css). Styles are inlined into the webview,
// so relative paths must be recomputed against the stylesheet file — otherwise
// the project's fonts and background images will not load.

import { describe, expect, it } from "vitest";
import { rewriteCssUrls } from "../../src/core/cssUrls";

const resolve = (target: string): string => `https://webview.test/docs/${target}`;

describe("rewriteCssUrls", () => {
  it("rewrites relative paths", () => {
    expect(rewriteCssUrls(".a{background:url(img/bg.png)}", resolve)).toBe(
      '.a{background:url("https://webview.test/docs/img/bg.png")}',
    );
    expect(rewriteCssUrls('.a{background:url("../img/bg.png")}', resolve)).toBe(
      '.a{background:url("https://webview.test/docs/../img/bg.png")}',
    );
    expect(rewriteCssUrls(".a{background:url( 'bg.png' )}", resolve)).toBe(
      '.a{background:url("https://webview.test/docs/bg.png")}',
    );
  });

  it("leaves absolute URLs, data: and anchors alone", () => {
    for (const src of [
      ".a{background:url(https://cdn.example/bg.png)}",
      ".a{background:url(//cdn.example/bg.png)}",
      ".a{background:url(/absolute/bg.png)}",
      ".a{background:url(data:image/png;base64,AAA)}",
      ".a{filter:url(#blur)}",
    ]) {
      expect(rewriteCssUrls(src, resolve)).toBe(src);
    }
  });

  it("handles @font-face with several sources", () => {
    const css =
      "@font-face{font-family:X;src:url(fonts/x.woff2) format('woff2'),url(fonts/x.woff) format('woff')}";
    expect(rewriteCssUrls(css, resolve)).toBe(
      "@font-face{font-family:X;src:url(\"https://webview.test/docs/fonts/x.woff2\") format('woff2')," +
        "url(\"https://webview.test/docs/fonts/x.woff\") format('woff')}",
    );
  });

  it("does not break CSS without URLs", () => {
    const css = ".md-typeset h1 { color: #123456; }";
    expect(rewriteCssUrls(css, resolve)).toBe(css);
  });
});
