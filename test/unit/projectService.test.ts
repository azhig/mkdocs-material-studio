// Which mkdocs.yml a file belongs to.
//
// The deepest config wins — except when that config is a SECTION of another
// site, pulled in with `!include`. Answering with the section means previewing
// the page without the styles, the palette and the navigation of the site it is
// really part of, and every fix downstream then works on the wrong config.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { ProjectService } from "../../src/core/projectService";

const { __reset, __setFoundFiles } = vscode as unknown as typeof import("../mocks/vscode");

let root: string;

function write(rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function uri(rel: string): vscode.Uri {
  return vscode.Uri.file(path.join(root, rel));
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "projects-"));
  // A monorepo site: the root config includes two section configs.
  write(
    "site/mkdocs.yml",
    [
      "site_name: Documentation",
      "nav:",
      "  - Home: index.md",
      "  - Library: '!include ./lib/mkdocs.yml'",
      "",
    ].join("\n"),
  );
  write(
    "site/lib/mkdocs.yml",
    ["site_name: lib", "nav:", "  - Home page: 2/index.md", ""].join("\n"),
  );
  // Two independent sites next to each other — nobody includes anybody.
  write("apart/mkdocs.yml", "site_name: Outer\n");
  write("apart/inner/mkdocs.yml", "site_name: Inner\n");
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  __reset();
  __setFoundFiles([
    uri("site/mkdocs.yml"),
    uri("site/lib/mkdocs.yml"),
    uri("apart/mkdocs.yml"),
    uri("apart/inner/mkdocs.yml"),
  ]);
});

describe("the project a file belongs to", () => {
  it("is the including site, not the section, for a page inside an !include", async () => {
    const project = await new ProjectService().findProjectFor(uri("site/lib/docs/2/index.md"));
    expect(project?.configFile.fsPath).toBe(uri("site/mkdocs.yml").fsPath);
  });

  it("is the site itself for its own pages", async () => {
    const project = await new ProjectService().findProjectFor(uri("site/docs/index.md"));
    expect(project?.configFile.fsPath).toBe(uri("site/mkdocs.yml").fsPath);
  });

  it("is still the nearest config when the configs are independent", async () => {
    const project = await new ProjectService().findProjectFor(uri("apart/inner/docs/index.md"));
    expect(project?.configFile.fsPath).toBe(uri("apart/inner/mkdocs.yml").fsPath);
  });

  it("is nothing at all for a file outside every project", async () => {
    const outside = vscode.Uri.file(path.join(os.tmpdir(), "elsewhere", "notes.md"));
    expect(await new ProjectService().findProjectFor(outside)).toBeUndefined();
  });

  it("climbs from a section even when the search found no configs at all", async () => {
    // findFiles is powerless outside the workspace; walking up has to do the same job.
    __setFoundFiles([]);
    const project = await new ProjectService().findProjectFor(uri("site/lib/docs/2/index.md"));
    expect(project?.configFile.fsPath).toBe(uri("site/mkdocs.yml").fsPath);
  });
});
