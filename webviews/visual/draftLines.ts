// Where the author can still write.
//
// At the end of the document there is always a paragraph to type in. Inside a
// container — a tab, a grid card, a call-out, a quote — there is not: the
// container ends right below its last block, and if that block cannot take a
// caret (a diagram, a table, a grid, a line made of nothing but a button or key
// combinations) there is nowhere left to click.
//
// Two pieces answer that, both modelled on Notion:
//
//   the click zone — a strip of padding at the bottom of every container. A
//                    click there opens a new line and puts the caret in it.
//                    Nothing is added to the DOM before the click, and an empty
//                    paragraph serializes to nothing, so the file stays clean.
//   the hint       — “Keep writing…” shows in the ONE empty line the caret is
//                    in, not in every empty line there is. It says where typing
//                    will go, instead of decorating the page with grey text.
//
// A line opened that way is a loan, not a gift: it lives while the caret is in
// it. The caret leaves it empty — it goes away, and the container is the height
// it was before the click. Otherwise every stray click left a blank line behind.

/** Containers whose bottom edge cuts the author off from writing. */
const CONTAINERS = ".tabbed-block, .card, .admonition, blockquote, details";

/** The blocks of a container, without the editor's own controls. */
function contentBlocks(container: Element): Element[] {
  return Array.from(container.children).filter(
    (c) => !c.classList.contains("vgctl") && !c.classList.contains("isl-tools"),
  );
}

/**
 * The container whose bottom strip was clicked, if any. The click has to land
 * on the container ITSELF (its padding) and below everything inside it —
 * a click on a block, or between blocks, belongs to that block.
 */
export function containerBelowClick(target: Element | null, y: number): HTMLElement | null {
  const container = target?.closest<HTMLElement>(CONTAINERS);
  if (!container || target !== container) {
    return null;
  }
  const blocks = contentBlocks(container);
  const last = blocks[blocks.length - 1];
  if (last && y < last.getBoundingClientRect().bottom) {
    return null;
  }
  return container;
}

/**
 * Opens an empty line at the end of the container and hands it back for the
 * caret. An existing empty last line is reused — clicking twice must not leave
 * a column of blank paragraphs behind.
 */
export function openTrailingLine(container: HTMLElement): HTMLElement {
  const blocks = contentBlocks(container);
  const last = blocks[blocks.length - 1];
  if (
    last instanceof HTMLElement &&
    last.tagName === "P" &&
    (last.textContent ?? "").trim() === ""
  ) {
    return last;
  }
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  // Marked as ours: the caret leaving it empty takes it away again.
  p.setAttribute("data-vdraft", "");
  container.appendChild(p);
  return p;
}

/**
 * Takes the <br> out of a line that holds nothing else. The break is what gives
 * an empty paragraph its height, but left next to content that has just been
 * put in the line it serializes as a hard break — two trailing spaces in the
 * file the author never typed.
 */
export function dropPlaceholderBreak(node: Node | null): void {
  const holder = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!holder || (holder.textContent ?? "").trim() !== "" || holder.children.length !== 1) {
    return;
  }
  const only = holder.children[0];
  if (only.tagName === "BR") {
    only.remove();
  }
}

/**
 * Takes back the lines the click zone lent out. A line the caret has left
 * empty is removed; a line something was written in stops being a loan and
 * stays. Called whenever the caret moves and when the document loses focus.
 */
export function pruneDraftLines(docEl: HTMLElement, caretBlock: Element | null): void {
  for (const p of Array.from(docEl.querySelectorAll<HTMLElement>("p[data-vdraft]"))) {
    if ((p.textContent ?? "").trim() !== "") {
      p.removeAttribute("data-vdraft");
    } else if (p !== caretBlock) {
      p.remove();
    }
  }
}

/**
 * Moves the hint to the empty line the caret is in, and takes it off every
 * other line. Called whenever the caret moves: the hint belongs to the line
 * that is about to be written in, and to no other.
 */
export function updateDraftHint(
  docEl: HTMLElement,
  caretBlock: Element | null,
  placeholder: string,
): void {
  const wanted =
    caretBlock instanceof HTMLElement &&
    caretBlock.tagName === "P" &&
    (caretBlock.textContent ?? "").trim() === ""
      ? caretBlock
      : null;
  for (const p of Array.from(docEl.querySelectorAll<HTMLElement>("p[data-vph]"))) {
    if (p !== wanted) {
      p.removeAttribute("data-vph");
    }
  }
  if (wanted && wanted.getAttribute("data-vph") !== placeholder) {
    wanted.setAttribute("data-vph", placeholder);
  }
}
