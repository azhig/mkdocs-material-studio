// The scratch directory has to be invisible to three different tools, and each
// of them reads a file of its own.
//
// It was added for a reproduction page kept in the working tree — the language
// and formatting checks read every file git does not ignore, so a scratch file
// left at the root turned the suite red. Ignoring it in .gitignore is not
// enough: `vsce` reads .vscodeignore and nothing else, and the first package
// built after that shipped the scratch page to every user of the extension.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

function lines(file: string): string[] {
  return fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

describe("the scratch directory stays out of everything", () => {
  it("is ignored by git, by prettier and by the package", () => {
    const missing = (
      [
        [".gitignore", "scratch/"],
        [".prettierignore", "scratch/"],
        // vsce matches globs, so the directory alone would not cover its files.
        [".vscodeignore", "scratch/**"],
      ] as Array<[string, string]>
    ).filter(([file, entry]) => !lines(file).includes(entry));
    expect(
      missing,
      `Add the entry to each of these:\n` + missing.map(([f, e]) => `  ${f}: ${e}`).join("\n"),
    ).toEqual([]);
  });
});
