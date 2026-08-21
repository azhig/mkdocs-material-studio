// The document the editor writes to, and the protocol that keeps it in step
// with the file.
//
// Everything the editor does eventually comes back here: the text as lines, the
// set of blocks the user has touched, the batch that goes to the extension, the
// history that undoes it, and the flags that tell a programmatic mutation from a
// keystroke. It used to be spread through the middle of a ten-thousand-line
// module together with tables, annotations and the toolbar, so any feature that
// needed to write a line had to reach into that state directly — and every
// attempt to move a feature out dragged the whole file with it.
//
// The arithmetic of a batch lives in syncModel.ts and knows nothing of the DOM;
// this module is the part that does: it reads the blocks, applies what the plan
// decided, and talks to the extension. What it does NOT do is draw — rendering
// stays with the editor, which calls in here at the points marked below.

import { serializeTopBlock, UnsupportedBlockError } from "./htmlToMd";
import { hasActivePopup } from "./popups";
import {
  deleteEdit as planDeleteEdit,
  dropDuplicateRanges,
  invertEdits as planInvertEdits,
  planEdits,
  type BlockView,
  type SyncEdit,
} from "./syncModel";

/** What the core needs from the editor around it. */
export interface CoreHost {
  /** The editable document. */
  docEl: HTMLElement;
  /** The status line in the toolbar. */
  statusEl: HTMLElement;
  /** Sends a message to the extension. */
  post(msg: unknown): void;
  /** The top-level block a node belongs to. */
  topBlockOf(node: Node | null): Element | null;
  /** Whether the caret sits inside a block right now. */
  caretInBlock(): boolean;
  /** Whether an annotation editor is open: its document is a copy, not the file. */
  inSub(): boolean;
  /** Asks the extension to render that copy. */
  renderSub(): void;
  /** The diagnostic trace: what is about to be sent (mkdocsStudio.diagnostics). */
  traceEdits?(edits: SyncEdit[]): void;
}

let host: CoreHost;
let docEl: HTMLElement;

// --- The document ----------------------------------------------------------

let fullLines: string[] = []; // content lines (without the trailing empty one from \n)
let endsNL = true; // the document ends with a newline
let version = -1;

// --- What is going on right now --------------------------------------------

let applyingRemote = false; // a render/patch is being applied — mutations are ignored
let syncInFlight = false;
let syncQueued = false;
let needCatchUp = false; // a block skipped during a patch is waiting for blur
// Render the next “synced” in full (instead of patching while preserving the
// focus block): needed for nested insertion — the new block appears INSIDE the
// focus block, the number of top-level blocks does not change, and a regular
// applyPatches would have kept the old DOM without it.
let forceFullRenderOnce = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let afterSyncOnce: (() => void) | undefined;

/** Blocks the user has changed since the last batch. */
export const dirty = new Set<Element>();

/** The status line. */
export const st = {
  set(text: string): void {
    host.statusEl.textContent = text;
  },
};

/** Starts watching the document. Call once, before the first message arrives. */
export function initCore(next: CoreHost): void {
  host = next;
  docEl = next.docEl;
  observer.observe(docEl, { childList: true, characterData: true, subtree: true });
  removalObserver.observe(docEl, { childList: true });
  // Checkboxes change a property, not an attribute — MutationObserver does not see them.
  docEl.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLInputElement &&
      target.classList.contains("task-list-item-checkbox")
    ) {
      markDirty(target);
    }
  });
}

/** The editable document. */
export function doc(): HTMLElement {
  return docEl;
}

/** The top-level block a node belongs to. */
export function blockOf(node: Node | null): Element | null {
  return host.topBlockOf(node);
}

export function docLines(): string[] {
  return fullLines;
}

export function docEndsNL(): boolean {
  return endsNL;
}

export function docVersion(): number {
  return version;
}

export function fullText(): string {
  return fullLines.length === 0 ? "" : fullLines.join("\n") + (endsNL ? "\n" : "");
}

function setFullText(text: string): void {
  endsNL = text === "" || text.endsWith("\n");
  fullLines = text.split("\n");
  if (endsNL && fullLines.length > 0) {
    fullLines.pop();
  }
}

/** The file as the extension now has it: what a render and a patch both bring. */
export function adoptText(text: string, ver: number): void {
  setFullText(text);
  version = ver;
}

/** The block's range taken from its attributes. */
export function rangeOf(el: Element): { start: number; end: number } {
  const start = Number(el.getAttribute("data-src-line"));
  const end = Number(el.getAttribute("data-src-end") ?? start + 1);
  return { start, end };
}

/** Deletes a block, absorbing the following blank separator line. */
export function deleteEdit(start: number, end: number): SyncEdit {
  return planDeleteEdit(start, end, fullLines);
}

/** The footnotes service tail — generated by the engine, it is not in the file. */
export function isFootnoteService(el: Element): boolean {
  return el.classList.contains("footnotes-sep") || el.classList.contains("footnotes");
}

// ---------------------------------------------------------------------------
// Edit tracking
// ---------------------------------------------------------------------------

const observer = new MutationObserver((mutations) => {
  if (applyingRemote) {
    return;
  }
  // Did the batch contain a USER edit (inside the editable area, or a
  // structural change at the top level)? The asynchronous re-render of islands
  // (mermaid SVG, code highlighting) runs outside the muting and mutates #doc, but that is NOT
  // a user edit — a sync must not be scheduled for it, otherwise a
  // self-sustaining loop appears (every applyPatches re-renders mermaid →
  // mutation → sync → applyPatches → …). Such mutations inside contenteditable=false
  // are skipped and are NOT treated as a reason to synchronize.
  let sawUserMutation = false;
  for (const m of mutations) {
    const target = m.type === "characterData" ? m.target.parentNode : m.target;
    if (!target || target === docEl) {
      // Changes to the top-level composition are handled by the edit collection
      // (drafts → insert) and by removalObserver (deletions).
      sawUserMutation = true;
      continue;
    }
    const block = host.topBlockOf(target);
    if (block) {
      if (block.classList.contains("vlive")) {
        continue; // live editors synchronize themselves
      }
      // Only mutations inside the editable area count as an edit. The nearest
      // contenteditable=false boundary around the mutation → this is the inside of an “island”
      // (mermaid SVG, code highlighting, service buttons) — programmatic, skip it.
      // The nearest =true boundary → user input (including inside a tab/code body
      // NESTED in an admonition, where block is the admonition itself, not the island).
      const node = target instanceof Element ? target : target.parentElement;
      const editHost = node?.closest<HTMLElement>("[contenteditable]");
      if (editHost && editHost.getAttribute("contenteditable") === "false") {
        continue;
      }
      dirty.add(block);
      sawUserMutation = true;
    }
  }
  if (!sawUserMutation) {
    return; // only a programmatic re-render of islands — do not synchronize
  }
  if (dirty.size > 0 || removedKnown.length > 0 || hasDraftContent()) {
    scheduleSync();
  }
});

// Direct block removal (via MutationObserver removedNodes) — a block could have
// disappeared from the DOM without landing in dirty. A separate pass: watching removed.
const removedKnown: { start: number; end: number }[] = [];
const removalObserver = new MutationObserver((mutations) => {
  if (applyingRemote) {
    return;
  }
  let changed = false;
  for (const m of mutations) {
    if (m.target !== docEl) {
      continue;
    }
    for (const n of Array.from(m.removedNodes)) {
      if (n instanceof Element && n.hasAttribute("data-src-line") && !n.isConnected) {
        removedKnown.push(rangeOf(n));
        changed = true;
      }
    }
  }
  if (changed) {
    scheduleSync();
  }
});

/**
 * Performs programmatic DOM mutations in a way that keeps the observers from
 * mistaking them for a user edit. IMPORTANT: MutationObserver delivers records
 * asynchronously, so on completion the queue is flushed synchronously
 * (takeRecords), otherwise the applyingRemote flag would already be cleared by
 * the time delivery happens.
 */
let muteDepth = 0;
export function mutedRemote(fn: () => void): void {
  muteDepth++;
  applyingRemote = true;
  try {
    fn();
  } finally {
    muteDepth--;
    if (muteDepth === 0) {
      observer.takeRecords();
      removalObserver.takeRecords();
      applyingRemote = false;
    }
  }
}

/** Whether there are drafts with content (new blocks not yet in the file). */
function hasDraftContent(): boolean {
  for (const el of Array.from(docEl.children)) {
    if (isFootnoteService(el)) {
      continue;
    }
    if (!el.hasAttribute("data-src-line") && !el.classList.contains("vlive")) {
      if ((el.textContent ?? "").trim() !== "") {
        return true;
      }
    }
  }
  return false;
}

export function markDirty(node: Node): void {
  const block = host.topBlockOf(node);
  if (block) {
    dirty.add(block);
    scheduleSync();
  }
}

export function scheduleSync(delay = 350): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    runSync();
  }, delay);
}

// ---------------------------------------------------------------------------
// File-level undo/redo: every batch that is sent pushes its own inverse onto the
// stack (valid for a LIFO rollback). It works both for typing and for
// programmatic operations (tables, block insertions) that the browser's
// undo stack does not see.
// ---------------------------------------------------------------------------

const undoStack: SyncEdit[][] = [];
const redoStack: SyncEdit[][] = [];

/** Actions waiting for the answer to the batch in flight, oldest first. */
const queuedBuilds: Array<() => SyncEdit[] | undefined> = [];

/**
 * Sends a batch built by an interface action — a call-out changing type, a code
 * block changing language — and waits its turn if one is already in flight.
 *
 * Such a batch carries the version the editor last heard about. A second click
 * made while the first answer is still travelling used to send the OLD version,
 * the extension refused the whole batch as stale, and the click was simply lost:
 * the type came back to what the first click had set. That is why the batch is
 * BUILT here rather than passed in — by the time it is built, the answer to the
 * previous one has arrived and both the version and the line numbers are the
 * ones the file actually has.
 */
export function sendBuiltSync(build: () => SyncEdit[] | undefined): void {
  if (syncInFlight) {
    queuedBuilds.push(build);
    return;
  }
  const edits = build();
  if (edits && edits.length > 0) {
    sendSync(edits);
  }
}

/** The single point that sends a batch: it writes the inverse into the history. */
export function sendSync(edits: SyncEdit[], history: "push" | "undo" | "redo" = "push"): void {
  if (edits.length === 0) {
    return;
  }
  const inverse = planInvertEdits(edits, fullLines);
  if (history === "push") {
    undoStack.push(inverse);
    redoStack.length = 0;
  } else if (history === "undo") {
    redoStack.push(inverse);
  } else {
    undoStack.push(inverse);
  }
  if (undoStack.length > 200) {
    undoStack.shift();
  }
  if (host.inSub()) {
    // The annotation editor's document is a local copy of the note: the edits
    // land in it here, and the extension only renders the result. The file is
    // touched once — by “Done”.
    applyEditsLocally(edits);
    host.renderSub();
    return;
  }
  noteSyncSent();
  host.traceEdits?.(edits);
  host.post({ type: "sync", baseVersion: version, edits });
}

/** The sub-editor's counterpart of the provider: applies a batch to the local copy. */
function applyEditsLocally(edits: SyncEdit[]): void {
  // Bottom-up, so earlier edits do not move the later ones' lines.
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (const e of sorted) {
    const lines = e.text === "" ? [] : e.text.replace(/\n$/, "").split("\n");
    fullLines.splice(e.start, e.end - e.start, ...lines);
  }
}

export function undoOnce(): void {
  if (syncBusy()) {
    // The current edit lands first — undo is then applied to a consistent text.
    runSyncNowThen(() => undoOnce());
    return;
  }
  const batch = undoStack.pop();
  if (batch) {
    document.getSelection()?.removeAllRanges();
    sendSync(batch, "undo");
  }
}

export function redoOnce(): void {
  if (syncBusy()) {
    runSyncNowThen(() => redoOnce());
    return;
  }
  const batch = redoStack.pop();
  if (batch) {
    document.getSelection()?.removeAllRanges();
    sendSync(batch, "redo");
  }
}

export function runSyncNowThen(fn: () => void): void {
  afterSyncOnce = fn;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  if (!syncInFlight) {
    runSync();
    if (!syncInFlight) {
      // There turned out to be nothing to send — run it right away.
      const f = afterSyncOnce;
      afterSyncOnce = undefined;
      f?.();
    }
  }
}

// Markdown-first edits to source lines that no DOM block represents (footnote
// and abbreviation definitions). They ride in the same batch as the block
// edits, so a ref removed from a paragraph and its definition leave the file
// in one WorkspaceEdit — one undo step, no stale coordinates in between.
const pendingSourceEdits: SyncEdit[] = [];

export function queueSourceEdit(edit: SyncEdit): void {
  pendingSourceEdits.push(edit);
  scheduleSync(80);
}

/** Collects and sends a batch of edits based on the current DOM state. */
export function runSync(): void {
  if (syncInFlight) {
    syncQueued = true;
    return;
  }
  // buildEdits already carries the removals and the source-only edits: the plan
  // decides the whole batch in one place.
  const edits = buildEdits();
  if (edits.length === 0) {
    // The “catch-up” empty patch replaces the unfocused blocks. While a
    // popup editor (an annotation and the like) is open, this would break the reference
    // to the block that it holds — postpone until it closes.
    if (needCatchUp && !host.caretInBlock() && !hasActivePopup()) {
      needCatchUp = false;
      if (host.inSub()) {
        host.renderSub();
      } else {
        syncInFlight = true;
        host.traceEdits?.([]);
        host.post({ type: "sync", baseVersion: version, edits: [] });
      }
    }
    return;
  }
  sendSync(edits);
}

/**
 * The DOM state of the document in the shape the planner understands. Detached
 * blocks still marked dirty come along: they are the ones the user removed, and
 * nothing in the document leads to them any more.
 */
function blockViews(): { views: BlockView[]; nodes: Element[] } {
  const nodes = Array.from(docEl.children);
  for (const el of dirty) {
    if (!el.isConnected) {
      nodes.push(el);
    }
  }
  const views = nodes.map((el): BlockView => {
    const view: BlockView = {
      connected: el.isConnected,
      dirty: dirty.has(el),
      service: isFootnoteService(el),
      live: el.classList.contains("vlive"),
      pending: el.hasAttribute("data-pending"),
    };
    if (el.hasAttribute("data-src-line")) {
      view.range = rangeOf(el);
    }
    // Only what the plan may need: a changed block and a draft with content.
    const needsText = !view.service && !view.live && (view.dirty || (!view.range && !view.pending));
    if (needsText) {
      try {
        view.text = serializeTopBlock(el);
      } catch (err) {
        if (!(err instanceof UnsupportedBlockError)) {
          throw err;
        }
        // A block we cannot write back: the file keeps what it has.
        if (view.range) {
          console.warn("Block is not serializable, the edit was not sent:", err.message);
        }
      }
    }
    return view;
  });
  return { views, nodes };
}

/** Collects the batch and applies to the DOM what the plan decided. */
function buildEdits(): SyncEdit[] {
  const { views, nodes } = blockViews();
  // Two blocks claiming the same line: the later one loses its range here, so
  // the planner sees it as a draft.
  for (const i of dropDuplicateRanges(views)) {
    views[i].range = undefined;
    for (const name of ["data-src-line", "data-src-end", "data-block-type"]) {
      nodes[i].removeAttribute(name);
    }
  }
  const plan = planEdits({
    blocks: views,
    lines: fullLines,
    endsNL,
    removed: removedKnown.splice(0),
    sourceEdits: pendingSourceEdits.splice(0),
  });
  for (const i of plan.markPending) {
    // The mark puts the block into the positional matching of a patch — the
    // cursor is not lost on the first synchronization of a new paragraph.
    nodes[i].setAttribute("data-pending", "1");
  }
  for (const i of plan.dropRange) {
    // Erased content: the block leaves the file but stays in the DOM as a draft.
    for (const name of ["data-src-line", "data-src-end", "data-block-type"]) {
      nodes[i].removeAttribute(name);
    }
  }
  for (const i of plan.clearDirty) {
    dirty.delete(nodes[i]);
  }
  return plan.edits;
}

// ---------------------------------------------------------------------------
// The render protocol: what the editor tells the core around a render or a patch
// ---------------------------------------------------------------------------

/** A batch has left for the extension; the answer is a render or a patch. */
export function noteSyncSent(): void {
  syncInFlight = true;
}

/** The batch was refused (an external edit got there first). */
export function cancelSync(): void {
  syncInFlight = false;
  afterSyncOnce = undefined;
}

/** Whether a batch is on its way or being collected. */
export function syncBusy(): boolean {
  return syncInFlight || syncTimer !== undefined;
}

/** What to do once the answer to the current batch has been applied. */
export function setAfterSync(fn: (() => void) | undefined): void {
  afterSyncOnce = fn;
}

/**
 * The document is being replaced wholesale. Everything queued speaks in the
 * coordinates of the document going away: a deletion registered a moment ago
 * points at line 33 of the OLD text. Applied after the render it would cut line
 * 33 of the NEW one — some other block entirely. The queue dies with the
 * document it belongs to.
 */
export function clearForRender(): void {
  dirty.clear();
  removedKnown.length = 0;
  pendingSourceEdits.length = 0;
  // A full render brings the real thing anyway, and the block this pointed at
  // is about to be thrown away.
  inlineRefresh = null;
}

/** The answer has been applied: release the batch and run what was waiting for it. */
export function finishRemote(): void {
  syncInFlight = false;
  if (syncQueued) {
    syncQueued = false;
    scheduleSync();
  }
  const after = afterSyncOnce;
  afterSyncOnce = undefined;
  after?.();
  // One waiting action at a time: it sends a batch of its own, and the next one
  // waits for THAT answer the same way.
  const build = queuedBuilds.shift();
  if (build) {
    const edits = build();
    if (edits && edits.length > 0) {
      sendSync(edits);
    }
  }
}

/** The next patch must be a full render (a block appeared inside another one). */
export function requestFullRender(): void {
  forceFullRenderOnce = true;
}

/** Reads that request and clears it. */
export function takeFullRenderRequest(): boolean {
  const wanted = forceFullRenderOnce;
  forceFullRenderOnce = false;
  return wanted;
}

/** A block was left as it is by a patch: it needs the fresh render once it loses focus. */
export function noteCatchUp(): void {
  needCatchUp = true;
}

// ---------------------------------------------------------------------------
// Inline pieces the engine draws
// ---------------------------------------------------------------------------

/**
 * The inline things whose final look comes from the render: a key combination
 * turns into <kbd>s, a formula into KaTeX, a footnote marker into its number.
 * What the editor puts at the caret is a stand-in — readable, but not what the
 * page will show.
 *
 * The selector matches the same pieces in the editor's DOM and in the fresh
 * render, so the two can be lined up by position.
 */
const INLINE_ISLAND = "[data-keys], [data-tex], [data-emoji], .footnote-ref";

/** The stand-in waiting to be swapped for the real thing, if there is one. */
let inlineRefresh: { block: Element; index: number } | null = null;

/**
 * Says that this element is a stand-in. A patch normally leaves the block the
 * caret is in alone — that is what keeps the caret — so without this the
 * stand-in would sit there until something re-rendered the whole page, which is
 * to say until the file was saved.
 */
export function noteInlineIsland(el: Element): void {
  const block = host.topBlockOf(el);
  if (!block) {
    return;
  }
  const index = Array.from(block.querySelectorAll(INLINE_ISLAND)).indexOf(el);
  inlineRefresh = index < 0 ? null : { block, index };
}

/** Reads that request and clears it. */
export function takeInlineRefresh(): { block: Element; index: number } | null {
  const wanted = inlineRefresh;
  inlineRefresh = null;
  return wanted;
}

/** The same pieces in a freshly rendered block, in document order. */
export function inlineIslands(block: Element): Element[] {
  return Array.from(block.querySelectorAll(INLINE_ISLAND));
}

/**
 * The stand-ins among nodes that were just put into the document — a paste
 * carries islands at the top level of its fragment, where querySelectorAll on a
 * block would find them only after they are already in place.
 */
export function inlineIslandsIn(nodes: readonly Node[]): Element[] {
  const found: Element[] = [];
  for (const node of nodes) {
    if (!(node instanceof Element)) {
      continue;
    }
    if (node.matches(INLINE_ISLAND)) {
      found.push(node);
    }
    found.push(...inlineIslands(node));
  }
  return found;
}

export function catchUpPending(): boolean {
  return needCatchUp;
}

// ---------------------------------------------------------------------------
// The annotation editor: the core state of the parent document is frozen while
// a note is being edited over it.
// ---------------------------------------------------------------------------

export interface CoreSnapshot {
  lines: string[];
  endsNL: boolean;
  version: number;
  undo: SyncEdit[][];
  redo: SyncEdit[][];
}

/** Freezes the current document; the history goes with it. */
export function takeCoreSnapshot(): CoreSnapshot {
  return {
    lines: fullLines,
    endsNL,
    version,
    undo: undoStack.splice(0),
    redo: redoStack.splice(0),
  };
}

/** Puts a local document (the note's body) in place of the file's. */
export function openLocalDoc(text: string): void {
  dirty.clear();
  pendingSourceEdits.length = 0;
  needCatchUp = false;
  syncQueued = false;
  setFullText(text);
}

/** Brings the frozen document back, with nothing of the note left in flight. */
export function restoreCore(snap: CoreSnapshot): void {
  fullLines = snap.lines;
  endsNL = snap.endsNL;
  version = snap.version;
  undoStack.length = 0;
  undoStack.push(...snap.undo);
  redoStack.length = 0;
  redoStack.push(...snap.redo);
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  syncInFlight = false;
  syncQueued = false;
  needCatchUp = false;
  forceFullRenderOnce = false;
  pendingSourceEdits.length = 0;
  dirty.clear();
  afterSyncOnce = undefined;
}
