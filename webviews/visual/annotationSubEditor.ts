// The editor over a single annotation.
//
// A note is edited as a document of its own: `#doc` is moved into a modal and
// filled with the note's body, so the whole toolbar works inside it — styles,
// components, even another annotation. The page underneath is frozen: the core
// keeps a snapshot of the file, the note's own text takes its place, and “Done”
// writes the result back as one edit of the list item.
//
// That substitution is the only one of its kind in the editor, and it is why
// this lives in a file of its own. Everything here has to survive being nested:
// the frames form a stack, each with its own snapshot, and closing one restores
// exactly the state the one below it had.

import {
  docLines,
  docVersion,
  fullText,
  mutedRemote,
  noteSyncSent,
  openLocalDoc,
  rangeOf,
  requestFullRender,
  restoreCore,
  runSyncNowThen,
  sendSync,
  setAfterSync,
  st,
  syncBusy,
  takeCoreSnapshot,
  type CoreSnapshot,
} from "./editorCore";
import { closePopup } from "./popups";
import { t } from "../shared/i18n";

/** What the sub-editor needs from the editor around it. */
export interface SubEditorHost {
  /** The document root — which, inside a note's editor, is the note. */
  readonly docEl: HTMLElement;
  /** Sends a message to the extension (rendering the note's fragment). */
  post(msg: unknown): void;
  /** The top-level blocks, in order. */
  blocksInOrder(): Element[];
  /** Puts the caret into a block. */
  caretIntoBlock(block: HTMLElement): void;
  /** Applies a render patch — used when the note's fragment comes back. */
  applyPatches(html: string, text: string, version: number): void;
  /**
   * Closes the read-only tip of a note. Passed in rather than imported: the
   * tips belong to annotations.ts, and importing back would make a cycle.
   */
  hideTip(): void;
}

let host: SubEditorHost;

export function initSubEditor(next: SubEditorHost): void {
  host = next;
}
// becomes the WHOLE document of the editor: the #doc element physically moves
// into a modal window, so every tool (styles, lists, tables, inserted blocks,
// undo) works exactly as it does at top level. While the editor is open,
// sendSync applies the edits to this local copy and asks the extension to
// render the fragment; the file is written once — by “Done”, which wraps the
// body back into the item and lands in the parent as a single edit (and a
// single undo step). “Cancel” restores the parent untouched. A nested
// annotation opens one more editor on top of the first the same way — its
// “parent document” is simply the outer note's body.
// ---------------------------------------------------------------------------

interface SubFrame {
  /** The parent document, frozen while the editor above it is open. */
  core: CoreSnapshot;
  html: string;
  scrollY: number;
  /** The note's lines in the parent, and the plumbing stripped from them. */
  start: number;
  end: number;
  marker: string;
  cont: string;
  /** This level's window and the static stand-in left where #doc was. */
  box: HTMLElement;
  ghost: HTMLElement;
}

const subStack: SubFrame[] = [];
let subRenderSeq = 0;
let subVeil: HTMLElement | null = null;

export function inSubEditor(): boolean {
  return subStack.length > 0;
}

export function requestSubRender(): void {
  noteSyncSent();
  host.post({ type: "renderSub", id: ++subRenderSeq, text: fullText() });
}

export function onSubRendered(id: number, html: string): void {
  if (!inSubEditor() || id !== subRenderSeq) {
    return; // a response for an editor that has already closed
  }
  host.applyPatches(html, fullText(), docVersion());
}

/** A fresh render of the current document — revives the decorations after a restore. */
function requestCurrentRender(): void {
  if (inSubEditor()) {
    requestSubRender();
    return;
  }
  noteSyncSent();
  host.post({ type: "sync", baseVersion: docVersion(), edits: [] });
}

function annotationLists(): HTMLElement[] {
  return Array.from(host.docEl.querySelectorAll<HTMLElement>("ol.annotation-list"));
}

/** Opens the note in its own editor window on top of the current document. */
export function openAnnotationModal(item: HTMLElement, selectAll = false): void {
  const list = item.closest<HTMLElement>("ol.annotation-list");
  if (!list) {
    return;
  }
  if (syncBusy()) {
    // Pending edits are about to move the line numbers — flush them first and
    // find the note again by indices, which survive the re-render.
    const listIdx = annotationLists().indexOf(list);
    const itemIdx = Array.from(list.querySelectorAll<HTMLElement>(":scope > li")).indexOf(item);
    if (listIdx < 0 || itemIdx < 0) {
      return;
    }
    runSyncNowThen(() => {
      const again =
        annotationLists()[listIdx]?.querySelectorAll<HTMLElement>(":scope > li")[itemIdx];
      if (again) {
        openAnnotationModal(again, selectAll);
      }
    });
    return;
  }
  if (!item.hasAttribute("data-src-line")) {
    return;
  }
  const number = Array.from(list.querySelectorAll<HTMLElement>(":scope > li")).indexOf(item) + 1;
  const { start, end } = rangeOf(item);
  const src = docLines().slice(start, end);
  const marker = /^\s*(\d+[.)]|[-*+])\s+/.exec(src[0] ?? "")?.[0];
  if (marker === undefined) {
    return;
  }
  // The continuation indent is whatever the file already uses (usually four
  // columns, which is wider than a `1. ` marker) — reusing it keeps untouched
  // lines byte-identical after “Done”. The SHALLOWEST continuation line sets
  // it: the first one may be nested deeper (a block inside the note's own
  // item), and dedenting by its indent would flatten the body's structure.
  const contLen = src.slice(1).reduce((min, l) => {
    if (l.trim() === "") {
      return min;
    }
    return Math.min(min, /^\s*/.exec(l)?.[0].length ?? 0);
  }, Number.POSITIVE_INFINITY);
  const cont = " ".repeat(Number.isFinite(contLen) ? contLen : marker.length);
  const body = [
    (src[0] ?? "").slice(marker.length),
    ...src.slice(1).map((l) => (l.startsWith(cont) ? l.slice(cont.length) : l.trimStart())),
  ];
  host.hideTip();
  closePopup();

  // The window: a caption with the note's number (the same as its `(n)`
  // marker), the Done/Cancel pair, and #doc itself as the body.
  const box = document.createElement("div");
  box.className = "vsub-box";
  const depth = subStack.length;
  box.style.zIndex = String(31 + depth * 2);
  box.style.top = `calc(9vh + ${depth * 6}vh)`;
  box.style.left = `calc(50% - min(360px, 46vw) + ${depth * 26}px)`;
  const head = document.createElement("div");
  head.className = "vsub-head";
  const title = document.createElement("span");
  title.className = "vsub-title";
  title.textContent = t("Annotation {0}", String(number));
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("Cancel");
  cancel.addEventListener("mousedown", (e) => e.preventDefault());
  cancel.addEventListener("click", () => closeSubEditor(false));
  const done = document.createElement("button");
  done.type = "button";
  done.className = "vsub-done";
  done.textContent = t("Done");
  done.addEventListener("mousedown", (e) => e.preventDefault());
  done.addEventListener("click", () => closeSubEditor(true));
  head.append(title, cancel, done);
  const bodyEl = document.createElement("div");
  bodyEl.className = "vsub-body";
  box.append(head, bodyEl);

  // The page behind the veil keeps a static copy (its root keeps id="doc" so
  // the styles apply; nothing looks it up by id at runtime); the editor itself
  // moves into the window with all its listeners and observers.
  const ghost = host.docEl.cloneNode(true) as HTMLElement;
  ghost.setAttribute("contenteditable", "false");
  // CRITICAL: the ghost duplicates every inner id (tab radios `__tabbed_N_M`,
  // footnote anchors, …). A duplicate id shadows the live editor's copy —
  // `getElementById`/`label[for=]` resolve to the ghost (earlier in the tree),
  // so a tab label in the window toggled the invisible ghost's radio and the
  // window's own tab never switched. Radio `name` grouping had the same reach.
  // The ghost is a non-interactive stand-in, so it needs neither.
  for (const el of ghost.querySelectorAll("[id]")) {
    el.removeAttribute("id");
  }
  for (const el of ghost.querySelectorAll("[name]")) {
    el.removeAttribute("name");
  }

  subStack.push({
    core: takeCoreSnapshot(),
    html: host.docEl.innerHTML,
    scrollY: window.scrollY,
    start,
    end,
    marker,
    cont,
    box,
    ghost,
  });
  host.docEl.replaceWith(ghost);
  bodyEl.appendChild(host.docEl);
  if (!subVeil) {
    subVeil = document.createElement("div");
    subVeil.className = "vsub-veil";
    subVeil.addEventListener("mousedown", (e) => {
      e.preventDefault();
      closeSubEditor(true);
    });
    document.body.appendChild(subVeil);
    // The class hides the block handle: its absolute positioning has nowhere
    // sensible to sit over a fixed, internally scrolled window.
    document.body.classList.add("vsub-modal");
  }
  document.body.appendChild(box);

  document.getSelection()?.removeAllRanges();
  mutedRemote(() => {
    host.docEl.innerHTML = "";
  });
  openLocalDoc(body.join("\n") + "\n");
  setAfterSync(() => {
    const first = host.blocksInOrder()[0] ?? host.docEl.firstElementChild;
    if (selectAll && first) {
      // A freshly inserted annotation carries a placeholder — typing replaces it.
      const range = document.createRange();
      range.selectNodeContents(first);
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      host.docEl.focus();
    } else if (first instanceof HTMLElement) {
      host.caretIntoBlock(first);
    }
  });
  requestSubRender();
  st.set(t("Editing the annotation: Done applies, Cancel discards"));
}

/** Puts the list plumbing back around the edited body. */
function wrapNoteBody(frame: SubFrame, body: string[]): string[] {
  const out = [...body];
  while (out.length > 0 && (out[out.length - 1] ?? "").trim() === "") {
    out.pop();
  }
  if (out.length === 0) {
    return [frame.marker.replace(/\s+$/, "")];
  }
  return out.map((l, i) =>
    i === 0 ? (frame.marker + l).replace(/\s+$/, "") : l.trim() === "" ? "" : frame.cont + l,
  );
}

/** Closes the top editor; commit=true lands the body in the parent, false discards it. */
export function closeSubEditor(commit: boolean): void {
  const frame = subStack[subStack.length - 1];
  if (!frame) {
    return;
  }
  if (commit && syncBusy()) {
    runSyncNowThen(() => closeSubEditor(true));
    return;
  }
  subStack.pop();
  subRenderSeq++; // in-flight fragment renders are stale from here on
  const body = docLines();
  restoreCore(frame.core);
  document.getSelection()?.removeAllRanges();
  frame.ghost.replaceWith(host.docEl);
  mutedRemote(() => {
    host.docEl.innerHTML = frame.html;
  });
  frame.box.remove();
  if (subStack.length === 0 && subVeil) {
    subVeil.remove();
    subVeil = null;
    document.body.classList.remove("vsub-modal");
  }
  window.scrollTo(0, frame.scrollY);
  const wrapped = commit ? wrapNoteBody(frame, body) : null;
  if (wrapped && wrapped.join("\n") !== docLines().slice(frame.start, frame.end).join("\n")) {
    // One edit into the parent — the file, or the outer editor's copy.
    requestFullRender();
    sendSync([{ start: frame.start, end: frame.end, text: wrapped.join("\n") + "\n" }]);
  } else {
    // Nothing to write, but the restored snapshot holds dead listeners — ask
    // for a fresh render of the parent to revive the decorations.
    requestCurrentRender();
  }
}

/**
 * Folds every window stacked above `box` (down to and including making `box`
 * the top), committing each like “Done”. A pending render defers a close, so
 * the levels are peeled one render at a time rather than in a tight loop.
 */
function foldSubEditorsTo(box: HTMLElement): void {
  const depth = subStack.findIndex((f) => f.box === box);
  if (depth < 0 || subStack.length <= depth + 1) {
    return; // `box` is gone or already the top — nothing above it
  }
  closeSubEditor(true);
  if (subStack.length > depth + 1) {
    // The close either popped (a render is now pending) or deferred on one —
    // either way, continue once it settles.
    runSyncNowThen(() => foldSubEditorsTo(box));
  }
}

// A mousedown on a lower window in the stack folds the ones above it, the way
// clicking a shallower tip closes the deeper tips. The top window is where the
// editing happens, so clicks there are left alone; the veil runs its own close.
document.addEventListener("mousedown", (e) => {
  if (subStack.length < 2) {
    return;
  }
  const target = e.target;
  if (!(target instanceof Node)) {
    return;
  }
  if (subStack[subStack.length - 1].box.contains(target)) {
    return;
  }
  for (let i = subStack.length - 2; i >= 0; i--) {
    if (subStack[i].box.contains(target)) {
      e.preventDefault();
      foldSubEditorsTo(subStack[i].box);
      return;
    }
  }
});

/** The tip's “Edit”: item idx (1-based) of the given list. */
