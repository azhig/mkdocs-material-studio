// Inserting Material's block components: an admonition, a code block, content
// tabs, a card grid, a button, a snippet and a table.
//
// Every one of them is the same story told with different fields — a popup that
// asks for what the markup needs, then a ready block dropped in at the caret's
// indent. They are leaves of the editor: nothing here knows how the document is
// drawn, only what markdown to produce and where it goes.

import { attachCombo, closePopup, popupAtElement, showPopup, type ComboItem } from "./popups";
import { t } from "../shared/i18n";
import {
  blockOf,
  dirty,
  doc,
  docLines,
  markDirty,
  rangeOf,
  scheduleSync,
  sendBuiltSync,
  setAfterSync,
} from "./editorCore";
import type { SyncEdit } from "./syncModel";
import { buildFenceInfo, LANGUAGES } from "./codeFence";
// What a block is written back as decides what it is worth writing in the first
// place: a template that differs from the serializer's output would be rewritten
// the first time the author edits the block.
import { defaultTitle, EMPTY_CELL } from "./htmlToMd";

/** Where a new block goes: the line, and the indent that nests it. */
export interface InsertPoint {
  line: number;
  indent: string;
}

/** What the inserts need from the editor around them. */
export interface InsertsHost {
  /** Where a new block goes — the caret's block and its indent. */
  insertPoint(): InsertPoint;
  /** Drops a ready block in at that point. */
  insertMarkdownBlock(template: string, at?: InsertPoint): void;
  /** The element a popup opens under (the “+ Insert” button, or the caret). */
  popupAnchor(): HTMLElement;
  /** The block that starts on this line of the file. */
  blockByStart(start: number): Element | undefined;
  /** Puts the caret inside a block. */
  caretInto(block: HTMLElement): void;
  /** Asks the extension for a file through the VS Code dialog. */
  pickFile(kind: "image" | "snippet"): Promise<string>;
  /** The pages of the site, for the button's address field. */
  linkSuggestions(): ComboItem[];
}

let host: InsertsHost;

export function initInserts(next: InsertsHost): void {
  host = next;
}

// --- Admonition settings: the type and the collapsibility -------------------

export const ADMONITION_TYPES = [
  "note",
  "abstract",
  "info",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
];
export const ADMONITION_LABELS: Record<string, string> = {
  note: t("Note"),
  abstract: t("Abstract"),
  info: t("Info"),
  tip: t("Tip"),
  success: t("Success"),
  question: t("Question"),
  warning: t("Warning"),
  failure: t("Failure"),
  danger: t("Danger"),
  bug: t("Bug"),
  example: t("Example"),
  quote: t("Quote"),
};

type Collapse = "plain" | "collapsed" | "expanded";

export function currentAdmonitionState(el: Element): { type: string; collapse: Collapse } {
  const classes = Array.from(el.classList).filter((c) => c !== "admonition");
  const type = classes[0] ?? "note";
  let collapse: Collapse = "plain";
  if (el.tagName === "DETAILS") {
    collapse = el.hasAttribute("open") ? "expanded" : "collapsed";
  }
  return { type, collapse };
}

/**
 * The admonition type and collapsibility — an icon grid and a row of buttons. It is drawn
 * right inside the block menu section: the set is finite (12 types, 3 states) and fits
 * comfortably, so there is no point in hiding it behind another click.
 */
export function renderAdmonitionControls(host: HTMLElement, el: Element): void {
  const state = currentAdmonitionState(el);

  const grid = document.createElement("div");
  grid.className = "adm-types";
  for (const t of ADMONITION_TYPES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "adm-type adm-" + t + (t === state.type ? " sel" : "");
    // The localized name goes into the tooltip (the instant #vtip).
    b.title = ADMONITION_LABELS[t] ?? t;
    // The type icon (the same one Material draws for an admonition of this type).
    const ico = document.createElement("span");
    ico.className = "adm-ico";
    b.appendChild(ico);
    // The original Material name (Note, Tip, Warning…) — used as the default title.
    const name = document.createElement("span");
    name.className = "adm-name";
    name.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    b.appendChild(name);
    b.addEventListener("click", () => {
      applyAdmonitionChange(el, { type: t });
      closePopup();
    });
    grid.appendChild(b);
  }
  host.appendChild(grid);

  const row = document.createElement("div");
  row.className = "adm-collapse";
  const opts: Array<[Collapse, string]> = [
    ["plain", t("Normal")],
    ["collapsed", t("Collapsed ▸")],
    ["expanded", t("Expanded ▾")],
  ];
  for (const [key, lbl] of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "adm-col" + (key === state.collapse ? " sel" : "");
    b.textContent = lbl;
    b.addEventListener("click", () => {
      applyAdmonitionChange(el, { collapse: key });
      closePopup();
    });
    row.appendChild(b);
  }
  host.appendChild(row);
}

/**
 * The admonition insert picker from the “+ Insert” palette: first the TYPE and
 * COLLAPSIBILITY are chosen, then “Insert” drops in a ready block with the right marker.
 * The insertion anchor is captured immediately (while the caret in the document is not lost yet).
 */
export function openAdmonitionInsert(): void {
  const at = host.insertPoint();
  const anchor = document.getElementById("tbComponent") as HTMLElement | null;
  const rect = anchor?.getBoundingClientRect();
  const pop = showPopup(
    rect ? Math.max(8, rect.right + window.scrollX - 260) : 120,
    rect ? rect.bottom + window.scrollY + 4 : 120,
  );
  pop.className = "vpop adm-settings adm-insert";

  let selType = "note";
  let selCollapse: Collapse = "plain";

  const typeHead = document.createElement("div");
  typeHead.className = "cat";
  typeHead.textContent = t("Type");
  pop.appendChild(typeHead);

  const grid = document.createElement("div");
  grid.className = "adm-types";
  for (const t of ADMONITION_TYPES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "adm-type adm-" + t + (t === selType ? " sel" : "");
    b.title = ADMONITION_LABELS[t] ?? t;
    const ico = document.createElement("span");
    ico.className = "adm-ico";
    b.appendChild(ico);
    const name = document.createElement("span");
    name.className = "adm-name";
    name.textContent = t.charAt(0).toUpperCase() + t.slice(1);
    b.appendChild(name);
    b.addEventListener("mousedown", (e) => e.preventDefault()); // do not lose the selection in the document
    b.addEventListener("click", () => {
      selType = t;
      grid.querySelectorAll(".adm-type").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
    });
    grid.appendChild(b);
  }
  pop.appendChild(grid);

  const colHead = document.createElement("div");
  colHead.className = "cat";
  colHead.textContent = t("Collapsible");
  pop.appendChild(colHead);

  const row = document.createElement("div");
  row.className = "adm-collapse";
  const opts: Array<[Collapse, string]> = [
    ["plain", t("Normal")],
    ["collapsed", t("Collapsed ▸")],
    ["expanded", t("Expanded ▾")],
  ];
  for (const [key, lbl] of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "adm-col" + (key === selCollapse ? " sel" : "");
    b.textContent = lbl;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      selCollapse = key;
      row.querySelectorAll(".adm-col").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
    });
    row.appendChild(b);
  }
  pop.appendChild(row);

  const foot = document.createElement("div");
  foot.className = "adm-insert-foot";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "adm-insert-ok";
  ok.textContent = t("Insert");
  ok.addEventListener("mousedown", (e) => e.preventDefault());
  ok.addEventListener("click", () => {
    const marker =
      selCollapse === "expanded" ? "???+" : selCollapse === "collapsed" ? "???" : "!!!";
    const label = ADMONITION_LABELS[selType] ?? selType;
    // Material shows the type as the title when none is given, so writing that
    // same word changes nothing on the page — and the serializer drops it the
    // moment the block is edited, which would read as a diff nobody made. In a
    // translated interface the label differs from the type and is written.
    const title = label === defaultTitle(selType) ? "" : ` "${label}"`;
    closePopup();
    host.insertMarkdownBlock(`${marker} ${selType}${title}\n    ${t("Text.")}`, at);
  });
  foot.appendChild(ok);
  pop.appendChild(foot);
}

/**
 * Inserting a Material button: the link address and the text are asked for right away, then
 * `[text](url){ .md-button }` is inserted. The insertion anchor is captured when the form opens —
 * focusing/typing in its fields clears the selection in the document.
 */
export function openButtonInsert(): void {
  const at = host.insertPoint();
  const anchor = document.getElementById("tbComponent") as HTMLElement | null;
  const rect = anchor?.getBoundingClientRect();
  const pop = showPopup(
    rect ? Math.max(8, rect.right + window.scrollX - 260) : 120,
    rect ? rect.bottom + window.scrollY + 4 : 120,
  );
  buttonForm(pop, { text: t("Button"), url: "", primary: false }, t("Insert"), (v) => {
    const classes = v.primary ? ".md-button .md-button--primary" : ".md-button";
    host.insertMarkdownBlock(`[${v.text}](${v.url}){ ${classes} }`, at);
  });
}

/**
 * The button form: the text, the address (with page autocompletion) and the
 * “primary” style — the `.md-button--primary` modifier of the Material
 * reference. Shared by inserting and by editing an existing button.
 */
function buttonForm(
  pop: HTMLElement,
  initial: { text: string; url: string; primary: boolean },
  okLabel: string,
  onOk: (v: { text: string; url: string; primary: boolean }) => void,
  danger?: { label: string; onClick: () => void },
): void {
  const form = document.createElement("form");
  const head = document.createElement("div");
  head.className = "vpop-title";
  head.textContent = t("Button");

  const urlLabel = document.createElement("label");
  urlLabel.className = "vcombo";
  urlLabel.textContent = t("Link address");
  const url = document.createElement("input");
  url.type = "text";
  url.value = initial.url;
  url.placeholder = t("https://… or page.md");
  urlLabel.appendChild(url);
  attachCombo(url, urlLabel, host.linkSuggestions);

  const textLabel = document.createElement("label");
  textLabel.textContent = t("Button text");
  const text = document.createElement("input");
  text.type = "text";
  text.value = initial.text;
  text.placeholder = t("Download");
  textLabel.appendChild(text);

  const primaryLabel = document.createElement("label");
  primaryLabel.className = "vcheck";
  const primary = document.createElement("input");
  primary.type = "checkbox";
  primary.checked = initial.primary;
  primaryLabel.append(primary, document.createTextNode(t("Primary (filled) style")));

  form.append(head, urlLabel, textLabel, primaryLabel);

  const row = document.createElement("div");
  row.className = "row";
  if (danger) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = danger.label;
    const run = danger.onClick;
    del.addEventListener("click", () => {
      closePopup();
      run();
    });
    row.appendChild(del);
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
  ok.textContent = okLabel;
  row.append(grow, cancel, ok);
  form.appendChild(row);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    closePopup();
    onOk({
      text: text.value.trim() || t("Button"),
      url: url.value.trim() || "#",
      primary: primary.checked,
    });
  });
  pop.appendChild(form);
  url.focus();
}

/** Editing an existing `.md-button`: the same form, applied to the element. */
export function openButtonEdit(el: HTMLAnchorElement): void {
  const pop = popupAtElement(el);
  buttonForm(
    pop,
    {
      text: el.textContent ?? "",
      url: el.getAttribute("href") ?? "",
      primary: el.classList.contains("md-button--primary"),
    },
    t("Save"),
    (v) => {
      el.setAttribute("href", v.url);
      el.textContent = v.text;
      el.classList.toggle("md-button--primary", v.primary);
      markDirty(el);
    },
    {
      label: t("Delete"),
      onClick: () => {
        const block = blockOf(el);
        el.remove();
        if (block) {
          dirty.add(block);
          scheduleSync(80);
        }
      },
    },
  );
}

/**
 * Inserting a code block: the language (with autocompletion from LANGUAGES),
 * line numbering and the title are asked for right away. The info string is built with the same buildFenceInfo as
 * an edit through the handle menu. The anchor is captured when it opens (the form fields clear
 * the selection in the document).
 */
export function openCodeInsert(): void {
  const at = host.insertPoint();
  const anchor = document.getElementById("tbComponent") as HTMLElement | null;
  const rect = anchor?.getBoundingClientRect();
  const pop = showPopup(
    rect ? Math.max(8, rect.right + window.scrollX - 260) : 120,
    rect ? rect.bottom + window.scrollY + 4 : 120,
  );

  const form = document.createElement("form");

  // The language is free-form input with a filterable list. A custom drop-down inside the popup, and
  // NOT the native <datalist>: in a webview its drop-down is positioned incorrectly
  // (it drifts to the left of the field). The list is absolute, right under the input.
  const langLabel = document.createElement("label");
  langLabel.className = "vcombo";
  langLabel.textContent = t("Language");
  const langInput = document.createElement("input");
  langInput.type = "text";
  langInput.value = "python";
  langInput.placeholder = "python";
  langInput.autocomplete = "off";
  const sug = document.createElement("div");
  sug.className = "vmenu vcombo-list";
  sug.style.display = "none";
  const renderSug = (): void => {
    const q = langInput.value.trim().toLowerCase();
    sug.textContent = "";
    const matches = LANGUAGES.filter((l) => l.includes(q));
    if (matches.length === 0 || (matches.length === 1 && matches[0] === q)) {
      sug.style.display = "none";
      return;
    }
    for (const l of matches) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = l;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault(); // do not blur the input before the click
        langInput.value = l;
        sug.style.display = "none";
      });
      sug.appendChild(b);
    }
    sug.style.display = "flex";
  };
  langInput.addEventListener("input", renderSug);
  langInput.addEventListener("focus", renderSug);
  langInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      sug.style.display = "none";
    }, 120);
  });
  langInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && sug.style.display !== "none") {
      const first = sug.querySelector("button");
      if (first) {
        e.preventDefault();
        langInput.value = first.textContent ?? "";
        sug.style.display = "none";
      }
    }
  });
  langLabel.append(langInput, sug);
  form.appendChild(langLabel);

  // Line numbering is a checkbox (a horizontal row).
  const lnLabel = document.createElement("label");
  lnLabel.className = "vcheck";
  const lnInput = document.createElement("input");
  lnInput.type = "checkbox";
  lnLabel.append(lnInput, document.createTextNode(t("Line numbers")));
  form.appendChild(lnLabel);

  // The title is optional.
  const titleLabel = document.createElement("label");
  titleLabel.textContent = t("Title (optional)");
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "app.py";
  titleLabel.appendChild(titleInput);
  form.appendChild(titleLabel);

  const row = document.createElement("div");
  row.className = "row";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = t("Insert");
  row.append(cancel, ok);
  form.appendChild(row);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    closePopup();
    const info = buildFenceInfo({
      lang: langInput.value.trim(),
      title: titleInput.value.trim(),
      linenums: lnInput.checked,
      hl: new Set<number>(),
      body: [],
      extra: [],
      attrs: [],
    });
    host.insertMarkdownBlock("```" + info + `\n${t("code")}\n` + "```", at);
  });

  pop.appendChild(form);
  langInput.focus();
  langInput.select();
}

/**
 * Inserting a set of tabs: a form with a list of names (add/remove a row,
 * drag the handle to reorder). A single `=== "…"` set is built with any
 * number of tabs — Material even allows just one. The cursor lands in the first one.
 */
export function openTabsInsert(): void {
  const at = host.insertPoint();
  const anchor = document.getElementById("tbComponent") as HTMLElement | null;
  const rect = anchor?.getBoundingClientRect();
  const pop = showPopup(
    rect ? Math.max(8, rect.right + window.scrollX - 260) : 120,
    rect ? rect.bottom + window.scrollY + 4 : 120,
  );

  const form = document.createElement("form");
  const heading = document.createElement("div");
  heading.className = "vpop-title";
  heading.textContent = t("Insert tabs");
  form.appendChild(heading);

  const rowsBox = document.createElement("div");
  rowsBox.className = "vtabrows";
  form.appendChild(rowsBox);

  let dragRow: HTMLElement | null = null;

  const refreshRemovable = (): void => {
    const all = Array.from(rowsBox.querySelectorAll<HTMLElement>(".vtabrow"));
    for (const r of all) {
      const x = r.querySelector<HTMLElement>(".vtabrow-x");
      // At least one tab is required — with a single row the “×” is hidden.
      if (x) x.style.visibility = all.length > 1 ? "visible" : "hidden";
    }
  };

  const addRow = (value: string, focus = false): void => {
    const row = document.createElement("div");
    row.className = "vtabrow";

    const grip = document.createElement("span");
    grip.className = "vtabrow-grip";
    grip.textContent = "⋮⋮";
    grip.title = t("Drag to change the order");
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
      dragRow = row;
      row.classList.add("vtabrow-drag");
      e.dataTransfer?.setData("text/plain", "");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
      }
    });
    grip.addEventListener("dragend", () => {
      dragRow = null;
      row.classList.remove("vtabrow-drag");
    });

    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = t("Tab name");
    input.autocomplete = "off";

    const x = document.createElement("button");
    x.type = "button";
    x.className = "vtabrow-x";
    x.textContent = "×";
    x.title = t("Remove tab");
    x.addEventListener("click", () => {
      if (rowsBox.querySelectorAll(".vtabrow").length <= 1) {
        return;
      }
      row.remove();
      refreshRemovable();
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragRow || dragRow === row) {
        return;
      }
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      rowsBox.insertBefore(dragRow, after ? row.nextSibling : row);
    });

    row.append(grip, input, x);
    rowsBox.appendChild(row);
    refreshRemovable();
    if (focus) {
      input.focus();
      input.select();
    }
  };

  addRow(t("Tab {0}", 1));
  addRow(t("Tab {0}", 2));

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "vtab-addrow";
  addBtn.textContent = `+ ${t("Add tab")}`;
  addBtn.addEventListener("click", () => {
    addRow(t("Tab {0}", rowsBox.querySelectorAll(".vtabrow").length + 1), true);
  });
  form.appendChild(addBtn);

  const btnRow = document.createElement("div");
  btnRow.className = "row";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = t("Insert");
  btnRow.append(cancel, ok);
  form.appendChild(btnRow);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    closePopup();
    const titles = Array.from(rowsBox.querySelectorAll<HTMLInputElement>(".vtabrow input")).map(
      (inp, i) => (inp.value.trim() || t("Tab {0}", i + 1)).replace(/"/g, "'"),
    );
    if (titles.length === 0) {
      return;
    }
    const template = titles.map((title) => `=== "${title}"`).join("\n\n");
    setAfterSync(() => focusFirstTabAt(at.line));
    host.insertMarkdownBlock(template, at);
  });

  pop.appendChild(form);
}

/** Places the cursor into the first tab of the set inserted near anchorLine. */
function focusFirstTabAt(anchorLine: number): void {
  const sets = Array.from(doc().querySelectorAll<HTMLElement>(".tabbed-set[data-src-line]"));
  let best: HTMLElement | null = null;
  for (const s of sets) {
    const line = Number(s.getAttribute("data-src-line"));
    if (line >= anchorLine && (!best || line < Number(best.getAttribute("data-src-line")))) {
      best = s;
    }
  }
  const block = best?.querySelector<HTMLElement>(":scope > .tabbed-content > .tabbed-block");
  if (block) {
    host.caretInto(block);
  }
}

/**
 * The “Insert a card grid” form: a list of card titles with adding,
 * removing and dragging of rows. On “Insert” a `grid cards` block is built and
 * the cursor lands in the first card. Mirrors openTabsInsert.
 */
export function openGridInsert(): void {
  const at = host.insertPoint();
  const anchor = document.getElementById("tbComponent") as HTMLElement | null;
  const rect = anchor?.getBoundingClientRect();
  const pop = showPopup(
    rect ? Math.max(8, rect.right + window.scrollX - 260) : 120,
    rect ? rect.bottom + window.scrollY + 4 : 120,
  );

  const form = document.createElement("form");
  const heading = document.createElement("div");
  heading.className = "vpop-title";
  heading.textContent = t("Insert a card grid");
  form.appendChild(heading);

  const rowsBox = document.createElement("div");
  rowsBox.className = "vtabrows";
  form.appendChild(rowsBox);

  let dragRow: HTMLElement | null = null;

  const refreshRemovable = (): void => {
    const all = Array.from(rowsBox.querySelectorAll<HTMLElement>(".vtabrow"));
    for (const r of all) {
      const x = r.querySelector<HTMLElement>(".vtabrow-x");
      // At least one card is required — with a single row the “×” is hidden.
      if (x) x.style.visibility = all.length > 1 ? "visible" : "hidden";
    }
  };

  const addRow = (value: string, focus = false): void => {
    const row = document.createElement("div");
    row.className = "vtabrow";

    const grip = document.createElement("span");
    grip.className = "vtabrow-grip";
    grip.textContent = "⋮⋮";
    grip.title = t("Drag to change the order");
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
      dragRow = row;
      row.classList.add("vtabrow-drag");
      e.dataTransfer?.setData("text/plain", "");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
      }
    });
    grip.addEventListener("dragend", () => {
      dragRow = null;
      row.classList.remove("vtabrow-drag");
    });

    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = t("Card title");
    input.autocomplete = "off";

    const x = document.createElement("button");
    x.type = "button";
    x.className = "vtabrow-x";
    x.textContent = "×";
    x.title = t("Remove card");
    x.addEventListener("click", () => {
      if (rowsBox.querySelectorAll(".vtabrow").length <= 1) {
        return;
      }
      row.remove();
      refreshRemovable();
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragRow || dragRow === row) {
        return;
      }
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      rowsBox.insertBefore(dragRow, after ? row.nextSibling : row);
    });

    row.append(grip, input, x);
    rowsBox.appendChild(row);
    refreshRemovable();
    if (focus) {
      input.focus();
      input.select();
    }
  };

  addRow(t("Card {0}", 1));
  addRow(t("Card {0}", 2));

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "vtab-addrow";
  addBtn.textContent = `+ ${t("Add card")}`;
  addBtn.addEventListener("click", () => {
    addRow(t("Card {0}", rowsBox.querySelectorAll(".vtabrow").length + 1), true);
  });
  form.appendChild(addBtn);

  const btnRow = document.createElement("div");
  btnRow.className = "row";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("click", closePopup);
  const ok = document.createElement("button");
  ok.type = "submit";
  ok.textContent = t("Insert");
  btnRow.append(cancel, ok);
  form.appendChild(btnRow);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    closePopup();
    const titles = Array.from(rowsBox.querySelectorAll<HTMLInputElement>(".vtabrow input")).map(
      (inp, i) => inp.value.trim() || t("Card {0}", i + 1),
    );
    if (titles.length === 0) {
      return;
    }
    const cards = titles
      .map((title) => `- **${title}**\n\n    ${t("Card description.")}`)
      .join("\n\n");
    const template = `<div class="grid cards" markdown>\n\n${cards}\n\n</div>`;
    setAfterSync(() => focusFirstCardAt(at.line));
    host.insertMarkdownBlock(template, at);
  });

  pop.appendChild(form);
}

/** Places the cursor into the title of the first card of the grid inserted near anchorLine. */
function focusFirstCardAt(anchorLine: number): void {
  const grids = Array.from(doc().querySelectorAll<HTMLElement>(".grid[data-src-line]"));
  let best: HTMLElement | null = null;
  for (const g of grids) {
    const line = Number(g.getAttribute("data-src-line"));
    if (line >= anchorLine && (!best || line < Number(best.getAttribute("data-src-line")))) {
      best = g;
    }
  }
  const li = best?.querySelector<HTMLElement>(":scope > ul > li") ?? null;
  if (li) {
    host.caretInto(li);
  }
}

/**
 * Changes the type/collapsibility through a pinpoint edit of the marker line in
 * the source.
 *
 * The batch is built when it is about to be sent, not here: clicking a second
 * type while the answer to the first is still travelling used to send line
 * numbers and a document version the file had already moved past, and such a
 * batch is refused whole — the second click did nothing, and the call-out
 * silently stayed the colour the first one had given it.
 */
export function applyAdmonitionChange(
  el: Element,
  next: { type?: string; collapse?: Collapse },
): void {
  const at = rangeOf(el).start;
  document.getSelection()?.removeAllRanges();
  sendBuiltSync(() => buildAdmonitionEdit(at, next));
}

/** The marker line as it will be after the change — read from the current text. */
function buildAdmonitionEdit(
  at: number,
  next: { type?: string; collapse?: Collapse },
): SyncEdit[] | undefined {
  // The element is looked up again: an answer that arrived in between replaced
  // the block, and the node the click was made on is no longer in the document.
  const el = host.blockByStart(at);
  if (!el) {
    return undefined;
  }
  const { start, end } = rangeOf(el);
  const lines = docLines().slice(start, end);
  if (lines.length === 0) {
    return undefined;
  }
  const m = /^(\s*)(!!!|\?\?\?\+?)\s+(.*)$/.exec(lines[0]);
  if (!m) {
    return undefined;
  }
  const indent = m[1];
  const rest = m[3].trim();
  const titleMatch = /"([^"]*)"\s*$/.exec(rest);
  const title = titleMatch ? titleMatch[1] : null;
  const typesPart = titleMatch ? rest.slice(0, titleMatch.index).trim() : rest;
  const tokens = typesPart ? typesPart.split(/\s+/) : [];
  const cur = currentAdmonitionState(el);
  const newType = next.type ?? cur.type;
  if (tokens.length === 0) {
    tokens.push(newType);
  } else {
    tokens[0] = newType;
  }
  const collapse = next.collapse ?? cur.collapse;
  const marker = collapse === "expanded" ? "???+" : collapse === "collapsed" ? "???" : "!!!";
  const titlePart = title !== null ? ` "${title}"` : "";
  const newLines = [`${indent}${marker} ${tokens.join(" ")}${titlePart}`, ...lines.slice(1)];
  return [{ start, end, text: newLines.join("\n") + "\n" }];
}

// ---------------------------------------------------------------------------
// Snippets (`--8<-- "file.md"`): the path is chosen through the VS Code dialog
// rather than typed from memory.
// ---------------------------------------------------------------------------

export function openSnippetInsert(): void {
  const at = host.insertPoint();
  const anchor = host.popupAnchor();
  const rect = anchor.getBoundingClientRect();
  const pop = showPopup(
    Math.max(8, rect.right + window.scrollX - 260),
    rect.bottom + window.scrollY + 4,
  );
  const form = document.createElement("form");
  const head = document.createElement("div");
  head.className = "vpop-title";
  head.textContent = t("File include");

  const label = document.createElement("label");
  label.textContent = t("File path");
  const row1 = document.createElement("div");
  row1.className = "vimg-src";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "includes/abbreviations.md";
  const browse = document.createElement("button");
  browse.type = "button";
  browse.className = "secondary";
  browse.textContent = t("Choose file…");
  browse.addEventListener("click", () => {
    void host.pickFile("snippet").then((rel) => {
      if (rel) {
        input.value = rel;
      }
    });
  });
  row1.append(input, browse);
  label.appendChild(row1);

  const help = document.createElement("div");
  help.className = "vpop-help";
  help.textContent =
    t("The file's content is inserted by MkDocs when the site is built.") +
    " " +
    t("The path is resolved from the project root (the mkdocs.yml folder).");

  form.append(head, label, help);
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
  ok.textContent = t("Insert");
  row.append(grow, cancel, ok);
  form.appendChild(row);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const path = input.value.trim();
    if (!path) {
      return;
    }
    closePopup();
    host.insertMarkdownBlock(`--8<-- "${path}"`, at);
  });
  pop.appendChild(form);
  pop.classList.add("vimg"); // the same path + button row layout
  input.focus();
}

// --- table: insertion (the grid picker) ---

export function openTableGrid(anchor: HTMLElement): void {
  // The insertion position is captured BEFORE opening the picker (from the cursor indent) — as for all
  // components: the table nests into the cursor's block (an admonition/tab body and so on).
  const at = host.insertPoint();
  const rect = anchor.getBoundingClientRect();
  const pop = showPopup(rect.left + window.scrollX, rect.bottom + window.scrollY + 4);
  const label = document.createElement("div");
  label.className = "vgrid-label";
  label.textContent = t("Table size");
  const grid = document.createElement("div");
  grid.className = "vgrid";
  const cells: HTMLElement[] = [];
  const COLS = 8;
  const ROWS = 6;
  for (let r = 1; r <= ROWS; r++) {
    for (let c = 1; c <= COLS; c++) {
      const s = document.createElement("span");
      s.dataset.r = String(r);
      s.dataset.c = String(c);
      s.addEventListener("mouseenter", () => {
        for (const cell of cells) {
          const cr = Number(cell.dataset.r);
          const cc = Number(cell.dataset.c);
          cell.classList.toggle("on", cr <= r && cc <= c);
        }
        label.textContent = `${c} × ${r}`;
      });
      s.addEventListener("click", () => {
        closePopup();
        host.insertMarkdownBlock(tableMarkdown(r, c), at);
        setAfterSync(() => focusFirstTableCellAt(at.line));
      });
      grid.appendChild(s);
      cells.push(s);
    }
  }
  pop.append(label, grid);
}

/** The Markdown of a rows×cols table (headers + empty cells). */
export function tableMarkdown(rows: number, cols: number): string {
  const cells = (fn: (c: number) => string): string =>
    "| " + Array.from({ length: cols }, (_v, c) => fn(c)).join(" | ") + " |";
  const header = cells((c) => t("Heading {0}", c + 1));
  const sep = cells(() => "---");
  // The width the serializer gives an empty cell: any other and the first edit
  // to the table would repad every cell the author never touched.
  const bodyRow = cells(() => EMPTY_CELL);
  const body = Array.from({ length: rows }, () => bodyRow).join("\n");
  return `${header}\n${sep}\n${body}`;
}

/** Places the cursor into the first cell of the table that was just inserted. */
function focusFirstTableCellAt(anchorLine: number): void {
  const tables = Array.from(doc().querySelectorAll<HTMLElement>("table[data-src-line]"));
  let best: HTMLElement | null = null;
  for (const t of tables) {
    const line = Number(t.getAttribute("data-src-line"));
    if (line >= anchorLine && (!best || line < Number(best.getAttribute("data-src-line")))) {
      best = t;
    }
  }
  const cell = best?.querySelector<HTMLElement>("th, td");
  if (cell) {
    host.caretInto(cell);
  }
}
