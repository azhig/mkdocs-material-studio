// Formulas. One dialog for inserting and editing: the LaTeX field with a live
// KaTeX preview and the parser's message, plus a switch between an inline
// formula and a separate block.
//
// KaTeX is loaded on demand — the page's formulas are rendered on the host
// side, so the editor needs the library for the preview alone.

import { t } from "../shared/i18n";
import { closePopup, firstErrorLine, popupAtElement, popupAtSelection } from "./popups";

declare const window: Window & {
  __katex?: {
    renderToString: (
      tex: string,
      options?: { displayMode?: boolean; throwOnError?: boolean },
    ) => string;
  };
};

export interface MathDialogHost {
  /** Address of the KaTeX bundle inside the webview, and the CSP nonce. */
  katexUri: string;
  nonce: string;
}

let host: MathDialogHost = { katexUri: "", nonce: "" };

export function initMathDialog(next: MathDialogHost): void {
  host = next;
}

/** The bundle is fetched once; later calls await the same promise. */
let katexLoading: Promise<void> | undefined;

function ensureKatex(): Promise<void> {
  if (window.__katex) {
    return Promise.resolve();
  }
  if (!katexLoading) {
    const src = host.katexUri ?? "";
    if (!src) {
      return Promise.reject(new Error("katex uri is not configured"));
    }
    katexLoading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      if (host.nonce) {
        script.setAttribute("nonce", host.nonce);
      }
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("katex load failed"));
      document.head.appendChild(script);
    });
  }
  return katexLoading;
}

export function openMathDialog(opts: {
  title: string;
  tex: string;
  block: boolean;
  okLabel: string;
  anchor?: HTMLElement;
  modeSwitch?: boolean;
  danger?: { label: string; onClick: () => void };
  onSave: (tex: string, block: boolean) => void;
}): void {
  const pop = opts.anchor ? popupAtElement(opts.anchor) : popupAtSelection();
  pop.classList.add("vmath");
  const form = document.createElement("form");

  const head = document.createElement("div");
  head.className = "vpop-title";
  head.textContent = opts.title;

  const label = document.createElement("label");
  label.textContent = "LaTeX";
  const ta = document.createElement("textarea");
  ta.value = opts.tex;
  ta.rows = Math.min(6, Math.max(2, opts.tex.split("\n").length));
  ta.spellcheck = false;
  ta.placeholder = "a^2 + b^2 = c^2";
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      // Enter submits (a formula is usually one line); Shift+Enter is a newline.
      e.preventDefault();
      form.requestSubmit();
    }
  });
  label.appendChild(ta);

  const preview = document.createElement("div");
  preview.className = "vmath-preview";
  const err = document.createElement("div");
  err.className = "vmath-err";

  form.append(head, label, preview, err);

  let blockMode = opts.block;
  if (opts.modeSwitch) {
    const check = document.createElement("label");
    check.className = "vcheck";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = blockMode;
    input.addEventListener("change", () => {
      blockMode = input.checked;
      schedulePreview();
    });
    check.append(input, document.createTextNode(t("As a separate block")));
    form.appendChild(check);
  }

  const row = document.createElement("div");
  row.className = "row";
  if (opts.danger) {
    const danger = document.createElement("button");
    danger.type = "button";
    danger.className = "danger";
    danger.textContent = opts.danger.label;
    const run = opts.danger.onClick;
    danger.addEventListener("click", () => {
      closePopup();
      run();
    });
    row.appendChild(danger);
  }
  const grow = document.createElement("span");
  grow.className = "grow";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = opts.okLabel;
  row.append(grow, cancel, ok);
  form.appendChild(row);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const tex = ta.value.trim();
    if (!tex) {
      return;
    }
    closePopup();
    opts.onSave(tex, blockMode);
  });
  pop.appendChild(form);
  ta.focus();
  ta.select();

  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedulePreview(): void {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => void renderPreview(), 200);
  }
  ta.addEventListener("input", schedulePreview);

  async function renderPreview(): Promise<void> {
    const tex = ta.value.trim();
    if (!tex) {
      preview.innerHTML = "";
      err.textContent = "";
      return;
    }
    try {
      await ensureKatex();
      // throwOnError so the message reaches the user; the page render is
      // forgiving on purpose and would silently show the formula in red.
      const html = window.__katex?.renderToString(tex, {
        displayMode: blockMode,
        throwOnError: true,
      });
      if (!pop.isConnected) {
        return; // the popup was closed while the library was loading
      }
      preview.innerHTML = html ?? "";
      preview.classList.remove("stale");
      err.textContent = "";
    } catch (e) {
      preview.classList.add("stale");
      err.textContent = firstErrorLine(e);
    }
  }
  void renderPreview();
}
