// The project tree's commands, against a real mkdocs.yml on disk.
//
// These are the ones that touch the author's files: a new page writes a file
// and adds it to nav, a delete removes one for good. Both go through a
// confirmation the user can decline — declining has to mean nothing happened,
// and that is not something reading the code proves.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { TreeController } from "../../src/tree/treeController";
import type { MkdocsProject, ProjectService } from "../../src/core/projectService";
import { fakeContext, settle } from "../mocks/host";

const { __recorded, __reset, __setWorkspaceFolders } =
  vscode as unknown as typeof import("../mocks/vscode");

const CONFIG = `site_name: Test Docs
nav:
  - Home: index.md
  - Guide:
      - Writing: guide/writing.md
`;

let root: string;
let project: MkdocsProject;
let controller: TreeController;

/** Runs a registered command the way the palette does. */
async function run(command: string, ...args: unknown[]): Promise<void> {
  await vscode.commands.executeCommand(command, ...args);
  await settle();
}

async function configText(): Promise<string> {
  return fs.readFile(path.join(root, "mkdocs.yml"), "utf8");
}

beforeEach(async () => {
  __reset();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mkdocs-tree-"));
  await fs.mkdir(path.join(root, "docs", "guide"), { recursive: true });
  await fs.writeFile(path.join(root, "mkdocs.yml"), CONFIG, "utf8");
  await fs.writeFile(path.join(root, "docs", "index.md"), "# Home\n", "utf8");
  await fs.writeFile(path.join(root, "docs", "guide", "writing.md"), "# Writing\n", "utf8");

  const rootUri = vscode.Uri.file(root);
  __setWorkspaceFolders([rootUri]);
  project = {
    root: rootUri,
    configFile: vscode.Uri.joinPath(rootUri, "mkdocs.yml"),
    docsDir: vscode.Uri.joinPath(rootUri, "docs"),
  };
  const projects = {
    getProjects: () => Promise.resolve([project]),
    findProjectFor: () => Promise.resolve(project),
    invalidate: () => {},
  } as unknown as ProjectService;

  controller = new TreeController(fakeContext(root) as never, projects);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("a new page", () => {
  it("writes the file and adds it to the navigation", async () => {
    __recorded.inputBoxAnswers = ["Getting started", "getting-started.md"];
    await run("mkdocsStudio.tree.newPage");

    expect(await fs.readFile(path.join(root, "docs", "getting-started.md"), "utf8")).toBe(
      "# Getting started\n",
    );
    expect(await configText()).toContain("Getting started: getting-started.md");
  });

  it("creates the folders the path asks for", async () => {
    __recorded.inputBoxAnswers = ["Deep", "a/b/c/deep.md"];
    await run("mkdocsStudio.tree.newPage");
    expect(await fs.readFile(path.join(root, "docs", "a", "b", "c", "deep.md"), "utf8")).toBe(
      "# Deep\n",
    );
  });

  it("does nothing when the title is dismissed", async () => {
    const before = await configText();
    __recorded.inputBoxAnswers = [undefined];
    await run("mkdocsStudio.tree.newPage");
    expect(await configText()).toBe(before);
  });

  it("does nothing when the path is dismissed", async () => {
    const before = await configText();
    __recorded.inputBoxAnswers = ["Titled", undefined];
    await run("mkdocsStudio.tree.newPage");
    expect(await configText()).toBe(before);
    await expect(fs.readFile(path.join(root, "docs", "titled.md"), "utf8")).rejects.toThrow();
  });

  it("does not overwrite a page that is already there", async () => {
    __recorded.inputBoxAnswers = ["Home again", "index.md"];
    await run("mkdocsStudio.tree.newPage");
    expect(await fs.readFile(path.join(root, "docs", "index.md"), "utf8")).toBe("# Home\n");
  });
});

describe("a new section", () => {
  it("is added to the navigation", async () => {
    __recorded.inputBoxAnswers = ["Reference"];
    await run("mkdocsStudio.tree.newSection");
    expect(await configText()).toContain("Reference");
  });
});

describe("renaming", () => {
  it("changes the title in the navigation and leaves the file alone", async () => {
    __recorded.inputBoxAnswers = ["Start here"];
    await run("mkdocsStudio.tree.rename", { navPath: [0], title: "Home", project, type: "page" });

    const text = await configText();
    expect(text).toContain("Start here: index.md");
    expect(text).not.toContain("Home: index.md");
    expect(await fs.readFile(path.join(root, "docs", "index.md"), "utf8")).toBe("# Home\n");
  });

  it("does nothing when the same title comes back", async () => {
    const before = await configText();
    __recorded.inputBoxAnswers = ["Home"];
    await run("mkdocsStudio.tree.rename", { navPath: [0], title: "Home", project, type: "page" });
    expect(await configText()).toBe(before);
  });
});

describe("deleting", () => {
  it("removes an entry from the navigation once confirmed, keeping the file", async () => {
    __recorded.warningAnswer = "Remove";
    await run("mkdocsStudio.tree.delete", { navPath: [0], title: "Home", project, type: "page" });

    expect(await configText()).not.toContain("index.md");
    expect(await fs.readFile(path.join(root, "docs", "index.md"), "utf8")).toBe("# Home\n");
  });

  it("leaves the navigation alone when the confirmation is declined", async () => {
    const before = await configText();
    __recorded.warningAnswer = undefined;
    await run("mkdocsStudio.tree.delete", { navPath: [0], title: "Home", project, type: "page" });
    expect(await configText()).toBe(before);
  });

  it("deletes a loose file only once confirmed", async () => {
    const loose = path.join(root, "docs", "loose.md");
    await fs.writeFile(loose, "# Loose\n", "utf8");
    const node = {
      type: "loose",
      title: "loose.md",
      project,
      fileUri: vscode.Uri.file(loose),
    };

    __recorded.warningAnswer = undefined;
    await run("mkdocsStudio.tree.delete", node);
    expect(await fs.readFile(loose, "utf8")).toBe("# Loose\n");

    __recorded.warningAnswer = "Delete";
    await run("mkdocsStudio.tree.delete", node);
    await expect(fs.readFile(loose, "utf8")).rejects.toThrow();
  });

  it("does nothing without a node", async () => {
    const before = await configText();
    await run("mkdocsStudio.tree.delete");
    expect(await configText()).toBe(before);
  });
});

describe("the commands the tree contributes", () => {
  it("are all registered", () => {
    expect(controller).toBeDefined();
    for (const command of [
      "mkdocsStudio.tree.refresh",
      "mkdocsStudio.tree.newPage",
      "mkdocsStudio.tree.newSection",
      "mkdocsStudio.tree.rename",
      "mkdocsStudio.tree.delete",
      "mkdocsStudio.tree.openConfig",
    ]) {
      expect(() => vscode.commands.executeCommand(command)).not.toThrow();
    }
  });
});
