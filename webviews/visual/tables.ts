// Tables in the visual editor.
//
// A table is a block of ordinary text cells, so most of the editing is the
// browser's. What is not: the floating menu of row and column operations that
// appears above the table the caret is in, Tab walking from cell to cell, and
// Tab in the last cell — which adds a row by writing a line into the file and
// waits for the render to put the caret in it.

import { dirty, doc, docLines, rangeOf, scheduleSync, setAfterSync } from "./editorCore";
import { t } from "../shared/i18n";

/** What the table operations need from the editor around them. */
export interface TablesHost {
  /** Puts the caret into an element — at its end when asked. */
  placeCaret(el: Element, atEnd?: boolean): void;
  /** The same for a block that still needs its own preparation before the caret lands. */
  caretIntoBlock(block: HTMLElement): void;
  /** The outermost block a node belongs to: a nested table marks its parent dirty. */
  topBlockOf(node: Node | null): Element | null;
  /** The nearest ancestor that owns a range of lines in the file. */
  rangedAncestor(el: Element | null): HTMLElement | null;
  /** The indent of a line of the file, so a new row lines up with the table. */
  indentOfLine(line: number): string;
  /** Replaces a range of lines and leaves the caret on one of them. */
  replaceLines(start: number, end: number, lines: string[], caretLine?: number): void;
}

let host: TablesHost;

export function initTables(next: TablesHost): void {
  host = next;
}

/** The operation icons (16×16, currentColor): a target bar + an arrow/cross. */
const TBL_ICONS: Record<string, string> = (() => {
  const svg = (body: string): string =>
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return {
    rowAbove: svg(
      '<rect x="2" y="7.5" width="12" height="6.5" rx="1"/><path d="M2 10.75h12"/><path d="M8 5V1.5M6 3.2 8 1.2l2 2"/>',
    ),
    rowBelow: svg(
      '<rect x="2" y="2" width="12" height="6.5" rx="1"/><path d="M2 5.25h12"/><path d="M8 11v3.5M6 12.8l2 2 2-2"/>',
    ),
    colLeft: svg(
      '<rect x="7.5" y="2" width="6.5" height="12" rx="1"/><path d="M10.75 2v12"/><path d="M5 8H1.5M3.2 6 1.2 8l2 2"/>',
    ),
    colRight: svg(
      '<rect x="2" y="2" width="6.5" height="12" rx="1"/><path d="M5.25 2v12"/><path d="M11 8h3.5M12.8 6l2 2-2 2"/>',
    ),
    delRow: svg(
      '<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M6.2 6.2l3.6 3.6M9.8 6.2l-3.6 3.6" stroke-width="1.2"/>',
    ),
    delCol: svg(
      '<rect x="5" y="2" width="6" height="12" rx="1"/><path d="M6.2 6.2l3.6 3.6M9.8 6.2l-3.6 3.6" stroke-width="1.2"/>',
    ),
    alignLeft: svg('<path d="M2 3h12M2 6.5h7M2 10h12M2 13.5h7"/>'),
    alignCenter: svg('<path d="M2 3h12M4.5 6.5h7M2 10h12M4.5 13.5h7"/>'),
    alignRight: svg('<path d="M2 3h12M7 6.5h7M2 10h12M7 13.5h7"/>'),
    delTable: '<span class="codicon codicon-trash"></span>',
  };
})();

let tableMenu: HTMLElement | null = null;
let tableMenuFor: HTMLTableElement | null = null;

export function updateTableMenu(): void {
  const cell = currentCell();
  const table = cell ? (cell.closest("table") as HTMLTableElement | null) : null;
  if (!table || !doc().contains(table)) {
    tableMenu?.remove();
    tableMenu = null;
    tableMenuFor = null;
    return;
  }
  if (tableMenu && tableMenuFor === table) {
    return;
  }
  tableMenu?.remove();
  const rect = table.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "vpop table-menu";
  menu.style.left = `${rect.left + window.scrollX}px`;
  menu.style.top = `${rect.top + window.scrollY}px`; // adjusted for the height below

  const btn = (icon: string, tip: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = icon;
    b.setAttribute("data-tip", tip); // the instant tooltip on hover
    b.addEventListener("mousedown", (e) => e.preventDefault()); // do not lose the cursor
    b.addEventListener("click", fn);
    menu.appendChild(b);
    return b;
  };
  const sep = (): void => {
    const s = document.createElement("div");
    s.className = "sep";
    menu.appendChild(s);
  };

  btn(TBL_ICONS.rowAbove, t("Insert a row above the current one"), () =>
    tableOp(table, "rowAbove"),
  );
  btn(TBL_ICONS.rowBelow, t("Insert a row below the current one"), () =>
    tableOp(table, "rowBelow"),
  );
  btn(TBL_ICONS.colLeft, t("Insert a column to the left of the current one"), () =>
    tableOp(table, "colLeft"),
  );
  btn(TBL_ICONS.colRight, t("Insert a column to the right of the current one"), () =>
    tableOp(table, "colRight"),
  );
  sep();
  btn(TBL_ICONS.delRow, t("Delete the current row"), () => tableOp(table, "delRow"));
  btn(TBL_ICONS.delCol, t("Delete the current column"), () => tableOp(table, "delCol"));
  sep();
  btn(TBL_ICONS.alignLeft, t("Align the column left"), () => tableOp(table, "alignLeft"));
  btn(TBL_ICONS.alignCenter, t("Align the column center"), () => tableOp(table, "alignCenter"));
  btn(TBL_ICONS.alignRight, t("Align the column right"), () => tableOp(table, "alignRight"));
  sep();
  btn(TBL_ICONS.delTable, t("Delete the whole table"), () => {
    // For a nested table the dirty parent has to be marked BEFORE the removal
    // (once detached, topBlockOf will no longer find it).
    const parent = host.topBlockOf(table);
    table.remove();
    if (parent && parent !== table && parent.isConnected) {
      dirty.add(parent);
    }
    scheduleSync();
  });

  document.body.appendChild(menu);
  // The menu sits entirely above the table (not on top of the header).
  menu.style.top = `${rect.top + window.scrollY - menu.offsetHeight - 6}px`;
  tableMenu = menu;
  tableMenuFor = table;
}

export function currentCell(): HTMLTableCellElement | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  let cur: Node | null = sel.anchorNode;
  while (cur && cur !== doc()) {
    if (cur instanceof HTMLTableCellElement) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

function tableOp(table: HTMLTableElement, op: string): void {
  const cell = currentCell();
  if (!cell) {
    return;
  }
  const tr = cell.parentElement as HTMLTableRowElement;
  const colIndex = Array.from(tr.children).indexOf(cell);
  const allRows = Array.from(table.querySelectorAll("tr"));

  const newCell = (header: boolean): HTMLTableCellElement => {
    const c = document.createElement(header ? "th" : "td");
    c.appendChild(document.createElement("br"));
    return c;
  };

  switch (op) {
    case "rowAbove":
    case "rowBelow": {
      if (tr.parentElement?.tagName === "THEAD" && op === "rowAbove") {
        return;
      }
      const row = document.createElement("tr");
      for (let i = 0; i < tr.children.length; i++) {
        row.appendChild(newCell(false));
      }
      const tbody = table.querySelector("tbody") ?? table;
      if (tr.parentElement?.tagName === "THEAD") {
        tbody.insertBefore(row, tbody.firstChild);
      } else {
        if (op === "rowAbove") {
          tr.before(row);
        } else {
          tr.after(row);
        }
      }
      host.placeCaret(row.children[colIndex] ?? row.children[0]);
      break;
    }
    case "colLeft":
    case "colRight": {
      const at = op === "colLeft" ? colIndex : colIndex + 1;
      for (const row of allRows) {
        const c = newCell(row.parentElement?.tagName === "THEAD");
        const ref = row.children[at] ?? null;
        row.insertBefore(c, ref);
      }
      break;
    }
    case "delRow": {
      if (tr.parentElement?.tagName === "THEAD") {
        return; // a GFM table requires the header row
      }
      const next = (tr.nextElementSibling ?? tr.previousElementSibling)?.children[colIndex];
      tr.remove();
      if (table.querySelectorAll("tbody tr").length === 0) {
        table.remove();
      } else if (next) {
        host.placeCaret(next);
      }
      break;
    }
    case "delCol": {
      if (tr.children.length <= 1) {
        table.remove();
        break;
      }
      for (const row of allRows) {
        row.children[colIndex]?.remove();
      }
      break;
    }
    case "alignLeft":
    case "alignCenter":
    case "alignRight": {
      const align = op === "alignLeft" ? "left" : op === "alignCenter" ? "center" : "right";
      for (const row of allRows) {
        const c = row.children[colIndex] as HTMLElement | undefined;
        c?.setAttribute("style", `text-align:${align}`);
      }
      break;
    }
  }
  if (table.isConnected) {
    dirty.add(table);
  }
  scheduleSync();
  tableMenu?.remove();
  tableMenu = null;
  tableMenuFor = null;
  updateTableMenu();
}

/**
 * A `<br>` into every empty rendered cell. The engine renders `|   |` as a bare
 * `<td></td>`, and a caret in a cell with no text line has nowhere to stand:
 * Chrome parks it visually on the cell's edge, seemingly between cells. The
 * serializer already strips a cell's trailing `<br>`s (see rowLine in
 * htmlToMd), so the round-trip is unchanged.
 */
export function padEmptyCells(root: Element): void {
  for (const cell of Array.from(root.querySelectorAll("td, th"))) {
    if (cell.childNodes.length === 0) {
      cell.appendChild(document.createElement("br"));
    }
  }
}

/**
 * A line break inside a table cell. `insertLineBreak` (a Blink command)
 * correctly places `<br>` and the caret on the new line without a trailing break —
 * inserting `<br>` by hand does not achieve this (the browser puts the caret before the trailing
 * `<br>`, and the input goes to the previous line).
 */
export function insertCellBreak(): void {
  document.execCommand("insertLineBreak");
}

export function moveCell(cell: HTMLTableCellElement, dir: 1 | -1): void {
  const table = cell.closest("table");
  if (!table) {
    return;
  }
  const cells = Array.from(table.querySelectorAll("th, td")) as HTMLTableCellElement[];
  const idx = cells.indexOf(cell);
  const next = cells[idx + dir];
  if (next) {
    host.placeCaret(next, true);
    return;
  }
  if (dir === 1) {
    // Tab in the last cell adds a new table row (by editing the file's lines).
    const ranged = host.rangedAncestor(table);
    if (!ranged) {
      return;
    }
    const { start, end } = rangeOf(ranged);
    const cols = cell.parentElement?.children.length ?? 1;
    const indent = host.indentOfLine(start);
    const src = docLines().slice(start, end);
    src.push(indent + "|" + " |".repeat(cols));
    host.replaceLines(start, end, src, end);
    setAfterSync(() => focusLastRowAt(start));
  }
}

/** Places the cursor into the first cell of the last row of the table starting at the line. */
function focusLastRowAt(startLine: number): void {
  const table = doc().querySelector<HTMLElement>(`table[data-src-line="${startLine}"]`);
  const rows = table?.querySelectorAll<HTMLElement>(":scope > tbody > tr");
  const cell = rows?.[rows.length - 1]?.querySelector<HTMLElement>("td, th");
  if (cell) {
    host.caretIntoBlock(cell);
  }
}
