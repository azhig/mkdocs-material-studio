import { describe, it, expect } from "vitest";
import { rewriteHtmlAssetUrls } from "../../src/core/assetUrls";

/** The panel's translator: a path becomes an address the webview may load. */
const resolve = (target: string): string | undefined =>
  target.startsWith("missing/") ? undefined : `https://webview.test/${target}`;

describe("rewriteHtmlAssetUrls", () => {
  it("points a relative image at the file and keeps the author's path", () => {
    const out = rewriteHtmlAssetUrls('<p><img src="doc/assets/logo.svg" alt="Logo"></p>', resolve);
    expect(out).toContain('src="https://webview.test/doc/assets/logo.svg"');
    expect(out).toContain('data-md-src="doc/assets/logo.svg"');
    expect(out).toContain('alt="Logo"');
  });

  it("leaves the network and data links alone", () => {
    const html =
      '<img src="https://img.shields.io/badge.svg">' +
      '<img src="data:image/png;base64,AAA">' +
      '<img src="//cdn.example.com/a.png">';
    expect(rewriteHtmlAssetUrls(html, resolve)).toBe(html);
  });

  it("leaves a link it cannot map as it was", () => {
    const html = '<img src="missing/none.png">';
    expect(rewriteHtmlAssetUrls(html, resolve)).toBe(html);
  });

  it("keeps a self-closing tag self-closing", () => {
    const out = rewriteHtmlAssetUrls('<img src="a.png" width="32" />', resolve);
    expect(out).toBe('<img src="https://webview.test/a.png" width="32" data-md-src="a.png" />');
  });

  it("handles video with a poster and source", () => {
    const out = rewriteHtmlAssetUrls(
      '<video poster="doc/cover.jpg" controls><source src="doc/clip.mp4"></video>',
      resolve,
    );
    expect(out).toContain('poster="https://webview.test/doc/cover.jpg"');
    expect(out).toContain('src="https://webview.test/doc/clip.mp4"');
  });

  it("rewrites every entry of a srcset", () => {
    const out = rewriteHtmlAssetUrls('<img srcset="a.png 1x, https://x/b.png 2x">', resolve);
    expect(out).toContain("https://webview.test/a.png 1x");
    expect(out).toContain("https://x/b.png 2x");
  });

  it("decodes the HTML entities of an address before resolving it", () => {
    // markdown-it escapes “&” in a link; the resolver must see the real path.
    const out = rewriteHtmlAssetUrls('<img src="a&amp;b.png">', resolve);
    expect(out).toContain('src="https://webview.test/a&amp;b.png"');
    expect(out).toContain('data-md-src="a&amp;b.png"'); // the file keeps the author's form
  });

  it("does not touch tags without an address", () => {
    const html = "<img><p>text</p>";
    expect(rewriteHtmlAssetUrls(html, resolve)).toBe(html);
  });
});
