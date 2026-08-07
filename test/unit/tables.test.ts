// @vitest-environment happy-dom
//
// The table operations of the visual editor. Most of a table is ordinary text
// and belongs to the browser; what belongs here is the floating menu — rows and
// columns, alignment, deletion — and Tab walking the cells, which in the last
// cell writes a new row into the file itself.
//
// The menu is driven the way a user drives it: the caret goes into a cell, the
// menu is built, and a button is clicked.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Tables = typeof import("../../webviews/visual/tables");
type Core = typeof import("../../webviews/visual/editorCore");

interface Harness {
  tables: Tables;
  core: Core;
  docEl: HTMLElement;
  /** Lines the table operations wrote back to the file. */
  written: { start: number; end: number; lines: string[]; caretLine?: number }[];
  /** Where the operations asked to put the caret. */
  caretAt: Element[];
}

async function fresh(): Promise<Harness> {
  vi.resetModules();
  document.body.innerHTML = "";
  const docEl = document.createElement("div");
  docEl.id = "doc";
  const statusEl = document.createElement("span");
  document.body.append(docEl, statusEl);

  const written: Harness["written"] = [];
  const caretAt: Element[] = [];
  const core: Core = await import("../../webviews/visual/editorCore");
  core.initCore({
    docEl,
    statusEl,
    post: () => {},
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    caretInBlock: () => false,
    inSub: () => false,
    renderSub: () => {},
  });
  const tables: Tables = await import("../../webviews/visual/tables");
  tables.initTables({
    placeCaret: (el) => caretAt.push(el),
    caretIntoBlock: (block) => caretAt.push(block),
    topBlockOf: (node) => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest("#doc > *") ?? null;
    },
    rangedAncestor: (el) => el?.closest<HTMLElement>("[data-src-line]") ?? null,
    indentOfLine: () => "",
    replaceLines: (start, end, lines, caretLine) => written.push({ start, end, lines, caretLine }),
  });
  return { tables, core, docEl, written, caretAt };
}

/** A three-column table with a header and two body rows, as the engine renders it. */
const TABLE_HTML = `<table data-src-line="0" data-src-end="4">
  <thead><tr><th>a</th><th>b</th><th>c</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>2</td><td>3</td></tr>
    <tr><td>4</td><td>5</td><td>6</td></tr>
  </tbody>
</table>`;

const TABLE_SRC = ["| a | b | c |", "| - | - | - |", "| 1 | 2 | 3 |", "| 4 | 5 | 6 |"];

/** Puts the caret inside a cell, which is what the menu reads. */
function caretInto(cell: Element): void {
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Clicks a menu button by its tooltip. */
function clickMenu(tip: string): void {
  const btn = document.querySelector<HTMLElement>(`.table-menu [data-tip="${tip}"]`);
  if (!btn) {
    throw new Error(`no button “${tip}” in the menu`);
  }
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The body rows as arrays of cell text. */
function bodyRows(table: Element): string[][] {
  return Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.children).map((c) => (c.textContent ?? "").trim()),
  );
}

describe("finding the cell the caret is in", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h.docEl.innerHTML = TABLE_HTML;
  });

  it("returns the cell the selection sits in", () => {
    const cell = h.docEl.querySelectorAll("td")[1];
    caretInto(cell);
    expect(h.tables.currentCell()).toBe(cell);
  });

  it("returns nothing when the caret is outside a table", () => {
    const p = document.createElement("p");
    p.textContent = "plain paragraph";
    h.docEl.appendChild(p);
    caretInto(p);
    expect(h.tables.currentCell()).toBe(null);
  });
});

describe("the floating menu", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await fresh();
    h.docEl.innerHTML = TABLE_HTML;
  });

  it("appears for the table the caret is in and goes away when it leaves", () => {
    caretInto(h.docEl.querySelector("td")!);
    h.tables.updateTableMenu();
    expect(document.querySelector(".table-menu")).not.toBe(null);

    const p = document.createElement("p");
    h.docEl.appendChild(p);
    caretInto(p);
    h.tables.updateTableMenu();
    expect(document.querySelector(".table-menu")).toBe(null);
  });

  it("is not rebuilt while the caret stays in the same table", () => {
    caretInto(h.docEl.querySelectorAll("td")[0]);
    h.tables.updateTableMenu();
    const first = document.querySelector(".table-menu");
    caretInto(h.docEl.querySelectorAll("td")[3]);
    h.tables.updateTableMenu();
    expect(document.querySelector(".table-menu")).toBe(first);
  });
});

describe("rows and columns", () => {
  let h: Harness;
  let table: HTMLElement;
  beforeEach(async () => {
    h = await fresh();
    h.core.adoptText(TABLE_SRC.join("\n") + "\n", 1);
    h.docEl.innerHTML = TABLE_HTML;
    table = h.docEl.querySelector("table")!;
  });

  /** Puts the caret into a body cell and opens the menu over it. */
  function withCaretIn(row: number, col: number): void {
    const tr = table.querySelectorAll("tbody tr")[row];
    caretInto(tr.children[col]);
    h.tables.updateTableMenu();
  }

  it("adds a row below, with as many cells as the table has columns", () => {
    withCaretIn(0, 1);
    clickMenu("Insert a row below the current one");
    expect(bodyRows(table)).toEqual([
      ["1", "2", "3"],
      ["", "", ""],
      ["4", "5", "6"],
    ]);
    expect(h.core.dirty.has(table)).toBe(true);
  });

  it("adds a row above the current one", () => {
    withCaretIn(1, 0);
    clickMenu("Insert a row above the current one");
    expect(bodyRows(table)).toEqual([
      ["1", "2", "3"],
      ["", "", ""],
      ["4", "5", "6"],
    ]);
  });

  it("a row added from the header row lands at the top of the body", () => {
    caretInto(table.querySelectorAll("th")[0]);
    h.tables.updateTableMenu();
    clickMenu("Insert a row below the current one");
    expect(bodyRows(table)[0]).toEqual(["", "", ""]);
  });

  it("adds a column to the right, keeping the header cells headers", () => {
    withCaretIn(0, 0);
    clickMenu("Insert a column to the right of the current one");
    expect(bodyRows(table)).toEqual([
      ["1", "", "2", "3"],
      ["4", "", "5", "6"],
    ]);
    // A GFM table's first row is its header: a `td` there would break the round trip.
    expect(table.querySelectorAll("thead th")).toHaveLength(4);
    expect(table.querySelectorAll("thead td")).toHaveLength(0);
  });

  it("adds a column to the left", () => {
    withCaretIn(0, 2);
    clickMenu("Insert a column to the left of the current one");
    expect(bodyRows(table)[0]).toEqual(["1", "2", "", "3"]);
  });

  it("deletes a row", () => {
    withCaretIn(0, 0);
    clickMenu("Delete the current row");
    expect(bodyRows(table)).toEqual([["4", "5", "6"]]);
  });

  it("refuses to delete the header row — GFM has no table without one", () => {
    caretInto(table.querySelectorAll("th")[1]);
    h.tables.updateTableMenu();
    clickMenu("Delete the current row");
    expect(table.querySelectorAll("thead tr")).toHaveLength(1);
    expect(bodyRows(table)).toHaveLength(2);
  });

  it("deleting the last body row takes the whole table with it", () => {
    withCaretIn(0, 0);
    clickMenu("Delete the current row");
    withCaretIn(0, 0);
    clickMenu("Delete the current row");
    expect(h.docEl.querySelector("table")).toBe(null);
  });

  it("deletes a column", () => {
    withCaretIn(0, 1);
    clickMenu("Delete the current column");
    expect(bodyRows(table)).toEqual([
      ["1", "3"],
      ["4", "6"],
    ]);
    expect(table.querySelectorAll("thead th")).toHaveLength(2);
  });

  it("deleting the only column takes the whole table with it", () => {
    h.docEl.innerHTML = `<table data-src-line="0" data-src-end="3">
      <thead><tr><th>a</th></tr></thead>
      <tbody><tr><td>1</td></tr></tbody>
    </table>`;
    const only = h.docEl.querySelector("table")!;
    caretInto(only.querySelector("td")!);
    h.tables.updateTableMenu();
    clickMenu("Delete the current column");
    expect(h.docEl.querySelector("table")).toBe(null);
  });

  it("alignment is set on the whole column, header included", () => {
    withCaretIn(0, 1);
    clickMenu("Align the column center");
    const second = Array.from(table.querySelectorAll("tr")).map(
      (tr) => tr.children[1].getAttribute("style") ?? "",
    );
    expect(second).toEqual(["text-align:center", "text-align:center", "text-align:center"]);
  });

  it("deleting the table marks the block around a nested one changed", () => {
    // A table inside an admonition has no range of its own: the block that owns
    // the lines is the admonition, and it has to be marked before the removal —
    // once detached, nothing leads from the table back to it.
    h.docEl.innerHTML = `<div class="admonition" data-src-line="0" data-src-end="6"><p>note</p><table>
      <thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></div>`;
    const box = h.docEl.firstElementChild!;
    caretInto(box.querySelector("td")!);
    h.tables.updateTableMenu();
    clickMenu("Delete the whole table");
    expect(box.querySelector("table")).toBe(null);
    expect(h.core.dirty.has(box)).toBe(true);
  });
});

describe("Tab walking the cells", () => {
  let h: Harness;
  let table: HTMLElement;
  beforeEach(async () => {
    h = await fresh();
    h.core.adoptText(TABLE_SRC.join("\n") + "\n", 1);
    h.docEl.innerHTML = TABLE_HTML;
    table = h.docEl.querySelector("table")!;
  });

  it("moves to the next cell", () => {
    const cells = table.querySelectorAll("td");
    h.tables.moveCell(cells[0] as HTMLTableCellElement, 1);
    expect(h.caretAt).toEqual([cells[1]]);
    expect(h.written).toHaveLength(0);
  });

  it("moves back, and from the first body cell into the header", () => {
    const first = table.querySelector("td") as HTMLTableCellElement;
    h.tables.moveCell(first, -1);
    expect(h.caretAt).toEqual([table.querySelectorAll("th")[2]]);
  });

  it("stops at the very first cell instead of writing anything", () => {
    const firstHeader = table.querySelector("th") as HTMLTableCellElement;
    h.tables.moveCell(firstHeader, -1);
    expect(h.caretAt).toHaveLength(0);
    expect(h.written).toHaveLength(0);
  });

  it("Tab in the last cell writes a new row into the file", () => {
    const cells = table.querySelectorAll("td");
    h.tables.moveCell(cells[cells.length - 1] as HTMLTableCellElement, 1);
    expect(h.written).toHaveLength(1);
    const [edit] = h.written;
    expect(edit.start).toBe(0);
    expect(edit.end).toBe(4);
    // The row is the table's own source plus one line of empty cells.
    expect(edit.lines).toEqual([...TABLE_SRC, "| | | |"]);
    // The caret is asked for after the render: the row does not exist yet.
    expect(edit.caretLine).toBe(4);
  });
});
