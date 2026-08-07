// Three inline elements whose text lives in two places: a keyboard shortcut, a
// footnote and an abbreviation.
//
// A footnote reference and its definition, an abbreviation and its `*[Term]:`
// line — the visible part is in a paragraph, the rest is a line of the file no
// DOM block stands for. So the editor writes them markdown-first, through a
// queued source edit that rides in the same batch as the paragraph: the
// reference and its definition leave the file together, in one undo step.
//
// Keys (`++ctrl+alt+del++`) has no second half; it is here because it belongs
// to the same family — an inline popup that produces markup at the caret.

import { closePopup, editorPopup, popupAtElement, popupAtSelection } from "./popups";
import { IS_MAC } from "./keyBindings";
import { pressToKeys } from "./keysNotation";
import { t } from "../shared/i18n";
import {
  blockOf,
  dirty,
  doc,
  docEndsNL,
  docLines,
  markDirty,
  queueSourceEdit,
  scheduleSync,
} from "./editorCore";

/** What these need from the editor around them. */
export interface InlineHost {
  /** Drops a ready element in at the caret. */
  insertInline(el: Element): void;
  /** Remembers the selection before a popup takes the focus, and puts it back. */
  saveSelection(): void;
  restoreSelection(): void;
  /** The nearest ancestor with this tag (an abbreviation lives inside `<abbr>`). */
  enclosingTag(node: Node | null, tagName: string): HTMLElement | null;
  /** A tooltip with a URL is a link — that form belongs to the link popup. */
  openLinkPopup(existing?: HTMLAnchorElement): void;
  /** Inserts a link at the selection (the tooltip-with-a-URL case). */
  insertLinkAtSelection(url: string, text: string, title?: string): void;
}

let host: InlineHost;

/** Undoes the key recording of an open Keys popup; the editor calls it on close. */
let cancelCapture: (() => void) | null = null;

export function endKeysCapture(): void {
  cancelCapture?.();
  cancelCapture = null;
}

export function initInlineElements(next: InlineHost): void {
  host = next;
}

// ---------------------------------------------------------------------------
// Keys (pymdownx.keys): `++ctrl+alt+del++`. Instead of typing the notation by
// hand, the popup records the actual key press — the same way the shortcut
// settings do. The notation stays editable in a text field for the cases a
// keyboard cannot produce (`++fn++`, a made-up combination for documentation).
// The reading of a press itself lives in keysNotation.ts, without the DOM.
// ---------------------------------------------------------------------------

export function openKeysPopup(existing?: HTMLElement): void {
  if (!existing) {
    host.saveSelection();
  }
  const pop = existing ? popupAtElement(existing) : popupAtSelection();
  const form = document.createElement("form");
  const head = document.createElement("div");
  head.className = "vpop-title";
  head.textContent = t("Keys");

  const record = document.createElement("button");
  record.type = "button";
  record.className = "secondary vkeys-record";
  record.textContent = t("Press the keys…");

  const label = document.createElement("label");
  label.textContent = t("Notation");
  const input = document.createElement("input");
  input.type = "text";
  input.value = existing?.getAttribute("data-keys") ?? "";
  input.placeholder = "++ctrl+alt+del++";
  label.appendChild(input);

  const help = document.createElement("div");
  help.className = "vpop-help";
  help.textContent = t("Press the button and hit the combination, or type the notation by hand.");

  record.addEventListener("click", () => {
    record.classList.add("capturing");
    record.textContent = t("Waiting for a key press…");
    // The modifiers held so far, shown on the button as they pile up. They are
    // written into the field only when the user lets go: a combination may be
    // modifiers alone (`++ctrl++`), but committing the first one that arrives
    // would turn every Ctrl+Alt+Del into a plain Ctrl.
    let held: string | null = null;
    const onKey = (e: KeyboardEvent): void => {
      // Captured before anything else: neither the editor nor VS Code should
      // execute the combination being recorded.
      e.preventDefault();
      e.stopPropagation();
      const press = pressToKeys(e, IS_MAC);
      if (!press) {
        return;
      }
      if (!press.complete) {
        held = press.notation;
        record.textContent = press.notation;
        return;
      }
      commit(press.notation);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (held) {
        commit(held);
      }
    };
    const commit = (notation: string): void => {
      input.value = notation;
      finish();
    };
    const finish = (): void => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      record.classList.remove("capturing");
      record.textContent = t("Press the keys…");
      cancelCapture = null;
    };
    cancelCapture = finish;
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
  });

  form.append(head, record, label, help);

  const row = document.createElement("div");
  row.className = "row";
  const grow = document.createElement("span");
  grow.className = "grow";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = existing ? t("Save") : t("Insert");
  row.append(grow, cancel, ok);
  form.appendChild(row);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const notation = input.value.trim();
    if (!/^\+\+.+\+\+$/.test(notation)) {
      return;
    }
    closePopup();
    if (existing) {
      existing.setAttribute("data-keys", notation);
      // A placeholder until the sync brings back the rendered <kbd> set.
      existing.textContent = notation;
      markDirty(existing);
      return;
    }
    host.restoreSelection();
    const span = document.createElement("span");
    span.className = "keys";
    span.setAttribute("data-keys", notation);
    span.textContent = notation;
    host.insertInline(span);
  });
  pop.appendChild(form);
  input.focus();
}

// ---------------------------------------------------------------------------
// Footnotes: inserted at the cursor, edited and deleted by clicking the marker
// (or the item in the rendered list at the bottom). The definition lines
// (`[^label]: …`) are represented by no DOM block — they are edited
// markdown-first through queueSourceEdit.
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface FootnoteDef {
  start: number;
  end: number; // exclusive, like data-src-end
  text: string; // the dedented body, possibly multi-line
}

/** Finds the `[^label]:` definition together with its indented continuation lines. */
function findFootnoteDef(label: string): FootnoteDef | null {
  const re = new RegExp(`^\\[\\^${escapeRegExp(label)}\\]:\\s?(.*)$`);
  for (let i = 0; i < docLines().length; i++) {
    const m = re.exec(docLines()[i]);
    if (!m) {
      continue;
    }
    const parts = [m[1]];
    let end = i + 1;
    let blanks = 0;
    for (let j = i + 1; j < docLines().length; j++) {
      const line = docLines()[j];
      if (line.trim() === "") {
        blanks++;
        continue;
      }
      if (!/^ {4}/.test(line)) {
        break;
      }
      while (blanks > 0) {
        parts.push("");
        blanks--;
      }
      parts.push(line.slice(4));
      end = j + 1;
    }
    return { start: i, end, text: parts.join("\n") };
  }
  return null;
}

/** The definition text back into file lines: continuations get the four-space indent. */
function footnoteDefLines(label: string, text: string): string {
  const lines = text.replace(/\n+$/, "").split("\n");
  const first = `[^${label}]: ${lines[0] ?? ""}`.trimEnd();
  const rest = lines.slice(1).map((l) => (l === "" ? "" : `    ${l}`));
  return [first, ...rest].join("\n") + "\n";
}

/** The first free numeric label, counting both markers and definitions. */
function nextFootnoteLabel(): string {
  let max = 0;
  for (const line of docLines()) {
    for (const m of line.matchAll(/\[\^(\d+)\]/g)) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return String(max + 1);
}

/** Appends definition lines at the end of the file, separated by a blank line. */
function appendSourceLines(text: string): void {
  const at = docLines().length;
  const before = at > 0 && (docLines()[at - 1] ?? "").trim() !== "";
  queueSourceEdit({
    start: at,
    end: at,
    text: (docEndsNL() ? "" : "\n") + (before ? "\n" : "") + text,
  });
}

export function openFootnotePopup(): void {
  host.saveSelection();
  const pop = popupAtSelection();
  editorPopup(pop, {
    title: t("New footnote"),
    fields: [
      {
        name: "text",
        label: t("Footnote text"),
        multiline: true,
        placeholder: t("Explanation"),
      },
    ],
    okLabel: t("Insert"),
    onOk: (v) => {
      const text = v.text.trim();
      if (!text) {
        return;
      }
      const label = nextFootnoteLabel();
      host.restoreSelection();
      // The marker gets the label as a placeholder caption; the sync re-render
      // replaces it with the number assigned by the engine.
      const sup = document.createElement("sup");
      sup.className = "footnote-ref";
      sup.setAttribute("data-fn-label", label);
      const a = document.createElement("a");
      a.textContent = `[${label}]`;
      sup.appendChild(a);
      host.insertInline(sup);
      appendSourceLines(footnoteDefLines(label, text));
    },
  });
}

/** The footnote popup: edit the definition text or delete the footnote entirely. */
export function openFootnoteEdit(refEl: HTMLElement): void {
  const label = refEl.getAttribute("data-fn-label") ?? "";
  if (!label) {
    return;
  }
  const def = findFootnoteDef(label);
  const pop = popupAtElement(refEl);
  editorPopup(pop, {
    title: t("Footnote [^{0}]", label),
    fields: [{ name: "text", label: t("Footnote text"), value: def?.text ?? "", multiline: true }],
    okLabel: t("Save"),
    danger: { label: t("Delete"), onClick: () => removeFootnote(label) },
    onOk: (v) => {
      const text = v.text.trim();
      if (!text) {
        return;
      }
      if (def) {
        queueSourceEdit({ start: def.start, end: def.end, text: footnoteDefLines(label, text) });
      } else {
        // The marker points at a missing definition (a broken document) — create one.
        appendSourceLines(footnoteDefLines(label, text));
      }
    },
  });
}

/** Deletes every `[^label]` marker in the document plus the definition lines. */
function removeFootnote(label: string): void {
  for (const ref of Array.from(
    doc().querySelectorAll<HTMLElement>(`.footnote-ref[data-fn-label="${CSS.escape(label)}"]`),
  )) {
    const block = blockOf(ref);
    if (!block || block.classList.contains("vnoedit")) {
      continue; // inside a text island the marker is literal source text — leave it alone
    }
    ref.remove();
    dirty.add(block);
  }
  const def = findFootnoteDef(label);
  if (def) {
    queueSourceEdit({ start: def.start, end: def.end, text: "" });
  } else {
    scheduleSync(80);
  }
}

// ---------------------------------------------------------------------------
// Tooltips. Material has two mechanisms: a link title (the tooltip lives on
// that one link) and an abbreviation `*[Term]: …` (every occurrence of the
// term in the document gets the tooltip). The popup covers both: with a URL it
// builds a link, without one — an abbreviation definition.
// ---------------------------------------------------------------------------

interface AbbrDef {
  line: number;
  text: string;
}

/** Finds the `*[term]: …` definition line. */
function findAbbrDef(term: string): AbbrDef | null {
  const re = new RegExp(`^\\*\\[${escapeRegExp(term)}\\]:\\s?(.*)$`);
  for (let i = 0; i < docLines().length; i++) {
    const m = re.exec(docLines()[i]);
    if (m) {
      return { line: i, text: m[1] };
    }
  }
  return null;
}

function upsertAbbrDef(term: string, tip: string): void {
  const def = findAbbrDef(term);
  if (def) {
    queueSourceEdit({ start: def.line, end: def.line + 1, text: `*[${term}]: ${tip}\n` });
  } else {
    appendSourceLines(`*[${term}]: ${tip}\n`);
  }
}

export function openTooltipPopup(): void {
  // The caret is inside a link — its popup already has the tooltip field.
  const sel = document.getSelection();
  const a = sel && sel.rangeCount > 0 ? host.enclosingTag(sel.anchorNode, "A") : null;
  if (a && !a.classList.contains("header-anchor")) {
    host.openLinkPopup(a as HTMLAnchorElement);
    return;
  }
  host.saveSelection();
  const pop = popupAtSelection();
  const selText = document.getSelection()?.toString().trim() ?? "";
  editorPopup(pop, {
    title: t("Tooltip"),
    fields: [
      { name: "text", label: t("Text"), value: selText },
      { name: "tip", label: t("Tooltip text"), placeholder: t("Shown on hover") },
      {
        name: "url",
        label: t("Link (optional)"),
        placeholder: t("https://… or page.md"),
        help: t(
          "With a link, the tooltip belongs to that link only. Without one, the text becomes an abbreviation: every occurrence in the document gets the tooltip.",
        ),
      },
    ],
    okLabel: t("Insert"),
    onOk: (v) => {
      const text = v.text.trim();
      const tip = v.tip.trim();
      if (!text || !tip) {
        return;
      }
      const url = v.url.trim();
      if (url) {
        host.restoreSelection();
        host.insertLinkAtSelection(url, text, tip);
        return;
      }
      upsertAbbrDef(text, tip);
      // The term has to exist in the text: with a collapsed cursor it is typed in.
      host.restoreSelection();
      const selNow = document.getSelection();
      if (
        selNow &&
        selNow.rangeCount > 0 &&
        selNow.getRangeAt(0).collapsed &&
        doc().contains(selNow.anchorNode)
      ) {
        const node = document.createTextNode(text);
        const range = selNow.getRangeAt(0);
        range.insertNode(node);
        const after = document.createRange();
        after.setStartAfter(node);
        after.collapse(true);
        selNow.removeAllRanges();
        selNow.addRange(after);
        markDirty(node);
      }
    },
  });
}

/** The abbreviation popup: edit the tooltip text or delete the definition. */
export function openAbbrEdit(el: HTMLElement): void {
  const term = (el.textContent ?? "").trim();
  if (!term) {
    return;
  }
  const def = findAbbrDef(term);
  const pop = popupAtElement(el);
  editorPopup(pop, {
    title: t("Abbreviation: {0}", term),
    fields: [
      {
        name: "tip",
        label: t("Tooltip text"),
        value: def?.text ?? el.getAttribute("title") ?? "",
      },
    ],
    okLabel: t("Save"),
    danger: def
      ? {
          label: t("Delete"),
          onClick: () => queueSourceEdit({ start: def.line, end: def.line + 1, text: "" }),
        }
      : undefined,
    onOk: (v) => {
      const tip = v.tip.trim();
      if (tip) {
        upsertAbbrDef(term, tip);
      }
    },
  });
}
