// Material-style code copy button (`.md-code__nav`) — as in the Material
// reference for Code blocks (`content.code.copy`).
//
// The button is created by the webview runtime and is NOT part of the rendered
// markup:
//  * the visual editor's serializer only reads `pre > code` and `.filename`, so the
//    round-trip is unaffected;
//  * the editor's MutationObserver skips mutations inside `contenteditable=false`,
//    so the appearance of the panel does not count as a document edit.
//
// Styling comes from the Material theme's main.css (`.md-code__nav`,
// `.md-code__button`, the `--md-code-copy-icon` icon).

import { t } from "./i18n";

export interface CodeNavOptions {
  /** Text placed on the clipboard by the copy button. */
  codeText: (block: HTMLElement) => string;
  /** Tooltip attribute: the editor's own tooltip (`data-tip`) or the native `title`. */
  tipAttr?: "title" | "data-tip";
  /** Copy outcome message (the editor's status line). */
  notify?: (text: string) => void;
}

const COPY_TIP = t("Copy code");
const COPY_DONE = t("Copied");
const COPY_FAIL = t("Could not copy");

/**
 * Adds a copy button to a code block (idempotent — a repeated call does
 * nothing). Returns the panel, or null if the block does not look like a code
 * block.
 */
export function decorateCodeNav(block: HTMLElement, opts: CodeNavOptions): HTMLElement | null {
  const existing = block.querySelector<HTMLElement>(":scope > .md-code__nav");
  if (existing) {
    return existing;
  }
  if (!block.querySelector(":scope > pre > code")) {
    return null;
  }
  const tipAttr = opts.tipAttr ?? "title";
  const nav = document.createElement("div");
  nav.className = "md-code__nav";
  nav.setAttribute("contenteditable", "false");
  nav.appendChild(
    makeButton(COPY_TIP, tipAttr, (btn) => {
      void runCopy(block, btn, tipAttr, opts);
    }),
  );
  block.appendChild(nav);
  return nav;
}

function makeButton(
  tip: string,
  tipAttr: "title" | "data-tip",
  run: (btn: HTMLButtonElement) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "md-code__button";
  btn.setAttribute("data-md-type", "copy");
  btn.setAttribute(tipAttr, tip);
  btn.setAttribute("aria-label", tip);
  // Inside contenteditable a press must not move the caret or break the
  // selection, and in the preview it must not open the block for editing (the
  // delegated block click).
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    run(btn);
  });
  return btn;
}

async function runCopy(
  block: HTMLElement,
  btn: HTMLButtonElement,
  tipAttr: "title" | "data-tip",
  opts: CodeNavOptions,
): Promise<void> {
  const ok = await writeClipboard(opts.codeText(block));
  flash(btn, tipAttr, ok ? COPY_DONE : COPY_FAIL, ok);
  opts.notify?.(ok ? COPY_DONE : COPY_FAIL);
}

/** Brief feedback on the button itself: tooltip + highlight. */
function flash(
  btn: HTMLButtonElement,
  tipAttr: "title" | "data-tip",
  text: string,
  ok: boolean,
): void {
  const prev = btn.getAttribute(tipAttr) ?? COPY_TIP;
  btn.setAttribute(tipAttr, text);
  btn.classList.toggle("md-code__button--active", ok);
  window.setTimeout(() => {
    btn.setAttribute(tipAttr, prev);
    btn.classList.remove("md-code__button--active");
  }, 1600);
}

/**
 * Writes text to the clipboard. `navigator.clipboard` is not always available
 * in a webview (no permission, wrong context) — then the old `execCommand`
 * path runs, restoring the user's selection afterwards.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the fallback
  }
  const sel = document.getSelection();
  const saved = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  if (sel && saved) {
    sel.removeAllRanges();
    sel.addRange(saved);
  }
  return ok;
}
