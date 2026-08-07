// Whether a path stays inside a folder. Snippet includes (`--8<-- "file.md"`)
// name a file with text from the page, and the page is text somebody else
// wrote — so what matters here are the answers for the paths that try to leave.

import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { isInside } from "../../src/util/paths";
import { readSnippetFrom } from "../../src/preview/snippetSource";

const base = path.resolve("/project/docs");

describe("isInside", () => {
  it("a file of the folder, and the folder itself", () => {
    expect(isInside(base, path.join(base, "guide.md"))).toBe(true);
    expect(isInside(base, path.join(base, "guide", "setup.md"))).toBe(true);
    expect(isInside(base, base)).toBe(true);
  });

  it("a path that climbs out is out, however it is spelled", () => {
    expect(isInside(base, path.join(base, "..", "mkdocs.yml"))).toBe(false);
    expect(isInside(base, path.join(base, "guide", "..", "..", "secrets.txt"))).toBe(false);
    expect(isInside(base, path.resolve("/etc/passwd"))).toBe(false);
  });

  it("a name that only starts like the folder is not in it", () => {
    expect(isInside(base, path.resolve("/project/docs-private/notes.md"))).toBe(false);
  });

  it("resolves a relative path against the process directory, not the base", () => {
    // `path.resolve` with one argument is relative to the cwd — the caller is
    // expected to join first, and this is what happens when it does not.
    expect(isInside(base, "guide.md")).toBe(false);
  });
});

describe("readSnippetFrom", () => {
  const files = new Map([
    [path.resolve("/project/docs/parts/note.md"), "a note"],
    [path.resolve("/project/mkdocs.yml"), "site_name: x"],
    [path.resolve("/home/user/.ssh/id_rsa"), "PRIVATE KEY"],
  ]);
  const read = (file: string) => files.get(file);
  const bases = [path.resolve("/project/docs/guide"), path.resolve("/project/docs")];

  it("takes the file from the first base directory that has it", () => {
    expect(readSnippetFrom(bases, "parts/note.md", read)).toBe("a note");
  });

  it("says nothing about a snippet nobody has", () => {
    expect(readSnippetFrom(bases, "parts/missing.md", read)).toBeUndefined();
  });

  it("does not read a file the page reaches for outside the project", () => {
    expect(readSnippetFrom(bases, "../../mkdocs.yml", read)).toBeUndefined();
    expect(readSnippetFrom(bases, "../../../home/user/.ssh/id_rsa", read)).toBeUndefined();
    expect(readSnippetFrom(bases, path.resolve("/home/user/.ssh/id_rsa"), read)).toBeUndefined();
  });

  it("a base that does have it still answers when an earlier one may not look", () => {
    // "../note.md" leaves the first base and stays inside the second.
    expect(
      readSnippetFrom(
        [path.resolve("/project/docs/parts/deep"), path.resolve("/project/docs")],
        "parts/note.md",
        read,
      ),
    ).toBe("a note");
  });
});
