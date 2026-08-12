// Editing a fenced code block in place.
//
// The `<code>` element and the title are edited directly, with live
// highlighting (highlight.js, codeLive.ts). Every line is its own `.cl` block —
// that is what the number gutter and the highlighted-line background hang on —
// and the source text is put back together by joining them. The block's
// parameters (language, numbering, highlighted lines, title) are written into
// the info string of the fence itself, one pinpoint edit at a time.
//
// Two things here are not in-place editing. “Highlight lines” is a mode: while
// it is on, a click on a line number marks the line instead of moving the
// caret, and “Done” writes hl_lines. And the live editor is the way out for a
// block this editor cannot draw — a plain textarea over the block's own source.

import { docLines, markDirty, mutedRemote, rangeOf, sendSync, setAfterSync } from "./editorCore";
import { indentLines } from "./blockMove";
import {
  buildFenceInfo,
  defaultTitleFor,
  LANGUAGES,
  parseFence,
  type FenceParts,
} from "./codeFence";
import { renderCodeHtml } from "./codeLive";
import { closePopup, showPopup, type QuickItem } from "./popups";
import { t } from "../shared/i18n";

/** What editing a code block needs from the editor around it. */
export interface CodeBlockHost {
  /** The block that starts at a line of the file — used to find a block again
   *  after a sync has replaced it with a fresh render. */
  findBlockByStart(start: number): Element | undefined;
}

let host: CodeBlockHost;

export function initCodeBlockEdit(next: CodeBlockHost): void {
  host = next;
}

/** A pinpoint edit of a code block's info string: parseFence → mutate → sendSync. */
function updateFence(block: HTMLElement, mutate: (p: FenceParts) => void): void {
  const { start, end } = rangeOf(block);
  const src = docLines().slice(start, end);
  const parts = parseFence(src);
  mutate(parts);
  const openBar = /^\s*(`+|~+)/.exec(src[0] ?? "```")?.[1] ?? "```";
  const closeLine = src[src.length - 1] ?? openBar;
  const fence = [openBar + buildFenceInfo(parts), ...parts.body, closeLine];
  document.getSelection()?.removeAllRanges();
  sendSync([{ start, end, text: fence.join("\n") + "\n" }]);
}

interface CodeCaret {
  line: number;
  col: number;
}
let codeComposing = false;

/** Determines that a block is inline-editable code (not mermaid, not a snippet island). */
export function isInlineCode(el: Element): boolean {
  return (
    el.tagName === "DIV" &&
    el.classList.contains("highlight") &&
    el.getAttribute("data-block-type") === "code" &&
    !el.classList.contains("mermaid") &&
    !el.classList.contains("plantuml") &&
    !el.hasAttribute("data-fence-pristine")
  );
}

/** Code lines: join the `.cl` blocks, otherwise split textContent on `\n`. */
export function codeLinesOf(codeEl: Element): string[] {
  const cls = codeEl.querySelectorAll(":scope > .cl");
  if (cls.length) {
    return Array.from(cls, (l) => l.textContent ?? "");
  }
  return (codeEl.textContent ?? "").replace(/\n$/, "").split("\n");
}

/** The language and the highlighted lines from the block's stored info string. */
export function fenceInfoOf(block: Element): { lang: string; hl: Set<number> } {
  const info = block.getAttribute("data-fence-info") ?? "";
  const parts = parseFence(["```" + info]);
  return { lang: parts.lang, hl: parts.hl };
}

/** The text of the range from the start of root up to (node, offset). */
function rangeTextTo(root: Node, node: Node, offset: number): string {
  const r = document.createRange();
  r.setStart(root, 0);
  try {
    r.setEnd(node, offset);
  } catch {
    return "";
  }
  return r.toString();
}

/** The caret position in the code as {line, column}. */
export function getCodeCaret(codeEl: HTMLElement): CodeCaret | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  const node = sel.anchorNode;
  if (!node || !codeEl.contains(node)) {
    return null;
  }
  if (node === codeEl) {
    const idx = Math.min(sel.anchorOffset, codeEl.children.length - 1);
    return { line: Math.max(0, idx), col: 0 };
  }
  let cl: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (cl && cl.parentNode !== codeEl) {
    cl = cl.parentNode;
  }
  if (!(cl instanceof HTMLElement) || cl.parentNode !== codeEl) {
    return null;
  }
  const line = Array.prototype.indexOf.call(codeEl.children, cl);
  const col = rangeTextTo(cl, node, sel.anchorOffset).length;
  return { line: Math.max(0, line), col };
}

/** Places the caret in the code at {line, column}. */
export function setCodeCaret(codeEl: HTMLElement, line: number, col: number): void {
  const cl = codeEl.children[Math.min(line, codeEl.children.length - 1)] as HTMLElement | undefined;
  if (!cl) {
    return;
  }
  const sel = document.getSelection();
  const r = document.createRange();
  const walker = document.createTreeWalker(cl, NodeFilter.SHOW_TEXT);
  let remaining = col;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    last = n;
    const len = (n.nodeValue ?? "").length;
    if (remaining <= len) {
      r.setStart(n, remaining);
      r.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(r);
      return;
    }
    remaining -= len;
  }
  if (last) {
    r.setStart(last, (last.nodeValue ?? "").length);
  } else {
    r.setStart(cl, 0);
  }
  r.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** Repaints the code (colors + lines + highlighting), preserving the caret position. */
function paintCodeBlock(
  block: HTMLElement,
  codeEl: HTMLElement,
  text?: string,
  caret?: CodeCaret | null,
): void {
  const t = text ?? codeLinesOf(codeEl).join("\n");
  const keep = caret !== undefined ? caret : getCodeCaret(codeEl);
  const { lang, hl } = fenceInfoOf(block);
  mutedRemote(() => {
    codeEl.innerHTML = renderCodeHtml(t, lang, hl);
  });
  if (keep) {
    setCodeCaret(codeEl, keep.line, keep.col);
  }
}

/** Inserts multi-line text at the caret position; returns the lines and the new caret. */
export function spliceCodeText(
  lines: string[],
  caret: CodeCaret,
  text: string,
): { lines: string[]; at: CodeCaret } {
  const cur = lines[caret.line] ?? "";
  const before = cur.slice(0, caret.col);
  const after = cur.slice(caret.col);
  const parts = text.split("\n");
  if (parts.length === 1) {
    lines[caret.line] = before + parts[0] + after;
    return { lines, at: { line: caret.line, col: before.length + parts[0].length } };
  }
  const mid = parts.slice(1, -1);
  const lastPart = parts[parts.length - 1];
  lines.splice(caret.line, 1, before + parts[0], ...mid, lastPart + after);
  return { lines, at: { line: caret.line + parts.length - 1, col: lastPart.length } };
}

/** A code block's title (`.filename`) is edited inline; it is serialized via overrideTitle. */
function wireCodeTitle(filename: HTMLElement): void {
  filename.setAttribute("contenteditable", "true");
  filename.spellcheck = false;
  filename.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      filename.blur();
    }
  });
}

/** Keyboard/paste in an editable `<code>`: deterministic edits of the line model. */
function onCodeKeydown(e: KeyboardEvent, block: HTMLElement, codeEl: HTMLElement): void {
  const k = e.key;
  if (k === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    const caret = getCodeCaret(codeEl) ?? { line: 0, col: 0 };
    const lines = codeLinesOf(codeEl);
    const cur = lines[caret.line] ?? "";
    lines[caret.line] = cur.slice(0, caret.col);
    lines.splice(caret.line + 1, 0, cur.slice(caret.col));
    markDirty(block);
    paintCodeBlock(block, codeEl, lines.join("\n"), { line: caret.line + 1, col: 0 });
    return;
  }
  if (k === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    const caret = getCodeCaret(codeEl) ?? { line: 0, col: 0 };
    const lines = codeLinesOf(codeEl);
    const cur = lines[caret.line] ?? "";
    lines[caret.line] = cur.slice(0, caret.col) + "    " + cur.slice(caret.col);
    markDirty(block);
    paintCodeBlock(block, codeEl, lines.join("\n"), { line: caret.line, col: caret.col + 4 });
    return;
  }
  if (k === "Backspace" || k === "Delete") {
    const sel = document.getSelection();
    if (!sel || !sel.isCollapsed) {
      return; // there is a selection — an ordinary deletion, input will repaint
    }
    const caret = getCodeCaret(codeEl);
    if (!caret) {
      return;
    }
    const lines = codeLinesOf(codeEl);
    const cur = lines[caret.line] ?? "";
    let at: CodeCaret;
    if (k === "Backspace") {
      if (caret.col > 0) {
        lines[caret.line] = cur.slice(0, caret.col - 1) + cur.slice(caret.col);
        at = { line: caret.line, col: caret.col - 1 };
      } else if (caret.line > 0) {
        const prev = lines[caret.line - 1];
        at = { line: caret.line - 1, col: prev.length };
        lines[caret.line - 1] = prev + cur;
        lines.splice(caret.line, 1);
      } else {
        return;
      }
    } else {
      if (caret.col < cur.length) {
        lines[caret.line] = cur.slice(0, caret.col) + cur.slice(caret.col + 1);
        at = { line: caret.line, col: caret.col };
      } else if (caret.line < lines.length - 1) {
        lines[caret.line] = cur + lines[caret.line + 1];
        lines.splice(caret.line + 1, 1);
        at = { line: caret.line, col: caret.col };
      } else {
        return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    markDirty(block);
    paintCodeBlock(block, codeEl, lines.join("\n"), at);
  }
}

/** Attaches inline editing to a code block. */
export function decorateCodeBlock(block: HTMLElement): void {
  if (block.hasAttribute("data-vwired")) {
    return;
  }
  block.setAttribute("data-vwired", "");
  block.classList.add("vcode");
  block.setAttribute("contenteditable", "false");
  const codeEl = block.querySelector(":scope > pre > code") as HTMLElement | null;
  if (!codeEl) {
    return;
  }
  codeEl.setAttribute("contenteditable", "true");
  codeEl.spellcheck = false;
  const filename = block.querySelector(":scope > .filename") as HTMLElement | null;
  if (filename) {
    wireCodeTitle(filename);
  }
  paintCodeBlock(block, codeEl);

  codeEl.addEventListener("compositionstart", () => {
    codeComposing = true;
  });
  codeEl.addEventListener("compositionend", () => {
    codeComposing = false;
    markDirty(block);
    paintCodeBlock(block, codeEl);
  });
  codeEl.addEventListener("input", () => {
    markDirty(block);
    if (!codeComposing) {
      paintCodeBlock(block, codeEl);
    }
  });
  codeEl.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
    if (!text) {
      return;
    }
    const caret = getCodeCaret(codeEl) ?? { line: 0, col: 0 };
    const { lines, at } = spliceCodeText(codeLinesOf(codeEl), caret, text);
    markDirty(block);
    paintCodeBlock(block, codeEl, lines.join("\n"), at);
  });
  codeEl.addEventListener("keydown", (e) => onCodeKeydown(e, block, codeEl));
  codeEl.addEventListener("focusin", () => {
    // Restore the literal `# (n)!` markers (the plus dots are removed for editing).
    if (codeEl.querySelector(".md-annotation")) {
      const { start, end } = rangeOf(block);
      const body = parseFence(docLines().slice(start, end)).body;
      paintCodeBlock(block, codeEl, body.join("\n"), null);
    }
  });
}

/** A filterable picker for a code block's language (pick from the list or type your own). */
function openCodeLangPicker(block: HTMLElement): void {
  const rect = block.getBoundingClientRect();
  const pop = showPopup(rect.left + window.scrollX, rect.top + window.scrollY + 4);
  pop.classList.add("vcode-langpop");
  const cur = fenceInfoOf(block).lang;
  const search = document.createElement("input");
  search.type = "text";
  search.placeholder = t("language…");
  search.className = "vcode-langsearch";
  search.autocomplete = "off";
  const list = document.createElement("div");
  list.className = "vmenu vcode-langlist";

  const pick = (lang: string): void => {
    closePopup();
    updateFence(block, (p) => {
      p.lang = lang.trim();
    });
  };
  const render = (q: string): void => {
    const query = q.trim().toLowerCase();
    list.innerHTML = "";
    for (const l of LANGUAGES.filter((o) => o.includes(query))) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = l;
      if (l === cur) b.classList.add("active");
      b.addEventListener("click", () => pick(l));
      list.appendChild(b);
    }
  };
  search.addEventListener("input", () => render(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      pick(search.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePopup();
    }
  });
  pop.append(search, list);
  render("");
  search.focus();
}

/** Adds/removes the title; when adding, focus goes to `.filename` for editing. */
function toggleCodeTitle(block: HTMLElement): void {
  const { start } = rangeOf(block);
  const had = !!parseFence(docLines().slice(start, rangeOf(block).end)).title;
  if (!had) {
    setAfterSync(() => {
      const nb = host.findBlockByStart(start) as HTMLElement | null;
      const fn = nb?.querySelector(":scope > .filename") as HTMLElement | null;
      if (fn) {
        fn.focus();
        document.getSelection()?.selectAllChildren(fn);
      }
    });
  }
  updateFence(block, (p) => {
    p.title = p.title ? "" : defaultTitleFor(p.lang);
  });
}

// --- The “highlight lines” mode: clicking a line marks it `.hll`, “Done” → hl_lines.
let hlMode: {
  block: HTMLElement;
  codeEl: HTMLElement;
  bar: HTMLElement;
  onDown: (e: Event) => void;
} | null = null;

function enterHlMode(block: HTMLElement): void {
  const codeEl = block.querySelector(":scope > pre > code") as HTMLElement | null;
  if (!codeEl) {
    return;
  }
  exitHlMode(false);
  block.classList.add("vcode-hlmode");
  codeEl.setAttribute("contenteditable", "false"); // clicks select lines instead of placing the cursor
  const onDown = (e: Event): void => {
    const cl = (e.target as HTMLElement).closest?.(".cl");
    if (cl && codeEl.contains(cl)) {
      e.preventDefault();
      cl.classList.toggle("hll");
    }
  };
  codeEl.addEventListener("mousedown", onDown);

  const rect = block.getBoundingClientRect();
  const bar = document.createElement("div");
  bar.className = "vpop vhl-bar";
  bar.style.left = `${rect.right + window.scrollX - 190}px`;
  bar.style.top = `${rect.top + window.scrollY - 34}px`;
  const hint = document.createElement("span");
  hint.textContent = t("Click the lines");
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = t("Done");
  ok.addEventListener("click", commitHlMode);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", () => exitHlMode(true));
  bar.append(hint, ok, cancel);
  document.body.appendChild(bar);
  hlMode = { block, codeEl, bar, onDown };
}

function commitHlMode(): void {
  if (!hlMode) {
    return;
  }
  const { block, codeEl } = hlMode;
  const hl = new Set<number>();
  Array.from(codeEl.querySelectorAll(":scope > .cl")).forEach((l, i) => {
    if (l.classList.contains("hll")) hl.add(i + 1);
  });
  exitHlMode(false);
  updateFence(block, (p) => {
    p.hl = hl;
  });
}

function exitHlMode(repaint: boolean): void {
  if (!hlMode) {
    return;
  }
  const { block, codeEl, bar, onDown } = hlMode;
  codeEl.removeEventListener("mousedown", onDown);
  codeEl.setAttribute("contenteditable", "true");
  block.classList.remove("vcode-hlmode");
  bar.remove();
  hlMode = null;
  if (repaint) {
    paintCodeBlock(block, codeEl, undefined, null); // restore the original `.hll`
  }
}

/** The handle menu items for an inline code block. */
export function codeMenuItems(block: HTMLElement): QuickItem[] {
  const { start, end } = rangeOf(block);
  const parts = parseFence(docLines().slice(start, end));
  return [
    {
      label: `⌨ ${t("Language")}: ${parts.lang || t("not set")}`,
      run: () => openCodeLangPicker(block),
    },
    {
      label: (parts.linenums ? "☑" : "☐") + " " + t("Line numbers"),
      run: () =>
        updateFence(block, (p) => {
          p.linenums = !p.linenums;
        }),
    },
    {
      label: (parts.title ? "☑" : "☐") + " " + t("Title"),
      run: () => toggleCodeTitle(block),
    },
    {
      label: `🎯 ${t("Highlight lines")}` + (parts.hl.size ? ` (${parts.hl.size})` : ""),
      run: () => enterHlMode(block),
    },
    // “Markdown source” and “Delete block” are added by blockMenuItems — every block
    // has them, so there is no need to duplicate them here.
  ];
}

/** Replaces a block with a textarea source editor; Done → a pinpoint edit. */
export function openLiveEditor(
  el: Element | undefined,
  start: number,
  end: number,
  text: string,
  kindLabel: string,
  indent = "",
): void {
  if (!el) {
    return;
  }
  const box = document.createElement("div");
  box.className = "vlive";
  box.setAttribute("contenteditable", "false");
  box.setAttribute("data-src-line", String(start));
  box.setAttribute("data-src-end", String(end));

  const bar = document.createElement("div");
  bar.className = "vlive-bar";
  const label = document.createElement("span");
  label.className = "grow";
  label.textContent = t("Editing: {0}", kindLabel);
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = t("Done");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("Cancel");
  cancel.className = "secondary";
  bar.append(label, ok, cancel);

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.rows = Math.min(20, Math.max(4, text.split("\n").length + 1));
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      restore();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const s = ta.selectionStart;
      ta.setRangeText("    ", s, ta.selectionEnd, "end");
    }
  });

  box.append(bar, ta);
  const saved = el;
  // Replacing a known block with the editor is not a user edit.
  mutedRemote(() => el.replaceWith(box));
  ta.focus();

  const restore = (): void => {
    mutedRemote(() => box.replaceWith(saved));
  };
  cancel.addEventListener("click", restore);
  ok.addEventListener("click", () => {
    const body = indentLines(ta.value.replace(/\n+$/, "").split("\n"), indent);
    const value = body.join("\n") + "\n";
    const cur = rangeOf(box); // the range could have shifted due to parallel edits
    // Drop focus and the selection so that the “catch-up” patch replaces the block
    // with a fresh render (the patch does not touch the focused block).
    ta.blur();
    document.getSelection()?.removeAllRanges();
    sendSync([{ start: cur.start, end: cur.end, text: value }]);
    // The block will be replaced by the synced patch (box gives way to the fresh render).
    box.classList.remove("vlive");
  });
}
