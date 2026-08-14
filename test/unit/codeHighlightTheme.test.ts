// The colors of a code block in the preview.
//
// The site highlights with Pygments, the preview with highlight.js. The class
// names differ and always will; the colors must not. This used to be a
// hard-coded GitHub palette written twice, once per scheme — the site had blue
// keywords where the preview had red ones, and a project that recolored
// `--md-code-hl-*` in its extra.css was not listened to at all.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const cssFile = path.resolve(__dirname, "..", "..", "assets", "fallback.css");
const css = fs.readFileSync(cssFile, "utf8");

/** The rules of the stylesheet as (selector, body) pairs, comments stripped. */
function rules(): Array<{ selector: string; body: string }> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ selector: string; body: string }> = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    out.push({ selector: match[1].trim(), body: match[2] });
  }
  return out;
}

const highlightRules = rules().filter((rule) => rule.selector.includes(".hljs-"));

describe("the highlight.js theme of the preview", () => {
  it("takes every color from a Material variable", () => {
    const literal = highlightRules
      .flatMap((rule) =>
        rule.body
          .split(";")
          .map((decl) => decl.trim())
          .filter((decl) => /^color\s*:/.test(decl) && !decl.includes("var(--md-code-hl-"))
          .map((decl) => `${rule.selector.split("\n").join(" ")} { ${decl} }`),
      )
      .filter(Boolean);
    expect(
      literal,
      "A highlight color written out instead of taken from Material:\n" + literal.join("\n"),
    ).toEqual([]);
  });

  it("names the roles a reader of code actually sees", () => {
    const used = new Set(
      [...css.matchAll(/var\((--md-code-hl-[a-z-]+-color)\)/g)].map((m) => m[1]),
    );
    for (const role of [
      "keyword",
      "string",
      "number",
      "comment",
      "function",
      "constant",
      "variable",
    ]) {
      expect(used, `no rule paints ${role}`).toContain(`--md-code-hl-${role}-color`);
    }
  });

  it("has no second copy of itself for the slate scheme", () => {
    // Material redefines the variables per scheme, so a scheme-specific rule here
    // means the colors were pinned again and the two halves will drift apart.
    const perScheme = highlightRules.filter((rule) =>
      rule.selector.includes("data-md-color-scheme"),
    );
    expect(perScheme.map((r) => r.selector)).toEqual([]);
  });
});
