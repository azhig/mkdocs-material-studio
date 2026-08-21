// The address an image gets in the preview.
//
// A webview has a base of its own, so every local link is rewritten into an
// address it may load — and that rewrite used to throw the anchor away. Material
// tells the two images of a light/dark pair apart by the anchor and nothing
// else (`img[src$="#only-dark"]`), so a page written for both schemes showed
// both pictures at once. The renderer is where that has to be right; the split
// itself is pinned down in assetUrls.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createFallbackRenderer } from "../../src/preview/fallbackRenderer";
import { fakeContext } from "../mocks/host";

const { FakeTextDocument, __reset } = vscode as unknown as typeof import("../mocks/vscode");

let root: string;
let render: ReturnType<typeof createFallbackRenderer>;

/**
 * The address the fake webview gives a file of the project — built by the same
 * translation the renderer uses. A path written out by hand passes on macOS and
 * fails on Windows, where `path.join` produces backslashes and a drive letter
 * while the Uri keeps forward slashes.
 */
function webviewSrc(...segments: string[]): string {
  return `https://webview.test${vscode.Uri.file(path.join(root, ...segments)).path}`;
}

/** Renders the text as a page of docs/ and returns its HTML. */
async function html(markdown: string): Promise<string> {
  const doc = new FakeTextDocument(
    vscode.Uri.file(path.join(root, "docs", "index.md")),
    markdown,
  ) as unknown as vscode.TextDocument;
  const result = await render(
    doc,
    undefined,
    undefined,
    (uri) => `https://webview.test${uri.path}`,
  );
  return result.html;
}

beforeEach(async () => {
  __reset();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mkdocs-assets-"));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "docs", "logo.png"), "PNG", "utf8");
  render = createFallbackRenderer(fakeContext(root) as never);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("an image addressed at one color scheme", () => {
  it("keeps its anchor once the link points at the file", async () => {
    const out = await html("![Logo](logo.png#only-dark)\n");
    expect(out).toContain(`src="${webviewSrc("docs", "logo.png")}#only-dark"`);
  });

  it("keeps the GitHub spelling of the same thing", async () => {
    // Checked on src, not anywhere in the HTML: data-md-src carries the anchor
    // too, and a test that settled for that would pass with the anchor lost.
    expect(await html("![Logo](logo.png#gh-dark-mode-only)\n")).toContain(
      `src="${webviewSrc("docs", "logo.png")}#gh-dark-mode-only"`,
    );
  });

  it("is written back to the file as the author wrote it", async () => {
    // data-md-src is what the visual editor serializes from — anchor included.
    expect(await html("![Logo](logo.png#only-light)\n")).toContain(
      'data-md-src="logo.png#only-light"',
    );
  });
});

describe("an ordinary image", () => {
  it("gets no anchor of its own", async () => {
    const out = await html("![Logo](logo.png)\n");
    expect(out).toContain(`src="${webviewSrc("docs", "logo.png")}"`);
    expect(out).not.toContain("#");
  });

  it("carries the size attributes of the Material reference", async () => {
    const out = await html('![Logo](logo.png){ width="300" height="150" align=left }\n');
    expect(out).toContain('width="300"');
    expect(out).toContain('height="150"');
    expect(out).toContain('align="left"');
  });
});
