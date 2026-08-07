// When a string is translated, and why it matters where t() is written.
//
// On the extension host the bundle is installed by loadTranslations() during
// activation. Module bodies run before that — imports are evaluated first — so
// a t() sitting at module level (in a constant, a lookup table, a default
// argument) always reads an empty bundle and returns its English key. Nothing
// fails, nothing is logged: the string is simply never translated, and the
// panel comes out half in one language and half in the other.
//
// This project shipped the defect twice. The mkdocs.yml editor built every
// label — field names, feature and plugin toggles, palette schemes — into
// module-level tables, so the panel stayed English while its frame was
// translated. The component palette hid the same thing one level deeper: its
// ~95 strings sat behind `const COMPONENTS = buildComponents()`, a call with no
// visible t() in it at all. So the check follows calls, not just the name: a
// function that translates, called at module level, counts.
//
// Webviews are the opposite case and are deliberately not checked here: the
// host embeds the bundle into the page shell as `window.__i18n` before the
// script tag, so by the time a webview module body runs the strings are already
// there — see webviews/shared/i18n.ts.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Calls to t() that are evaluated when the module is imported. */
function translationsAtImportTime(file: string): string[] {
  return scanSource(file, fs.readFileSync(file, "utf8"));
}

/** True for a node that owns a body, i.e. whose contents run when it is called. */
function defersItsBody(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/**
 * Functions of this file that translate — directly or by calling another one
 * that does. Calling one of these at module level is the same mistake as
 * writing `t()` there, only harder to see: the component registry hid ~95
 * strings behind `const COMPONENTS = buildComponents()`.
 */
function translatingFunctions(source: ts.SourceFile): Set<string> {
  const callsInside = new Map<string, Set<string>>();
  const translatesDirectly = new Set<string>();

  const nameOf = (node: ts.Node): string | undefined => {
    if (ts.isFunctionDeclaration(node)) {
      return node.name?.text;
    }
    if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      return node.parent.name.text;
    }
    return undefined;
  };

  const collect = (node: ts.Node, owner: string | undefined): void => {
    const name = defersItsBody(node) ? (nameOf(node) ?? owner) : owner;
    if (name && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (callee === "t") {
        translatesDirectly.add(name);
      } else {
        (callsInside.get(name) ?? callsInside.set(name, new Set()).get(name)!).add(callee);
      }
    }
    ts.forEachChild(node, (child) => collect(child, name));
  };
  ts.forEachChild(source, (node) => collect(node, undefined));

  // Close over the call graph: a → b → t() makes a a translating function too.
  const translating = new Set(translatesDirectly);
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, callees] of callsInside) {
      if (!translating.has(name) && [...callees].some((c) => translating.has(c))) {
        translating.add(name);
        changed = true;
      }
    }
  }
  return translating;
}

function scanSource(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const translating = translatingFunctions(source);

  const walk = (node: ts.Node, deferred: boolean): void => {
    if (!deferred && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      const where = `${path.relative(ROOT, file)}:${line + 1}`;
      if (callee === "t" && node.arguments.length > 0) {
        const first = node.arguments[0];
        const shown = ts.isStringLiteral(first) ? JSON.stringify(first.text) : "<expression>";
        found.push(`${where}  t(${shown})`);
      } else if (translating.has(callee)) {
        found.push(`${where}  ${callee}() — it translates inside`);
      }
    }
    ts.forEachChild(node, (child) => walk(child, deferred || defersItsBody(node)));
  };

  ts.forEachChild(source, (node) => walk(node, false));
  return found;
}

describe("the extension host translates when it renders, not when it loads", () => {
  it("has no t() that runs at import time", () => {
    const offenders = sourceFiles(path.join(ROOT, "src")).flatMap(translationsAtImportTime);
    // The message is the point of the test: it names the file and the line, and
    // the fix is always the same — move the call to where the value is used.
    expect(
      offenders,
      `These strings are translated before the bundle is loaded, so they stay English:\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\nMove the t() into the function that builds the value.`,
    ).toEqual([]);
  });

  it("recognises a deferred call as safe and an eager one as not", () => {
    // The check itself has to be checked: a walker that never reports anything
    // would make the test above pass for the wrong reason.
    const probe = [
      'import { t } from "./core/i18nCore";',
      'const EAGER = t("evaluated on import");',
      'const TABLE = [{ id: "x", label: t("in a table") }];',
      "export function lazy(): string {",
      '  return t("evaluated on call");',
      "}",
      'export const arrow = () => t("also on call");',
      'export class Panel {\n  title(): string {\n    return t("in a method");\n  }\n}',
      // The indirect form: a builder that translates, called at module level.
      "function build() {",
      '  return [{ label: t("built lazily") }];',
      "}",
      "const FROZEN = build();",
      "export default { EAGER, TABLE, lazy, arrow, Panel, FROZEN };",
    ].join("\n");

    const found = scanSource("probe.ts", probe);
    expect(found.map((f) => f.replace(/^probe\.ts:\d+\s+/, ""))).toEqual([
      't("evaluated on import")',
      't("in a table")',
      "build() — it translates inside",
    ]);
    // And a real file that only ever defers is clean.
    expect(translationsAtImportTime(path.join(ROOT, "src", "core", "i18nCore.ts"))).toEqual([]);
  });
});
