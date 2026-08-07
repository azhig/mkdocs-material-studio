// The repository is written in English — code, comments, fixtures and docs.
//
// The rule matters more than it looks. A fixture in one language and a test
// name in another is a file two people can only half read, and a contributor
// who cannot read the fixture cannot tell a deliberate edge case from a typo.
// The translations are the one place where other languages belong, because
// there they are the subject rather than the medium.
//
// This test enforces the Cyrillic half of that rule, which is the one this
// project actually drifted on: 569 lines across 32 files, almost all of them
// test fixtures. Cleaning them up also turned up two real defects the mixture
// had hidden — a slug regex that quietly dropped every non-Latin letter from a
// file name, and a language list whose labels no longer matched their codes.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "../..");
// Written as code points on purpose: spelling the range out with the letters
// themselves would make this file its own first offender.
const CYRILLIC = /[\u0400-\u052F]/;

/**
 * Where other languages are the content rather than the language of the code:
 * the interface bundles and the manifest's NLS files.
 */
const TRANSLATIONS = [/^assets\/i18n\//, /^package\.nls(\.[\w-]+)?\.json$/];

/**
 * Third-party files that live here only because they ship with the extension:
 * the Material/FontAwesome/Octicons icon set, the vendored scripts and the
 * Material stylesheets. Nobody writes prose in them, and there are 14 000 of
 * the icons alone — reading them all took longer than the test timeout on the
 * slower CI runners, for nothing.
 */
const VENDORED = [/^assets\/icons\//, /^assets\/vendor\//, /^assets\/material-css\//];

/**
 * The files of the repository we write ourselves, minus the ones that are not
 * text. Untracked ones count too (`--others`, minus what .gitignore covers): a
 * brand new file is exactly where the rule gets broken, and checking only
 * `git ls-files` let a fresh test through here and failed on CI instead, after
 * the commit.
 */
function ourTextFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  return listed.filter((rel) => {
    if ([...TRANSLATIONS, ...VENDORED].some((re) => re.test(rel))) {
      return false;
    }
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return false;
    }
    // Binary files (icons, fonts, the recording) are not ours to read.
    return !/\.(png|jpe?g|gif|webp|ttf|woff2?|eot|ico|vsix|pdf)$/i.test(rel);
  });
}

describe("the repository speaks one language", () => {
  it("has no Cyrillic outside the translation bundles", () => {
    const offenders: string[] = [];
    for (const rel of ourTextFiles()) {
      let text: string;
      try {
        text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      } catch {
        continue; // not decodable as UTF-8 — not a text file after all
      }
      if (!CYRILLIC.test(text)) {
        continue;
      }
      text.split("\n").forEach((line, i) => {
        if (CYRILLIC.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }
    expect(
      offenders,
      "English only outside assets/i18n and package.nls*.json. " +
        "A test fixture needing non-Latin text can use any other script — " +
        "Greek, Chinese, or Latin with diacritics — see imageNames.test.ts:\n" +
        offenders
          .slice(0, 20)
          .map((o) => `  ${o}`)
          .join("\n"),
    ).toEqual([]);
  });

  it("still finds Cyrillic where it belongs", () => {
    // Without this the test above would pass on a repository that had lost its
    // Russian bundle altogether, which is not the same thing as being clean.
    const ru = fs.readFileSync(path.join(ROOT, "assets/i18n/ru.json"), "utf8");
    expect(CYRILLIC.test(ru)).toBe(true);
  });
});
