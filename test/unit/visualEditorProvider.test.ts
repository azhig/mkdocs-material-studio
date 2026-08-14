// The visual editor's half of the protocol, driven end to end.
//
// The editor sends a batch of line edits; the provider turns them into a
// WorkspaceEdit and the file changes. Nothing between the message and the text
// was ever checked, and it is the only path in the extension that can lose the
// author's work. Here the document really holds text, applyEdit really applies,
// and every assertion is on what the file says afterwards.

import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { VisualEditorProvider } from "../../src/wysiwyg/visualEditorProvider";
import {
  FakeWebviewPanel,
  echoRenderer,
  fakeContext,
  noProjects,
  projectAt,
  recordingInsertPanel,
  settle,
} from "../mocks/host";

const { FakeTextDocument, __recorded, __reset, __setSetting } =
  vscode as unknown as typeof import("../mocks/vscode");

/** A provider wired to a document, with the editor already resolved. */
async function open(
  text: string,
  projects = noProjects(),
): Promise<{
  doc: InstanceType<typeof FakeTextDocument>;
  panel: FakeWebviewPanel;
  insertPanel: ReturnType<typeof recordingInsertPanel>;
}> {
  const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), text);
  const panel = new FakeWebviewPanel();
  const insertPanel = recordingInsertPanel();
  const provider = new VisualEditorProvider(
    fakeContext() as never,
    projects,
    echoRenderer(),
    insertPanel,
  );
  provider.resolveCustomTextEditor(doc as never, panel as never, {} as never);
  await settle();
  panel.clear();
  return { doc, panel, insertPanel };
}

/** Sends a batch against the document's current version. */
async function sync(
  doc: InstanceType<typeof FakeTextDocument>,
  panel: FakeWebviewPanel,
  edits: { start: number; end: number; text: string }[],
): Promise<void> {
  await panel.send({ type: "sync", baseVersion: doc.version, edits });
}

beforeEach(() => {
  __reset();
  __setSetting("mkdocsStudio.language", "en");
});

describe("the shell", () => {
  it("is built before anything is posted", async () => {
    const { panel } = await open("# Title\n");
    expect(panel.webview.html).toContain("<!DOCTYPE html>");
    expect(panel.webview.html).toContain('id="doc"');
    expect(panel.webview.html).toContain("Content-Security-Policy");
  });

  it("answers “ready” with the render and the settings", async () => {
    const { panel } = await open("# Title\n");
    await panel.send({ type: "ready" });
    expect(panel.last("render")?.text).toBe("# Title\n");
    expect(panel.last("uiConfig")).toBeDefined();
    expect(panel.last("chromeState")).toBeDefined();
  });
});

describe("sync: what reaches the file", () => {
  it("applies a replacement", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(doc, panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nChanged.\n");
    expect(panel.last("synced")).toBeDefined();
    expect(panel.ofType("rejected")).toHaveLength(0);
  });

  it("applies an insert and a delete in one batch", async () => {
    const { doc, panel } = await open("one\n\ntwo\n\nthree\n");
    await sync(doc, panel, [
      { start: 0, end: 0, text: "zero\n\n" },
      { start: 2, end: 4, text: "" },
    ]);
    expect(doc.getText()).toBe("zero\n\none\n\nthree\n");
  });

  it("does not grow a file that ends without a newline", async () => {
    const { doc, panel } = await open("# Title\n\nBody.");
    await sync(doc, panel, [{ start: 2, end: 3, text: "Other.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nOther.");
  });

  it("an empty batch changes nothing but still answers", async () => {
    const { doc, panel } = await open("# Title\n");
    await sync(doc, panel, []);
    expect(doc.getText()).toBe("# Title\n");
    expect(doc.version).toBe(1);
    expect(panel.last("synced")).toBeDefined();
  });
});

describe("sync: what is refused", () => {
  it("refuses a batch built against stale text", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await panel.send({
      type: "sync",
      baseVersion: doc.version - 1,
      edits: [{ start: 0, end: 3, text: "gone\n" }],
    });
    expect(doc.getText()).toBe("# Title\n\nBody.\n");
    expect(panel.last("rejected")?.version).toBe(doc.version);
    // And a full render follows, so the editor can start over from the file.
    expect(panel.last("render")?.text).toBe("# Title\n\nBody.\n");
  });

  it.each([
    ["not an array", "nonsense"],
    ["a member that is not an object", [42]],
    ["a line that is not a number", [{ start: "0", end: 1, text: "x\n" }]],
    ["a negative line", [{ start: -1, end: 1, text: "x\n" }]],
    ["a reversed range", [{ start: 5, end: 2, text: "x\n" }]],
    ["NaN", [{ start: Number.NaN, end: 1, text: "x\n" }]],
    ["text that is not a string", [{ start: 0, end: 1, text: null }]],
  ])("refuses a batch with %s", async (_name, edits) => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await panel.send({ type: "sync", baseVersion: doc.version, edits });
    expect(doc.getText()).toBe("# Title\n\nBody.\n");
    expect(panel.last("rejected")).toBeDefined();
    expect(__recorded.errors.join("\n")).toContain("malformed");
  });

  it("reports a refused applyEdit instead of losing the change quietly", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    __recorded.refuseEdits = true;
    await sync(doc, panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nBody.\n");
    expect(panel.last("rejected")).toBeDefined();
    expect(__recorded.warnings.join("\n")).toContain("applyEdit");
  });

  it("a handler that throws is logged, not swallowed into an unhandled rejection", async () => {
    const { panel } = await open("# Title\n");
    // saveImage with data that is not base64 at all: the failure has to come
    // back to the webview, otherwise the paste hangs on a spinner forever.
    await panel.send({ type: "saveImage", token: 7, data: "", mime: "image/png", name: "x.png" });
    expect(panel.last("imageSaveFailed")?.token).toBe(7);
  });
});

describe("sync: the editor's own edits do not bounce back", () => {
  it("a version we produced does not trigger a full render", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(doc, panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(panel.ofType("synced")).toHaveLength(1);
    // The full render is debounced: asserting straight away would pass whether
    // the version was recognised as ours or not. A "render" arriving here would
    // throw the caret back to the top of the document on every keystroke.
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(panel.ofType("render")).toHaveLength(0);
  });

  it("and does not when the change is reported after applyEdit has returned", async () => {
    // The other order VS Code is allowed to use. Here the counter is already
    // back to zero and the version has to carry it.
    __recorded.changeEvent = "after";
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(doc, panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(doc.getText()).toBe("# Title\n\nChanged.\n");
    expect(panel.ofType("render")).toHaveLength(0);
  });

  it("an edit from outside does trigger a full render", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    doc.setText("# Title\n\nEdited elsewhere.\n");
    (vscode as unknown as typeof import("../mocks/vscode")).__onDidChangeTextDocument.fire({
      document: doc,
      contentChanges: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 320)); // the render is debounced
    expect(panel.last("render")?.text).toBe("# Title\n\nEdited elsewhere.\n");
  });
});

describe("links", () => {
  it("opens an http address", async () => {
    const { panel } = await open("# Title\n");
    await panel.send({ type: "openLink", href: "https://example.com/docs" });
    expect(__recorded.openedExternal).toEqual(["https://example.com/docs"]);
  });

  it("refuses a scheme that is not on the list", async () => {
    const { panel } = await open("# Title\n");
    for (const href of ["javascript:alert(1)", "vscode:extension/x", "file:///etc/passwd"]) {
      await panel.send({ type: "openLink", href });
    }
    expect(__recorded.openedExternal).toEqual([]);
    expect(__recorded.warnings.join("\n")).toContain("refused");
  });

  it("leaves an anchor alone", async () => {
    const { panel } = await open("# Title\n");
    await panel.send({ type: "openLink", href: "#section" });
    expect(__recorded.openedExternal).toEqual([]);
    expect(__recorded.executedCommands).toEqual([]);
  });
});

describe("settings the editor writes back", () => {
  it("stores the ones it understands and ignores the rest", async () => {
    const { panel } = await open("# Title\n");
    await panel.send({
      type: "setConfig",
      inlineFormatting: "selection",
      toolbarButtons: ["table", 42, "code"],
      keybindings: { bold: "Ctrl+B", broken: 5 },
    });
    const cfg = vscode.workspace.getConfiguration("mkdocsStudio");
    expect(cfg.get("inlineFormatting")).toBe("selection");
    expect(cfg.get("toolbarButtons")).toEqual(["table", "code"]);
    expect(cfg.get("keybindings")).toEqual({ bold: "Ctrl+B" });
  });
});

describe("pickFile: the path written into the document", () => {
  // Resolving the editor warns on its own schedule (the fake project has no
  // real mkdocs.yml on disk, and the read is real I/O) — counting ALL warnings
  // is a race. Only the snippet refusal mentions a snippet.
  const snippetWarnings = () => __recorded.warnings.filter((w) => w.includes("snippet"));

  it("a snippet path is measured from the project root, not from the page", async () => {
    // The page lives in /work/docs; the picked file in /work. A page-relative
    // answer ("../CLAUDE.md") escapes every snippet base and renders as
    // “Snippet not found” — the root-relative one is what resolves.
    const { panel } = await open("# Title\n", projectAt("/work"));
    __recorded.openDialogResult = [vscode.Uri.file("/work/CLAUDE.md")];
    await panel.send({ type: "pickFile", kind: "snippet", token: 7 });
    await settle();
    expect(panel.last("filePicked")).toMatchObject({ token: 7, relPath: "CLAUDE.md" });
    expect(snippetWarnings()).toEqual([]);
  });

  it("a snippet outside the project is refused with a warning, not inserted broken", async () => {
    const { panel } = await open("# Title\n", projectAt("/work"));
    __recorded.openDialogResult = [vscode.Uri.file("/elsewhere/readme.md")];
    await panel.send({ type: "pickFile", kind: "snippet", token: 8 });
    await settle();
    expect(panel.last("filePicked")).toMatchObject({ token: 8, relPath: "" });
    expect(snippetWarnings()).toHaveLength(1);
  });

  it("without a project the page's folder stands in for the root", async () => {
    const { panel } = await open("# Title\n");
    __recorded.openDialogResult = [vscode.Uri.file("/work/docs/parts/note.md")];
    await panel.send({ type: "pickFile", kind: "snippet", token: 9 });
    await settle();
    expect(panel.last("filePicked")).toMatchObject({ token: 9, relPath: "parts/note.md" });
  });

  it("an image path stays relative to the page — images resolve from it", async () => {
    const { panel } = await open("# Title\n", projectAt("/work"));
    __recorded.openDialogResult = [vscode.Uri.file("/work/logo.png")];
    await panel.send({ type: "pickFile", kind: "image", token: 10 });
    await settle();
    expect(panel.last("filePicked")).toMatchObject({ token: 10, relPath: "../logo.png" });
    expect(snippetWarnings()).toEqual([]);
  });

  it("an image also comes back as an address the webview can display", async () => {
    // The relative path belongs in the file and nowhere else: a webview resolves
    // it against its own base and shows an empty frame. The form previews the
    // picture and then puts it in the page, so it needs the other address too.
    const { panel } = await open("# Title\n", projectAt("/work"));
    __recorded.openDialogResult = [vscode.Uri.file("/work/logo.png")];
    await panel.send({ type: "pickFile", kind: "image", token: 11 });
    await settle();
    expect(String(panel.last("filePicked")?.webUri)).toContain("/work/logo.png");
  });

  it("a snippet needs no such address — nothing displays it", async () => {
    const { panel } = await open("# Title\n", projectAt("/work"));
    __recorded.openDialogResult = [vscode.Uri.file("/work/CLAUDE.md")];
    await panel.send({ type: "pickFile", kind: "snippet", token: 12 });
    await settle();
    expect(panel.last("filePicked")?.webUri).toBe("");
  });
});

describe("saveImage: what comes back to the editor", () => {
  it("carries both the path for the file and the address for the screen", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mkdocs-paste-"));
    try {
      const doc = new FakeTextDocument(vscode.Uri.file(path.join(root, "page.md")), "# Title\n");
      const panel = new FakeWebviewPanel();
      const provider = new VisualEditorProvider(
        fakeContext() as never,
        noProjects(),
        echoRenderer(),
        recordingInsertPanel(),
      );
      provider.resolveCustomTextEditor(doc as never, panel as never, {} as never);
      await settle();

      await panel.send({
        type: "saveImage",
        token: 3,
        data: Buffer.from("PNG").toString("base64"),
        mime: "image/png",
        name: "shot.png",
      });
      // Saving is real file I/O — a fixed number of microtask rounds is a race.
      for (let i = 0; i < 500 && !panel.last("imageSaved"); i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      const answer = panel.last("imageSaved");
      expect(answer).toMatchObject({ token: 3, relPath: "assets/shot.png" });
      // Without this the pasted picture lands in the document invisible: the
      // block holding the caret is the one a catch-up patch does not replace.
      expect(String(answer?.webUri)).toContain("assets/shot.png");
      expect(String(answer?.webUri)).not.toBe("assets/shot.png");
      expect(await fs.readFile(path.join(root, "assets", "shot.png"), "utf8")).toBe("PNG");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("the panel lets go", () => {
  it("stops listening once it is closed", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    panel.dispose();
    doc.setText("# Title\n\nChanged elsewhere.\n");
    (vscode as unknown as typeof import("../mocks/vscode")).__onDidChangeTextDocument.fire({
      document: doc,
      contentChanges: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(panel.ofType("render")).toHaveLength(0);
  });
});
