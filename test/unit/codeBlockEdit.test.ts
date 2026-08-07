// @vitest-environment happy-dom
//
// The line model behind editing a fenced code block. Everything the editor does
// to a code block — typing, Enter, Tab, paste — goes through the caret as
// {line, column} and through the splice that puts text in at that point. Get
// either wrong and a line of somebody's program disappears without a trace,
// because a code block is written back to the file whole.

import { beforeAll, describe, expect, it } from "vitest";
import {
  codeLinesOf,
  fenceInfoOf,
  getCodeCaret,
  initCodeBlockEdit,
  isInlineCode,
  setCodeCaret,
  spliceCodeText,
} from "../../webviews/visual/codeBlockEdit";

beforeAll(() => {
  initCodeBlockEdit({ findBlockByStart: () => undefined });
});

/** A `<code>` laid out the way the editor lays it out: one `.cl` per line. */
function codeElement(...lines: string[]): HTMLElement {
  const code = document.createElement("code");
  for (const line of lines) {
    const cl = document.createElement("span");
    cl.className = "cl";
    cl.textContent = line;
    code.appendChild(cl);
  }
  document.body.appendChild(code);
  return code;
}

describe("which blocks are edited in place", () => {
  function block(className: string, attrs: Record<string, string> = {}): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  }

  it("a fenced code block is", () => {
    expect(isInlineCode(block("highlight", { "data-block-type": "code" }))).toBe(true);
  });

  it("a mermaid diagram is not: it is drawn, not typed into", () => {
    expect(isInlineCode(block("highlight mermaid", { "data-block-type": "code" }))).toBe(false);
  });

  it("a fence we must not rewrite is not", () => {
    expect(
      isInlineCode(block("highlight", { "data-block-type": "code", "data-fence-pristine": "" })),
    ).toBe(false);
  });

  it("something that only looks like code is not", () => {
    expect(isInlineCode(block("highlight"))).toBe(false);
    const pre = document.createElement("pre");
    pre.className = "highlight";
    pre.setAttribute("data-block-type", "code");
    expect(isInlineCode(pre)).toBe(false);
  });
});

describe("reading the code back out of the DOM", () => {
  it("is one line per .cl block", () => {
    expect(codeLinesOf(codeElement("one", "two", "three"))).toEqual(["one", "two", "three"]);
  });

  it("keeps a blank line in the middle", () => {
    expect(codeLinesOf(codeElement("one", "", "three"))).toEqual(["one", "", "three"]);
  });

  it("falls back to the text when the block was never painted", () => {
    const code = document.createElement("code");
    code.textContent = "one\ntwo\n";
    // The trailing newline belongs to the fence, not to the code: counting it
    // as a line would grow the block by one on every save.
    expect(codeLinesOf(code)).toEqual(["one", "two"]);
  });
});

describe("the fence's stored info string", () => {
  function withInfo(info: string): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("data-fence-info", info);
    return el;
  }

  it("gives the language", () => {
    expect(fenceInfoOf(withInfo("python")).lang).toBe("python");
  });

  it("gives the highlighted lines", () => {
    expect([...fenceInfoOf(withInfo('python hl_lines="2 4"')).hl]).toEqual([2, 4]);
  });

  it("gives nothing for a block that has no info at all", () => {
    const info = fenceInfoOf(document.createElement("div"));
    expect(info.lang).toBe("");
    expect(info.hl.size).toBe(0);
  });
});

describe("inserting text at the caret", () => {
  it("puts a word inside a line and leaves the caret after it", () => {
    const result = spliceCodeText(["print(x)"], { line: 0, col: 6 }, "1");
    expect(result.lines).toEqual(["print(1x)"]);
    expect(result.at).toEqual({ line: 0, col: 7 });
  });

  it("splits the line in two on a newline", () => {
    const result = spliceCodeText(["ab"], { line: 0, col: 1 }, "\n");
    expect(result.lines).toEqual(["a", "b"]);
    expect(result.at).toEqual({ line: 1, col: 0 });
  });

  it("pastes several lines and lands at the end of the last one", () => {
    const result = spliceCodeText(["first", "last"], { line: 0, col: 5 }, "\nmiddle\nthird");
    expect(result.lines).toEqual(["first", "middle", "third", "last"]);
    expect(result.at).toEqual({ line: 2, col: 5 });
  });

  it("keeps the tail of the line it split", () => {
    const result = spliceCodeText(["ab"], { line: 0, col: 1 }, "X\nY");
    expect(result.lines).toEqual(["aX", "Yb"]);
    expect(result.at).toEqual({ line: 1, col: 1 });
  });

  it("leaves the lines alone when there is nothing to insert", () => {
    const result = spliceCodeText(["one", "two"], { line: 1, col: 3 }, "");
    expect(result.lines).toEqual(["one", "two"]);
    expect(result.at).toEqual({ line: 1, col: 3 });
  });

  it("works on a line the caret is past the end of", () => {
    // Nothing prevents a stale caret column; the splice must not lose the line.
    const result = spliceCodeText(["ab"], { line: 0, col: 99 }, "X");
    expect(result.lines).toEqual(["abX"]);
  });

  it("works on a line that is not there", () => {
    const result = spliceCodeText(["ab"], { line: 5, col: 0 }, "X");
    expect(result.lines).toContain("X");
  });
});

describe("the caret, written and read back", () => {
  it("comes back where it was put", () => {
    const code = codeElement("first line", "second line");
    setCodeCaret(code, 1, 4);
    expect(getCodeCaret(code)).toEqual({ line: 1, col: 4 });
  });

  it("comes back at the start of a line", () => {
    const code = codeElement("one", "two");
    setCodeCaret(code, 0, 0);
    expect(getCodeCaret(code)).toEqual({ line: 0, col: 0 });
  });

  it("comes back at the end of a line", () => {
    const code = codeElement("one", "two");
    setCodeCaret(code, 1, 3);
    expect(getCodeCaret(code)).toEqual({ line: 1, col: 3 });
  });

  it("counts the column across the highlighting spans, not within one", () => {
    const code = document.createElement("code");
    const cl = document.createElement("span");
    cl.className = "cl";
    cl.innerHTML = '<span class="k">def</span> <span class="nf">name</span>';
    code.appendChild(cl);
    document.body.appendChild(code);
    setCodeCaret(code, 0, 6);
    expect(getCodeCaret(code)).toEqual({ line: 0, col: 6 });
  });

  it("clamps a line past the end of the block instead of losing the caret", () => {
    const code = codeElement("one", "two");
    setCodeCaret(code, 99, 0);
    expect(getCodeCaret(code)?.line).toBe(1);
  });

  it("is nothing when the selection is somewhere else entirely", () => {
    const code = codeElement("one");
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.setStart(outside.firstChild as Text, 2);
    range.collapse(true);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(getCodeCaret(code)).toBeNull();
    outside.remove();
  });
});
