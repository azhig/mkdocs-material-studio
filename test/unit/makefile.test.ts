// The Makefile is a convenience wrapper, and a wrapper that has fallen behind
// is worse than none: `make test` running only part of what `npm test` runs
// tells a contributor their change is fine when it has not been checked.
//
// This file drifted exactly that way — five scripts had no target, among them
// the integration tests and the coverage run — so the agreement is checked
// rather than remembered.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Scripts that exist for a tool to call, not for a person to type. */
const NOT_FOR_HUMANS = new Set(["vscode:prepublish"]);

function npmScripts(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  return Object.keys(pkg.scripts).filter((name) => !NOT_FOR_HUMANS.has(name));
}

function makefile(): string {
  return fs.readFileSync(path.join(ROOT, "Makefile"), "utf8");
}

/** The npm scripts a Makefile recipe runs, in order of appearance. */
function scriptsCalledByMake(): string[] {
  return Array.from(makefile().matchAll(/^\tnpm run ([\w:-]+)/gm), (m) => m[1]);
}

/** Targets declared with a `## help text` comment. */
function documentedTargets(): string[] {
  return Array.from(makefile().matchAll(/^([a-z][\w-]*):.*?## /gm), (m) => m[1]);
}

describe("the Makefile keeps up with package.json", () => {
  it("has a target for every npm script", () => {
    const missing = npmScripts().filter((name) => !scriptsCalledByMake().includes(name));
    expect(
      missing,
      `These npm scripts have no Makefile target, so \`make\` silently offers less than npm does:\n` +
        missing.map((m) => `  npm run ${m}`).join("\n"),
    ).toEqual([]);
  });

  it("calls no script that package.json does not have", () => {
    const known = new Set(
      Object.keys(
        (
          JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
            scripts: Record<string, string>;
          }
        ).scripts,
      ),
    );
    const stale = scriptsCalledByMake().filter((name) => !known.has(name));
    expect(stale, `Targets pointing at scripts that no longer exist: ${stale.join(", ")}`).toEqual(
      [],
    );
  });

  it("documents every target it declares, so `make help` is the whole list", () => {
    const declared = Array.from(makefile().matchAll(/^([a-z][\w-]*):/gm), (m) => m[1]).filter(
      (t) => t !== "help",
    );
    const undocumented = declared.filter((t) => !documentedTargets().includes(t));
    expect(undocumented, `Targets with no “## …” help text: ${undocumented.join(", ")}`).toEqual(
      [],
    );
  });

  it("declares every target as .PHONY — none of them produces a file of its own", () => {
    const phony = new Set(
      (makefile().match(/^\.PHONY:([\s\S]*?)(?=\n\n|\n[a-z])/m)?.[1] ?? "")
        .replace(/\\\n/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
    const declared = Array.from(makefile().matchAll(/^([a-z][\w-]*):/gm), (m) => m[1]);
    const missing = declared.filter((t) => !phony.has(t));
    expect(missing, `Targets missing from .PHONY: ${missing.join(", ")}`).toEqual([]);
  });
});
