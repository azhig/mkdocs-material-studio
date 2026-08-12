// The README is the Marketplace page: it is the only documentation most people
// will ever read, and it is written by hand while the manifest changes in code.
//
// The two had already drifted — seven commands and one setting existed with no
// mention on the page, and nobody notices, because a README cannot fail to
// compile. So the agreement is checked instead of remembered: every command and
// every setting the extension contributes is named there, and nothing is named
// there that the extension does not contribute.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    configuration: { properties: Record<string, { default?: unknown }> };
  };
}

function manifest(): Manifest {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Manifest;
}

/** The English title of a command; the manifest stores an %nls% placeholder. */
function commandTitles(): string[] {
  const nls = JSON.parse(fs.readFileSync(path.join(ROOT, "package.nls.json"), "utf8")) as Record<
    string,
    string
  >;
  return manifest().contributes.commands.map(({ title }) => {
    const key = title.replace(/%/g, "");
    return nls[key] ?? title;
  });
}

function settingKeys(): string[] {
  return Object.keys(manifest().contributes.configuration.properties);
}

function readme(): string {
  return fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
}

describe("the README describes the extension that is actually shipped", () => {
  it("names every command", () => {
    const text = readme();
    const missing = commandTitles().filter((title) => !text.includes(title));
    expect(
      missing,
      `Commands the extension has and the Marketplace page does not mention:\n` +
        missing.map((m) => `  MkDocs: ${m}`).join("\n"),
    ).toEqual([]);
  });

  it("names every setting", () => {
    const text = readme();
    const missing = settingKeys().filter((key) => !text.includes(key));
    expect(
      missing,
      `Settings with no line in the README:\n` + missing.map((m) => `  ${m}`).join("\n"),
    ).toEqual([]);
  });

  it("defaults both palette schemes to cyan", () => {
    const properties = manifest().contributes.configuration.properties;
    for (const scheme of ["light", "dark"]) {
      for (const role of ["primary", "accent"]) {
        expect(properties[`mkdocsStudio.palette.${scheme}.${role}`]?.default).toBe("cyan");
      }
    }
  });

  it("promises no setting that does not exist", () => {
    // A `mkdocsStudio.*` written in the README but absent from the manifest is
    // worse than a missing one: the reader puts it in settings.json and waits
    // for something to happen.
    const known = new Set(settingKeys());
    const invented = Array.from(
      new Set(Array.from(readme().matchAll(/`(mkdocsStudio\.[\w.]+)`/g), (m) => m[1])),
    ).filter((key) => !known.has(key));
    expect(
      invented,
      `Named in the README, missing from package.json: ${invented.join(", ")}`,
    ).toEqual([]);
  });

  it("still looks like a Marketplace page", () => {
    // The sections a reader of any VS Code extension expects to find. Losing one
    // in an edit is easy and invisible.
    const text = readme();
    for (const heading of [
      "## Features",
      "## Getting started",
      "## Requirements",
      "## Commands",
      "## Keyboard shortcuts",
      "## Extension settings",
      "## Troubleshooting",
      "## License",
    ]) {
      expect(text, `The README has no “${heading}” section`).toContain(heading);
    }
  });
});
