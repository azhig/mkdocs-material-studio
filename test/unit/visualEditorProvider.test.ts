// The visual editor's half of the protocol, driven end to end.
//
// Typing goes into a draft the provider keeps, and the file is written once —
// when the author saves. That is the whole point of the arrangement: while the
// document is untouched, auto-save has nothing to save and the project's
// formatters have nothing to reformat, so nothing comes back to redraw the page
// mid-word. It is also the only path in the extension that can lose somebody's
// work, so here the document really holds text, applyEdit really applies, and
// the assertions are on what the file says — and on when it says it.

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
  context = fakeContext(),
  doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), text),
): Promise<{
  doc: InstanceType<typeof FakeTextDocument>;
  panel: FakeWebviewPanel;
  insertPanel: ReturnType<typeof recordingInsertPanel>;
  context: ReturnType<typeof fakeContext>;
  provider: VisualEditorProvider;
}> {
  const panel = new FakeWebviewPanel();
  const insertPanel = recordingInsertPanel();
  const provider = new VisualEditorProvider(
    context as never,
    projects,
    echoRenderer(),
    insertPanel,
  );
  provider.resolveCustomTextEditor(doc as never, panel as never, {} as never);
  await settle();
  panel.clear();
  return { doc, panel, insertPanel, context, provider };
}

/** The revision the provider last told the webview about. */
function rev(panel: FakeWebviewPanel): number {
  const last = panel.last("synced") ?? panel.last("render");
  return Number(last?.version ?? 0);
}

/** Sends a batch against the draft as the webview currently knows it. */
async function sync(
  panel: FakeWebviewPanel,
  edits: { start: number; end: number; text: string }[],
): Promise<void> {
  await panel.send({ type: "sync", baseVersion: rev(panel), edits });
}

/**
 * Types into the page and then saves it, the way Cmd+S does — and waits for the
 * save to be reported rather than for a fixed number of ticks. The save writes
 * the document, renders the page and clears the stored draft; under load the
 * last of those can land after the message handler has returned.
 */
async function syncAndSave(
  panel: FakeWebviewPanel,
  edits: { start: number; end: number; text: string }[],
): Promise<void> {
  await sync(panel, edits);
  await panel.send({ type: "save" });
  for (let i = 0; i < 50 && !panel.ofType("saveState").some((m) => m.justSaved === true); i++) {
    await settle();
  }
}

/** An edit to the file made by somebody else. */
async function editFromOutside(
  doc: InstanceType<typeof FakeTextDocument>,
  text: string,
): Promise<void> {
  doc.setText(text);
  (vscode as unknown as typeof import("../mocks/vscode")).__onDidChangeTextDocument.fire({
    document: doc,
    contentChanges: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 320)); // it is debounced
}

beforeEach(() => {
  __reset();
  __setSetting("mkdocsStudio.language", "en");
});

/** Holds the page back until the author saves — see mkdocsStudio.writeToDocument. */
function holdUntilSaved(): void {
  __setSetting("mkdocsStudio.writeToDocument", "onSave");
}

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
    expect(panel.last("saveState")?.unsaved).toBe(false);
  });
});

describe("live: the buffer follows the page as it is typed", () => {
  // What a text editor does, and what this editor does by default: the document
  // is the page, so the preview, the text tab, VS Code's undo and its save all
  // work on it directly. Writing the file is VS Code's business — its own save,
  // or auto-save.
  it("puts each batch into the document", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nChanged.\n");
    expect(doc.saved).toBe(false); // dirty, for VS Code to save when it likes
    expect(panel.last("saveState")?.unsaved).toBe(false);
  });

  it("writes one edit per batch, so undo goes back one edit at a time", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(panel, [{ start: 0, end: 1, text: "# Heading\n" }]);
    await sync(panel, [{ start: 2, end: 3, text: "Rewritten.\n" }]);
    expect(doc.getText()).toBe("# Heading\n\nRewritten.\n");
    expect(doc.version).toBe(3); // one per batch, on top of the original
  });

  it("saving writes the file, with nothing left over", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await syncAndSave(panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nChanged.\n");
    expect(doc.saved).toBe(true);
  });

  it("leaves nothing behind for a later editor to offer back", async () => {
    const context = fakeContext();
    const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), "# Title\n\nBody.\n");
    const first = await open("", noProjects(), context, doc);
    await sync(first.panel, [{ start: 2, end: 3, text: "In the buffer already.\n" }]);
    first.panel.dispose();

    const again = await open("", noProjects(), context, doc);
    await again.panel.send({ type: "ready" });
    expect(again.panel.ofType("draftAvailable")).toHaveLength(0);
  });
});

describe("onSave: the page changes, the file does not", () => {
  beforeEach(holdUntilSaved);

  it("keeps a replacement in the draft and leaves the file alone", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(panel.last("synced")?.text).toBe("# Title\n\nChanged.\n");
    expect(doc.getText()).toBe("# Title\n\nBody.\n"); // untouched until a save
    expect(doc.version).toBe(1);
    expect(panel.last("saveState")?.unsaved).toBe(true);
    expect(panel.ofType("rejected")).toHaveLength(0);
  });

  it("writes the page to the file on save, and saves it", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await syncAndSave(panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nChanged.\n");
    expect(doc.saved).toBe(true);
    // The save is reported, and nothing after it claims there is unsaved work.
    // Asserting on the last message alone made this depend on whether a
    // debounced check for outside edits had fired yet — green here, red on CI.
    expect(panel.ofType("saveState").some((m) => m.justSaved === true)).toBe(true);
    expect(panel.last("saveState")?.unsaved).toBe(false);
  });

  it("applies an insert and a delete from one batch", async () => {
    const { doc, panel } = await open("one\n\ntwo\n\nthree\n");
    await syncAndSave(panel, [
      { start: 0, end: 0, text: "zero\n\n" },
      { start: 2, end: 4, text: "" },
    ]);
    expect(doc.getText()).toBe("zero\n\none\n\nthree\n");
  });

  it("does not grow a file that ends without a newline", async () => {
    const { doc, panel } = await open("# Title\n\nBody.");
    await syncAndSave(panel, [{ start: 2, end: 3, text: "Other.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nOther.");
  });

  it("writes everything typed since the last save as one edit", async () => {
    // One save is one undo step, however many words went into it.
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(panel, [{ start: 0, end: 1, text: "# Heading\n" }]);
    await sync(panel, [{ start: 2, end: 3, text: "Body, rewritten.\n" }]);
    expect(doc.version).toBe(1);
    await panel.send({ type: "save" });
    expect(doc.getText()).toBe("# Heading\n\nBody, rewritten.\n");
    expect(doc.version).toBe(2);
  });

  it("an empty batch changes nothing but still answers", async () => {
    const { doc, panel } = await open("# Title\n");
    await sync(panel, []);
    expect(doc.getText()).toBe("# Title\n");
    expect(panel.last("synced")).toBeDefined();
  });

  it("saving with nothing to write leaves the file untouched", async () => {
    const { doc, panel } = await open("# Title\n");
    await panel.send({ type: "save" });
    expect(doc.getText()).toBe("# Title\n");
    expect(doc.version).toBe(1);
  });
});

describe("sync: what is refused", () => {
  it("refuses a batch built against stale text", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await panel.send({
      type: "sync",
      baseVersion: rev(panel) + 7, // a revision this editor never had
      edits: [{ start: 0, end: 3, text: "gone\n" }],
    });
    expect(doc.getText()).toBe("# Title\n\nBody.\n");
    expect(panel.last("rejected")).toBeDefined();
    // And a full render follows, so the editor can start over from the page.
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
    await panel.send({ type: "sync", baseVersion: rev(panel), edits });
    expect(doc.getText()).toBe("# Title\n\nBody.\n");
    expect(panel.last("rejected")).toBeDefined();
    expect(__recorded.errors.join("\n")).toContain("malformed");
  });

  it("keeps the page when the file refuses the write", async () => {
    // The draft is the only copy of that paragraph — a save that did not land
    // must not be reported as one, or the next thing to touch the file wins.
    const { doc, panel } = await open("# Title\n\nBody.\n");
    __recorded.refuseEdits = true;
    await syncAndSave(panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    expect(doc.getText()).toBe("# Title\n\nBody.\n");
    expect(panel.last("saveState")?.unsaved).toBe(true);
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

describe("unsaved work left in a closed editor", () => {
  beforeEach(holdUntilSaved);

  /** Types into a page, then closes the editor without saving. */
  async function leaveUnsaved(
    context: ReturnType<typeof fakeContext>,
    doc: InstanceType<typeof FakeTextDocument>,
    text: string,
  ): Promise<void> {
    const first = await open("", noProjects(), context, doc);
    await sync(first.panel, [{ start: 2, end: 3, text }]);
    first.panel.dispose();
  }

  it("is offered back, and the page opens on the file", async () => {
    // Opening a page shows what the file says. Closing an editor without
    // saving is an answer, and a page that silently disagrees with the file is
    // the kind of thing that gets committed by accident.
    const context = fakeContext();
    const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), "# Title\n\nBody.\n");
    await leaveUnsaved(context, doc, "Half a thought.\n");

    const again = await open("", noProjects(), context, doc);
    await again.panel.send({ type: "ready" });
    expect(again.panel.last("render")?.text).toBe("# Title\n\nBody.\n");
    expect(again.panel.last("saveState")?.unsaved).toBe(false);
    expect(again.panel.last("draftAvailable")).toBeDefined();
  });

  it("comes back when the author asks for it", async () => {
    const context = fakeContext();
    const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), "# Title\n\nBody.\n");
    await leaveUnsaved(context, doc, "Half a thought.\n");

    const again = await open("", noProjects(), context, doc);
    await again.panel.send({ type: "ready" });
    await again.panel.send({ type: "draft", action: "restore" });
    expect(again.panel.last("render")?.text).toBe("# Title\n\nHalf a thought.\n");
    expect(again.panel.last("saveState")?.unsaved).toBe(true);
  });

  it("is gone for good once it is turned down", async () => {
    const context = fakeContext();
    const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), "# Title\n\nBody.\n");
    await leaveUnsaved(context, doc, "Half a thought.\n");

    const again = await open("", noProjects(), context, doc);
    await again.panel.send({ type: "ready" });
    await again.panel.send({ type: "draft", action: "discard" });
    again.panel.dispose();

    const third = await open("", noProjects(), context, doc);
    await third.panel.send({ type: "ready" });
    expect(third.panel.ofType("draftAvailable")).toHaveLength(0);
  });

  it("is not offered over a file that has moved on since", async () => {
    // The draft was written against text that no longer exists; taking it back
    // would quietly revert whatever happened to the file in the meantime.
    const context = fakeContext();
    const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), "# Title\n\nBody.\n");
    await leaveUnsaved(context, doc, "Mine.\n");
    doc.setText("# Title\n\nRewritten elsewhere.\n");

    const again = await open("", noProjects(), context, doc);
    await again.panel.send({ type: "ready" });
    expect(again.panel.last("render")?.text).toBe("# Title\n\nRewritten elsewhere.\n");
    expect(again.panel.ofType("draftAvailable")).toHaveLength(0);
  });

  it("is not offered once it has been saved", async () => {
    const context = fakeContext();
    const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), "# Title\n\nBody.\n");
    const first = await open("", noProjects(), context, doc);
    await syncAndSave(first.panel, [{ start: 2, end: 3, text: "Finished.\n" }]);
    first.panel.dispose();

    const again = await open("", noProjects(), context, doc);
    await again.panel.send({ type: "ready" });
    expect(again.panel.last("render")?.text).toBe("# Title\n\nFinished.\n");
    expect(again.panel.ofType("draftAvailable")).toHaveLength(0);
  });

  it("does not come back to undo a checkout of the page it was written on", async () => {
    // Saved, then the file was taken back to what it said before — `git
    // checkout`, an undo in the text tab. A draft still sitting in the store
    // would match that text again and offer writing the author had already
    // decided against.
    const context = fakeContext();
    const doc = new FakeTextDocument(vscode.Uri.file("/work/docs/page.md"), "# Title\n\nBody.\n");
    const first = await open("", noProjects(), context, doc);
    await syncAndSave(first.panel, [{ start: 2, end: 3, text: "Finished.\n" }]);
    first.panel.dispose();
    doc.setText("# Title\n\nBody.\n");

    const again = await open("", noProjects(), context, doc);
    await again.panel.send({ type: "ready" });
    expect(again.panel.ofType("draftAvailable")).toHaveLength(0);
  });
});

describe("an edit from outside", () => {
  beforeEach(holdUntilSaved);

  it("is adopted quietly when the editor has nothing unsaved", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await editFromOutside(doc, "# Title\n\nEdited elsewhere.\n");
    expect(panel.last("synced")?.text).toBe("# Title\n\nEdited elsewhere.\n");
    expect(panel.ofType("outsideChange")).toHaveLength(0);
  });

  it("is put to the author when it would overwrite their unsaved page", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(panel, [{ start: 2, end: 3, text: "Mine, not saved yet.\n" }]);
    await editFromOutside(doc, "# Title\n\nSomebody else's.\n");
    expect(panel.last("outsideChange")).toBeDefined();
    // Nothing was redrawn and nothing was lost: the page still says what the
    // author typed, and the file still says what the other editor wrote.
    expect(panel.last("synced")?.text).toBe("# Title\n\nMine, not saved yet.\n");
    expect(doc.getText()).toBe("# Title\n\nSomebody else's.\n");
  });

  it("“load the file” throws the draft away and redraws from the file", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(panel, [{ start: 2, end: 3, text: "Mine.\n" }]);
    await editFromOutside(doc, "# Title\n\nTheirs.\n");
    await panel.send({ type: "outsideChange", action: "reload" });
    expect(panel.last("render")?.text).toBe("# Title\n\nTheirs.\n");
    expect(panel.last("saveState")?.unsaved).toBe(false);
  });

  it("“keep my version” writes the author's page over it on the next save", async () => {
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await sync(panel, [{ start: 2, end: 3, text: "Mine.\n" }]);
    await editFromOutside(doc, "# Title\n\nTheirs.\n");
    await panel.send({ type: "outsideChange", action: "keep" });
    await panel.send({ type: "save" });
    expect(doc.getText()).toBe("# Title\n\nMine.\n");
  });

  it("our own save does not come back as somebody else's edit", async () => {
    const { panel } = await open("# Title\n\nBody.\n");
    await syncAndSave(panel, [{ start: 2, end: 3, text: "Changed.\n" }]);
    await new Promise((resolve) => setTimeout(resolve, 320)); // the bar is debounced
    expect(panel.ofType("outsideChange")).toHaveLength(0);
    expect(panel.last("saveState")?.unsaved).toBe(false);
  });

  it("a formatter that rewrites the file on save is adopted, not fought over", async () => {
    // Trailing whitespace trimmed on save, markdownlint, Prettier: the write
    // the author asked for is the moment to take whatever came back with it.
    const { doc, panel } = await open("# Title\n\nBody.\n");
    await syncAndSave(panel, [{ start: 2, end: 3, text: "Changed.   \n" }]);
    await editFromOutside(doc, "# Title\n\nChanged.\n");
    expect(panel.ofType("outsideChange")).toHaveLength(0);
    expect(panel.last("synced")?.text).toBe("# Title\n\nChanged.\n");
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
