// Scroll sync between the editor and the preview.
//
// Scrolling the preview moves the editor, and the editor then reports its new
// visible lines — which would scroll the preview again. The loop shows up as a
// twitch that drifts upwards, and the only thing standing between the user and
// it is a time window. A window is exactly the kind of thing that survives a
// refactor with the wrong sign and nobody notices until someone scrolls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { PreviewPanelManager } from "../../src/preview/previewPanel";
import { FakeWebviewPanel, echoRenderer, fakeContext, noProjects, settle } from "../mocks/host";

const { FakeTextDocument, __recorded, __reset, __setPanelFactory, __setSetting } =
  vscode as unknown as typeof import("../mocks/vscode");

const PAGE = vscode.Uri.file("/work/docs/page.md");

let now = 1_000_000;
let panel: FakeWebviewPanel;
let manager: PreviewPanelManager;

/** Opens the preview on a document and hands back its panel. */
async function openPreview(): Promise<void> {
  new FakeTextDocument(PAGE, "# Title\n\nBody.\n");
  panel = new FakeWebviewPanel();
  __setPanelFactory(() => panel);
  manager = new PreviewPanelManager(fakeContext() as never, noProjects());
  manager.setFallbackRenderer(echoRenderer());
  await manager.open(PAGE);
  await settle();
  panel.clear();
}

beforeEach(async () => {
  __reset();
  __setSetting("mkdocsStudio.language", "en");
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  await openPreview();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the editor scrolls the preview", () => {
  it("passes the line through", () => {
    manager.syncScroll(PAGE, 12);
    expect(panel.last("scrollTo")?.line).toBe(12);
  });

  it("ignores a document that is not the one on show", () => {
    manager.syncScroll(vscode.Uri.file("/work/docs/other.md"), 12);
    expect(panel.ofType("scrollTo")).toHaveLength(0);
  });

  it("stays put when the user turned scroll sync off", () => {
    __setSetting("mkdocsStudio.scrollSync", false);
    manager.syncScroll(PAGE, 12);
    expect(panel.ofType("scrollTo")).toHaveLength(0);
  });
});

describe("the echo of the preview's own scroll", () => {
  it("is ignored while the window is open", async () => {
    // The preview scrolled, which moved the editor, which is now reporting back.
    await panel.send({ type: "reveal", line: 40 });
    panel.clear();

    now += 100;
    manager.syncScroll(PAGE, 3);
    expect(panel.ofType("scrollTo")).toHaveLength(0);

    now += 299; // 399 ms in total — still inside the window
    manager.syncScroll(PAGE, 3);
    expect(panel.ofType("scrollTo")).toHaveLength(0);
  });

  it("is let through once the window has passed", async () => {
    await panel.send({ type: "reveal", line: 40 });
    panel.clear();

    now += 401;
    manager.syncScroll(PAGE, 3);
    expect(panel.last("scrollTo")?.line).toBe(3);
  });

  it("reopens the window on every scroll of the preview", async () => {
    await panel.send({ type: "reveal", line: 40 });
    now += 300;
    await panel.send({ type: "reveal", line: 41 });
    panel.clear();

    now += 300; // 600 ms since the first, but only 300 since the last
    manager.syncScroll(PAGE, 3);
    expect(panel.ofType("scrollTo")).toHaveLength(0);
  });
});

describe("links out of the preview", () => {
  it("opens an http address", async () => {
    await panel.send({ type: "openLink", href: "https://example.com/a" });
    expect(__recorded.openedExternal).toEqual(["https://example.com/a"]);
  });

  it("refuses a scheme that is not on the list", async () => {
    await panel.send({ type: "openLink", href: "javascript:alert(1)" });
    expect(__recorded.openedExternal).toEqual([]);
  });
});
