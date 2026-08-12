// The pieces of a webview's HTML shell that decide what the page is allowed to
// do. Everything here is one line of code and none of it is allowed to be
// wrong, which is exactly what makes it worth a test.

import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, embedJson, esc, makeNonce } from "../../src/util/webviewHtml";

describe("makeNonce", () => {
  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 500 }, () => makeNonce()));
    expect(seen.size).toBe(500);
  });

  it("carries enough entropy to be worth guessing at", () => {
    // 16 random bytes in base64 — 128 bits, the length the CSP note in the
    // VS Code docs asks for.
    expect(makeNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("never contains a character that would end the attribute it sits in", () => {
    for (let i = 0; i < 200; i++) {
      expect(makeNonce()).not.toMatch(/["'<>\s]/);
    }
  });
});

describe("esc", () => {
  it("escapes what would end a quoted attribute", () => {
    expect(esc('say "hi"')).toBe("say &quot;hi&quot;");
    expect(esc("it's")).toBe("it&#39;s");
  });

  it("escapes what would start a tag", () => {
    expect(esc("<img onerror=x>")).toBe("&lt;img onerror=x&gt;");
  });

  it("escapes the ampersand first, so nothing is escaped twice", () => {
    expect(esc("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text alone", () => {
    expect(esc("Bold — Ctrl+B")).toBe("Bold — Ctrl+B");
  });
});

describe("embedJson", () => {
  it("keeps a closing tag from ending the script block", () => {
    const json = embedJson({ text: "</script><img src=x onerror=alert(1)>" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toEqual({ text: "</script><img src=x onerror=alert(1)>" });
  });

  it("escapes the two separators that used to end a line of JavaScript", () => {
    const json = embedJson({ text: "a\u2028b\u2029c" });
    expect(json).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(json)).toEqual({ text: "a\u2028b\u2029c" });
  });

  it("survives a value JSON has no representation for", () => {
    expect(embedJson(undefined)).toBe("null");
  });

  it("is still JSON for an ordinary bundle", () => {
    const value = { lang: "ru", strings: { Bold: "Bold" } };
    expect(JSON.parse(embedJson(value))).toEqual(value);
  });
});

describe("contentSecurityPolicy", () => {
  it("allows nothing by default and scripts only with this page's nonce", () => {
    const csp = contentSecurityPolicy("vscode-webview://x", "N0NCE");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-N0NCE'");
    expect(csp).not.toContain("unsafe-eval");
    // 'unsafe-inline' belongs to styles only — a script must carry the nonce.
    expect(/script-src[^;]*unsafe-inline/.test(csp)).toBe(false);
  });

  it("adds a source only where it was asked for", () => {
    const csp = contentSecurityPolicy("SELF", "n", { img: ["https:", "data:"] });
    expect(csp).toContain("img-src SELF https: data:");
    expect(csp).toMatch(/font-src SELF(;|$)/);
    expect(csp).not.toContain("connect-src");
  });

  it("mentions connect-src for a page that fetches on its own", () => {
    expect(contentSecurityPolicy("SELF", "n", { connect: true })).toContain("connect-src SELF");
  });

  it("allows WebAssembly compilation only where explicitly requested", () => {
    expect(contentSecurityPolicy("SELF", "n", { wasm: true })).toContain("'wasm-unsafe-eval'");
    expect(contentSecurityPolicy("SELF", "n")).not.toContain("'wasm-unsafe-eval'");
  });
});
