// @vitest-environment happy-dom
//
// The code copy button (`.md-code__nav`): panel contents, copying and —
// most importantly — no interference with serialization: the button lives in the webview DOM, but
// the code block round-trip must stay byte for byte.

import { describe, expect, it, vi } from "vitest";
import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { decorateCodeNav } from "../../webviews/shared/codeNav";
import { serializeTopBlock } from "../../webviews/visual/htmlToMd";

const md = buildMarkdownEngine({ resolveIcon: () => undefined, readSnippet: () => undefined });

function renderFirstBlock(src: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = md.render(src);
  return host.firstElementChild as HTMLElement;
}

/** Clipboard stub: returns the text that was written. */
function stubClipboard(): { last: () => string | null } {
  let last: string | null = null;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        last = t;
        return Promise.resolve();
      },
    },
  });
  return { last: () => last };
}

const CODE = ['```py title="app.py"', "print(1)", "print(2)", "```"].join("\n");

describe("code block copy button", () => {
  it("adds exactly one button — copy", () => {
    const block = renderFirstBlock(CODE);
    decorateCodeNav(block, { codeText: () => "" });
    expect(block.querySelectorAll(".md-code__nav button")).toHaveLength(1);
    expect(block.querySelector('[data-md-type="copy"]')).not.toBeNull();
  });

  it("idempotent: a repeated call does not create extra panels", () => {
    const block = renderFirstBlock(CODE);
    decorateCodeNav(block, { codeText: () => "" });
    decorateCodeNav(block, { codeText: () => "" });
    expect(block.querySelectorAll(".md-code__nav")).toHaveLength(1);
  });

  it("leaves a block without code alone (mermaid, for example)", () => {
    const block = document.createElement("div");
    block.className = "highlight";
    expect(decorateCodeNav(block, { codeText: () => "" })).toBeNull();
    expect(block.querySelector(".md-code__nav")).toBeNull();
  });

  it("copies the code text and reports it", async () => {
    const clip = stubClipboard();
    const notify = vi.fn();
    const block = renderFirstBlock(CODE);
    decorateCodeNav(block, {
      codeText: (el) => (el.querySelector("pre > code")?.textContent ?? "").replace(/\n$/, ""),
      notify,
    });
    const btn = block.querySelector<HTMLButtonElement>('[data-md-type="copy"]')!;
    btn.click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(clip.last()).toBe("print(1)\nprint(2)");
    expect(notify).toHaveBeenCalledWith("Copied");
    expect(btn.getAttribute("title")).toBe("Copied");
  });

  it("stops the click from bubbling to the block (in preview that would open the edit form)", () => {
    const host = document.createElement("div");
    const onBlockClick = vi.fn();
    host.addEventListener("click", onBlockClick);
    const block = renderFirstBlock(CODE);
    host.appendChild(block);
    decorateCodeNav(block, { codeText: () => "" });
    block.querySelector<HTMLButtonElement>('[data-md-type="copy"]')!.click();
    expect(onBlockClick).not.toHaveBeenCalled();
  });

  it("puts the tooltip into the attribute the webview asks for", () => {
    const block = renderFirstBlock(CODE);
    decorateCodeNav(block, { codeText: () => "", tipAttr: "data-tip" });
    const btn = block.querySelector<HTMLButtonElement>('[data-md-type="copy"]')!;
    expect(btn.getAttribute("data-tip")).toBe("Copy code");
    expect(btn.getAttribute("title")).toBeNull(); // the editor has its own tooltip
  });

  it("does not affect block serialization (byte-for-byte round-trip)", () => {
    for (const src of [
      CODE,
      "```js\nconst a = 1;\n```",
      '```py title="calc.py" linenums="1" hl_lines="2 3"\ndef f(x):\n    y = x\n    return y\n```',
    ]) {
      const block = renderFirstBlock(src);
      const before = serializeTopBlock(block);
      decorateCodeNav(block, { codeText: () => "" });
      expect(serializeTopBlock(block)).toBe(before);
      expect(serializeTopBlock(block)).toBe(src + "\n");
    }
  });
});
