// The visual editor (M10).
//
// The whole document is contenteditable: a free cursor, typing anywhere, a
// formatting toolbar, tables edited cell by cell, links, a slash menu. Complex
// blocks (code, mermaid, block formulas, tabs) are “islands” with live editors.
//
// Integrity guarantee: only the blocks that actually changed are written to the
// file (htmlToMd serialization), untouched blocks are never re-serialized.
// After every synchronization the extension sends a fresh render — blocks
// without the cursor “catch up” (code highlighting, typography, formulas), the
// block holding the cursor is left alone.

import { canSerialize } from "./htmlToMd";
import {
  claimKey,
  consumeHotKey,
  initKeyBindings,
  keyOverrides,
  refreshHotkeyLabels,
  setKeyOverrides,
  type KeyCommand,
} from "./keyBindings";
import { endKeyCapture, initSettingsUi, openEditorSettings } from "./settingsUi";
import {
  annotTips,
  closeAnnotationTips,
  decorateAnnotations,
  initAnnotations,
} from "./annotations";
import {
  closeSubEditor,
  inSubEditor,
  onSubRendered,
  requestSubRender,
} from "./annotationSubEditor";
import {
  initMediaLinks,
  insertInline,
  insertLinkAtSelection,
  linkSuggestions,
  onFilePicked,
  onImageSaveFailed,
  onImageSaved,
  openImagePopup,
  openInlineMathEdit,
  openLinkPopup,
  pickFile,
  restoreSelection,
  saveSelection,
  updateLinkChip,
} from "./mediaLinks";
import { initPasteContent } from "./pasteContent";
import {
  containerBelowClick,
  openTrailingLine,
  pruneDraftLines,
  updateDraftHint,
} from "./draftLines";
import { initDeleteGuard } from "./deleteGuard";
import {
  applyList,
  applyStyle,
  caretListItem,
  gridCardOf,
  indentItem,
  initParagraphStyle,
  LIST_NAME,
  openListMenu,
  openStyleMenu,
  outdentItem,
  STYLE_ITEMS,
  toolbarListKind,
  updateBlockButtons,
} from "./paragraphStyle";
import {
  bubbleShown,
  clearFormatting,
  hideBubbleMenu,
  initInlineTools,
  openMarkPalette,
  toggleInlineCode,
  toggleUnderline,
  updateBubbleMenu,
} from "./inlineTools";
import { dedentLines, indentLines } from "./blockMove";
import {
  codeLinesOf,
  codeMenuItems,
  decorateCodeBlock,
  fenceInfoOf,
  initCodeBlockEdit,
  isInlineCode,
  openLiveEditor,
} from "./codeBlockEdit";
import {
  activateBlock,
  activeHandleBlock,
  blockDragActive,
  blockTypeName,
  cancelBlockDrag,
  caretHandleBlock,
  copyCurrentBlock,
  cutCurrentBlock,
  escalateBlock,
  followCaret,
  initBlockHandle,
  repositionHandle,
} from "./blockHandle";
import { restoreCaretAnchor, takeCaretAnchor, type CaretAnchor } from "./caretAnchor";
import { initIconPicker, openIconPicker } from "./iconPicker";
import { initMathDialog, openMathDialog } from "./mathDialog";
import { initMermaidDialog, openMermaidDialog, withDiagramLanguage } from "./mermaidDialog";
import { hasActivePopup, onPopupClose } from "./popups";
import {
  adoptText,
  cancelSync,
  catchUpPending,
  clearForRender,
  dirty,
  docLines,
  finishRemote,
  fullText,
  initCore,
  inlineIslands,
  isFootnoteService,
  markDirty,
  mutedRemote,
  noteCatchUp,
  rangeOf,
  redoOnce,
  runSyncNowThen,
  scheduleSync,
  sendSync,
  st,
  takeFullRenderRequest,
  takeInlineRefresh,
  undoOnce,
} from "./editorCore";
import { initInserts, type InsertPoint } from "./blockInserts";
import { parseFence } from "./codeFence";
import {
  endKeysCapture,
  initInlineElements,
  openAbbrEdit,
  openFootnoteEdit,
  openKeysPopup,
} from "./inlineElements";
import {
  cmd,
  enclosingTag,
  indentOfLine,
  initSelectionOps,
  insertBlockEdit,
  markDirtyAtSelection,
  placeCaret,
  rangedAncestor,
  replaceLines,
  selectionLines,
  selectionRange,
} from "./selectionOps";
import {
  componentIconEl,
  componentInsertItems,
  initComponentMenu,
  insertMarkdownBlock,
  insertPoint,
  insertPopupAnchor,
  maybeOpenSlashMenu,
  openComponentMenu,
  prefetchComponentIcons,
  renderPinnedButtons,
  renderQuickMenu,
  runComponent,
} from "./componentMenu";
import {
  initTabsGrids,
  openTabs,
  renameTabEl,
  restoreOpenTabs,
  splitCardParagraph,
  wireGridControls,
  wireTabControls,
} from "./tabsGrids";
import {
  currentCell,
  initTables,
  insertCellBreak,
  moveCell,
  padEmptyCells,
  updateTableMenu,
} from "./tables";
import { decorateCodeNav } from "../shared/codeNav";
import {
  keepHeaderReadable,
  renderSiteHeader,
  renderSiteNav,
  type SiteChromeData,
  type SiteChromeHooks,
} from "../shared/siteChrome";
import { t } from "../shared/i18n";
import { applyExtraCss, initMermaid, renderDiagrams, watchMermaidReveal } from "../shared/mermaid";
import { applyBackground, applyPalette, toggleTheme, type PaletteMsg } from "../shared/scheme";
import {
  initView,
  refreshToc,
  restoreViewState,
  syncViewButtons,
  toggleToc,
  toggleWidth,
} from "./viewState";

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState?: () => Record<string, unknown> | undefined;
  setState?: (state: Record<string, unknown>) => void;
}
declare function acquireVsCodeApi(): VsCodeApi;
declare const window: Window & {
  __visual?: {
    mermaidUri: string;
    plantumlUri?: string;
    plantumlVizUri?: string;
    katexUri?: string;
    nonce: string;
  };
  // Drawing the page is shared/mermaid's business; the dialog renders a single
  // diagram of its own and needs parse/render as well.
  __mermaid?: {
    initialize: (o: unknown) => void;
    parse: (code: string) => Promise<unknown>;
    render: (id: string, code: string) => Promise<{ svg: string }>;
  };
  __katex?: {
    renderToString: (
      tex: string,
      options?: { displayMode?: boolean; throwOnError?: boolean },
    ) => string;
  };
};

const api = acquireVsCodeApi();
const cfg = window.__visual ?? { mermaidUri: "", katexUri: "", nonce: "" };
initMermaid(cfg);
const docEl = document.getElementById("doc") as HTMLElement;
// A diagram in an unopened tab or a folded call-out waits for the reveal.
watchMermaidReveal(docEl);
const statusEl = document.getElementById("vstatus") as HTMLElement;

// The document itself, the batches sent to the file and the history live in
// editorCore; everything below draws it and edits it.
initCore({
  docEl,
  statusEl,
  post: (msg) => api.postMessage(msg),
  topBlockOf: (node) => topBlockOf(node),
  caretInBlock: () => currentBlock() !== null,
  inSub: () => inSubEditor(),
  renderSub: () => requestSubRender(),
});

// ---------------------------------------------------------------------------
// Icons: the 14 342 of them live in one pack next to the extension, so the
// webview asks for what it is about to draw — the names of the sets once, the
// SVGs a screenful at a time.
// ---------------------------------------------------------------------------

let resolveIconNames: ((sets: Record<string, string[]>) => void) | null = null;
/**
 * Requests waiting for their batch, by id. NOT a queue: several batches can be
 * in flight at once (the palette warms up while the picker scrolls), and the
 * answers do not have to come back in the order they were asked for.
 */
const iconBatches = new Map<number, (svgs: Record<string, string>) => void>();
let nextIconRequest = 1;

function requestIconNames(): Promise<Record<string, string[]>> {
  return new Promise((resolve) => {
    resolveIconNames = resolve;
    api.postMessage({ type: "iconNames" });
  });
}

function requestIcons(codes: string[]): Promise<Record<string, string>> {
  if (codes.length === 0) {
    return Promise.resolve({});
  }
  const id = nextIconRequest++;
  return new Promise((resolve) => {
    iconBatches.set(id, resolve);
    api.postMessage({ type: "iconSvgs", id, codes });
  });
}

function takeIconBatch(id: number, svgs: Record<string, string>): void {
  const resolve = iconBatches.get(id);
  iconBatches.delete(id);
  resolve?.(svgs ?? {});
}

// ---------------------------------------------------------------------------
// Extension messages
// ---------------------------------------------------------------------------

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as { type: string; [k: string]: unknown };
  switch (msg.type) {
    case "render":
      // While an annotation editor is open, #doc holds the note, not the file —
      // a file render would wipe it. The close path requests a fresh one anyway.
      if (!inSubEditor()) {
        applyBackground(String(msg.background ?? "material"));
        applyPalette(msg.palette as PaletteMsg | undefined);
        applyExternalRender(String(msg.html), String(msg.text), Number(msg.version));
      }
      break;
    case "synced":
      if (!inSubEditor()) {
        applyPatches(String(msg.html), String(msg.text), Number(msg.version));
      }
      break;
    case "subRendered":
      onSubRendered(Number(msg.id), String(msg.html));
      break;
    case "saveState":
      showSaveState(Boolean(msg.unsaved), Boolean(msg.justSaved));
      break;
    case "outsideChange":
      showOutsideBar(true);
      break;
    case "rejected":
      // The batch is stale (an external edit): a full render will arrive separately.
      cancelSync();
      break;
    case "editText":
      openLiveEditor(
        findBlockByStart(Number(msg.startLine)),
        Number(msg.startLine),
        Number(msg.endLine),
        String(msg.text),
        "markdown",
      );
      break;
    case "extraCss": {
      applyExtraCss(String(msg.css), "vExtraCss");
      // The project's stylesheet has the last word on the header colors.
      const head = document.getElementById("vhead");
      if (head) {
        keepHeaderReadable(head);
      }
      break;
    }
    case "imageSaved":
      onImageSaved(Number(msg.token), String(msg.relPath), String(msg.webUri ?? ""));
      break;
    case "filePicked":
      onFilePicked(Number(msg.token), String(msg.relPath), String(msg.webUri ?? ""));
      break;
    case "imageSaveFailed":
      onImageSaveFailed(Number(msg.token), String(msg.error ?? ""));
      break;
    case "uiConfig":
      applyUiConfig(msg);
      break;
    case "siteChrome":
      chromeData = msg.data as SiteChromeData;
      refreshSiteChrome();
      break;
    case "siteActive":
      activePage = typeof msg.active === "string" ? msg.active : undefined;
      refreshSiteChrome();
      break;
    case "chromeState":
      document.body.classList.toggle("vhead", msg.header === true);
      document.body.classList.toggle("vnav", msg.nav === true);
      syncViewButtons();
      refreshSiteChrome();
      break;
    case "iconNames":
      resolveIconNames?.(msg.sets as Record<string, string[]>);
      resolveIconNames = null;
      break;
    case "iconSvgs":
      takeIconBatch(Number(msg.id), msg.svgs as Record<string, string>);
      break;
  }
});

// Editor settings (from VS Code / the gear popup).
// inlineFormatting: selection — bubble only; toolbar — panel only;
// both — both the panel and the bubble. toolbarButtons — ids of the “Insert”
// components pinned to the panel as quick buttons.
// The pinned default is what is used most often when working on documentation;
// it must match "mkdocsStudio.toolbarButtons" in package.json.
const DEFAULT_PINNED = ["table", "image", "code", "hr"];
let inlineFormatting = "both";
let pinnedButtons: string[] = [...DEFAULT_PINNED];
let bubbleEnabled = true;

function applyUiConfig(msg: { [k: string]: unknown }): void {
  if (typeof msg.inlineFormatting === "string") {
    inlineFormatting = msg.inlineFormatting;
  }
  if (Array.isArray(msg.toolbarButtons)) {
    pinnedButtons = msg.toolbarButtons.filter((x): x is string => typeof x === "string");
  }
  if (msg.keybindings && typeof msg.keybindings === "object") {
    const bindings: Record<string, string> = {};
    for (const [id, value] of Object.entries(msg.keybindings as Record<string, unknown>)) {
      if (typeof value === "string") {
        bindings[id] = value;
      }
    }
    setKeyOverrides(bindings);
  }
  applyInlineFormattingMode();
  renderPinnedButtons(); // updates the shortcut badges by itself
  refreshHotkeyLabels();
}

function applyInlineFormattingMode(): void {
  bubbleEnabled = inlineFormatting !== "toolbar";
  document.body.classList.toggle("vfmt-selection", inlineFormatting === "selection");
  if (!bubbleEnabled) {
    hideBubbleMenu();
  }
}

/** Persist a setting in VS Code (the provider writes it to the config). */
function persistUiConfig(): void {
  api.postMessage({
    type: "setConfig",
    inlineFormatting,
    toolbarButtons: pinnedButtons,
    keybindings: keyOverrides(), // only the differences from the defaults
  });
}

// --- Site header and left page panel (toolbar buttons) ---

let chromeData: SiteChromeData | undefined;
let activePage: string | undefined;

const chromeHooks: SiteChromeHooks = {
  openPage: (path) => api.postMessage({ type: "openPage", path }),
  openLink: (href) => api.postMessage({ type: "openLink", href }),
  // The editor's toolbar already carries a gear of its own — that one is for the
  // editor, this one for the site. Keeping them on different strips is what
  // tells them apart.
  openSettings: () => api.postMessage({ type: "openConfig" }),
};

/**
 * Writes the page into the file. Everything typed lives in the editor until
 * this happens — that is what keeps the project's formatters from running (and
 * rewriting the file under the caret) between one word and the next.
 */
function saveNow(): void {
  // Anything still waiting in the batch timer goes first, so what is saved is
  // what is on screen and not what it was a moment ago.
  runSyncNowThen(() => api.postMessage({ type: "save" }));
}

/**
 * Whether the page holds anything the file does not.
 *
 * It shows on the save button — a dot, and the button in the accent colour —
 * and nowhere else. The status line used to narrate the sync as well (“Changed…”,
 * “Syncing…”, “Ready”), which is three names for one state and a text that
 * flickers on every keystroke; what an author needs to know is whether their
 * writing is in the file, and that is one thing, shown in one place.
 */
let unsavedWork = false;

/** Cleared once the page is on screen: “Loading…” has nothing to say after that. */
let booted = false;

function refreshStatus(): void {
  if (!booted) {
    booted = true;
    st.set("");
  }
  document.body.classList.toggle("v-unsaved", unsavedWork);
  const save = document.getElementById("tbSave");
  if (save) {
    save.title = unsavedWork ? t("Save (Cmd/Ctrl+S) — unsaved changes") : t("Save (Cmd/Ctrl+S)");
  }
}

function showSaveState(unsaved: boolean, _justSaved: boolean): void {
  unsavedWork = unsaved;
  refreshStatus();
}

/** The bar that appears when the file was changed by someone else. */
function showOutsideBar(show: boolean): void {
  const bar = document.getElementById("voutside");
  if (bar) {
    bar.hidden = !show;
  }
}

/** Redraws the header and the page panel to match the current button state. */
function refreshSiteChrome(): void {
  const head = document.getElementById("vhead");
  const nav = document.getElementById("vnav");
  // Draw only what is visible: the page tree can be large.
  if (head) {
    if (document.body.classList.contains("vhead")) {
      renderSiteHeader(head, chromeData, activePage, chromeHooks);
    } else {
      head.textContent = "";
    }
  }
  if (nav) {
    if (document.body.classList.contains("vnav")) {
      renderSiteNav(nav, chromeData, activePage, chromeHooks);
    } else {
      nav.textContent = "";
    }
  }
}

/** Toolbar button: tell the extension — it will store the setting and reply. */
function toggleSiteChrome(what: "header" | "nav"): void {
  const shown = document.body.classList.contains(what === "header" ? "vhead" : "vnav");
  api.postMessage({ type: "setChrome", [what]: !shown });
}

/** The markup the last render put on screen — see applyExternalRender. */
let renderedHtml = "";

/**
 * A render that comes from a change we did not make: someone edited the file,
 * or saved it and a formatter ran over it. The document is redrawn from the
 * file, so anything typed and not yet sent is gone — which is why an echo must
 * not get this far. The same text with the same markup is exactly what is on
 * screen already: only the version has moved on.
 */
function applyExternalRender(html: string, text: string, ver: number): void {
  if (docEl.childElementCount > 0 && text === fullText() && html === renderedHtml) {
    adoptText(text, ver);
    return;
  }
  // Patch it in block by block. Redrawing the whole document for someone else's
  // edit is what put the caret at the top of the page — and it also threw away
  // whatever had been typed into the caret's block but not yet sent, since the
  // markup that arrives is the file as it stands on disk. The patch leaves that
  // block alone and replaces the rest; it falls back to a full render when the
  // structure no longer lines up, and only then is the caret's place needed.
  //
  // The anchor is taken here and nowhere else. A render WE asked for is a
  // different matter: the caret belongs wherever the edit has just put it (the
  // paragraph a Return opened, the block that was inserted), and an anchor from
  // before that edit would drag it back to the line it left.
  applyPatches(html, text, ver, takeCaretAnchor(docEl));
}

/** Full render: resets the DOM. `caret` is where it stood, for an outside edit. */
function applyRender(html: string, text: string, ver: number, caret: CaretAnchor | null): void {
  const tabs = openTabs(docEl);
  mutedRemote(() => {
    clearForRender();
    adoptText(text, ver);
    docEl.innerHTML = html;
    renderedHtml = html;
    decorateAll();
    restoreOpenTabs(docEl, tabs);
    ensureTrailingDraft();
  });
  void renderDiagrams(docEl);
  refreshToc();
  decorateAnnotations();
  // Before finishRemote: an action waiting for the sync (an insertion placing
  // the cursor in the new block) has the last word on where the caret goes.
  restoreCaretAnchor(docEl, caret);
  repositionHandle(); // blocks were recreated — the handle either moves or disappears
  refreshStatus();
  finishRemote();
}

/**
 * A “catch-up” patch after our edit: replace the blocks with the fresh render,
 * except for the block holding the cursor and the live editors. `caret` is
 * where the caret stood before an outside edit, for the full render this falls
 * back to; our own catch-up passes nothing, since the edit has already put the
 * caret where it belongs.
 */
function applyPatches(
  html: string,
  text: string,
  ver: number,
  caret: CaretAnchor | null = null,
): void {
  if (takeFullRenderRequest()) {
    // Nested insertion: redraw everything so that the new block inside the focus
    // block becomes visible (applyRender itself runs afterSyncOnce — placing the
    // cursor).
    applyRender(html, text, ver, caret);
    return;
  }
  adoptText(text, ver);
  renderedHtml = html;

  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  // The engine's own tail — the separator and the list of footnote texts — is
  // not part of the document: it has no source line, and blocksInOrder leaves
  // it out. Counting it in `fresh` made the two lists disagree on every page
  // that has a footnote, so every edit fell through to a full render and the
  // caret was thrown to the top of the page each time a word was typed.
  const freshAll = Array.from(tpl.content.children);
  const fresh = freshAll.filter((el) => !isFootnoteService(el));
  const service = freshAll.filter(isFootnoteService);
  const ours = blocksInOrder();

  if (fresh.length !== ours.length) {
    // The structure diverged (for example, a paste with empty lines) — the safe
    // path is a full render.
    applyRender(html, text, ver, caret);
    return;
  }

  const tabs = openTabs(docEl);
  // The patch never touches the caret's block, yet Chrome sometimes drops the
  // selection while the NEIGHBOURING nodes are replaced: the caret lands at the
  // start of the document, and keystrokes racing the patch type into a foreign
  // block — with the observer muted, that text is never written to the file.
  // Remember where the caret was; if it leaves the block that was kept for it,
  // put it back (the block was not replaced, so the saved nodes are alive).
  const sel0 = document.getSelection();
  const range0 = sel0 && sel0.rangeCount > 0 ? sel0.getRangeAt(0).cloneRange() : null;
  const caretHome = range0 ? (topBlockOf(range0.startContainer) as HTMLElement | null) : null;
  // A stand-in was put at the caret a moment ago (a key combination, a formula,
  // a footnote marker). Its block is the focus block, which a patch would
  // normally leave alone — so this one gets replaced anyway and the caret is
  // put back after the piece that has just become the real thing.
  const refresh = takeInlineRefresh();
  mutedRemote(() => {
    const focusBlock = currentBlock();
    for (let i = 0; i < ours.length; i++) {
      const our = ours[i];
      const neu = fresh[i] as HTMLElement;
      if (our.classList.contains("vlive")) {
        // Live editor: update the range only.
        copySrcAttrs(neu, our);
        continue;
      }
      const bringIsland = refresh?.block === our && !dirty.has(our);
      // The focus block keeps its DOM so the caret survives — and so does a
      // block still marked as changed: replacing it would leave the old node
      // detached while still in `dirty`, and the next batch would read that as
      // “the user deleted this block” and cut it out of the file. Its edit has
      // not been sent yet, so the DOM here is newer than the render anyway.
      if (!bringIsland && (our === focusBlock || dirty.has(our))) {
        copySrcAttrs(neu, our);
        our.removeAttribute("data-pending");
        noteCatchUp();
        continue;
      }
      docEl.replaceChild(neu, our);
      decorateBlock(neu);
      if (bringIsland) {
        caretAfterIsland(neu, refresh.index);
      }
    }
    replaceFootnoteService(service);
    restoreOpenTabs(docEl, tabs);
    ensureTrailingDraft();
    decorateCodeNavs();
  });
  if (range0 && caretHome && caretHome.isConnected) {
    const sel = document.getSelection();
    const lost = !sel || sel.rangeCount === 0 || !caretHome.contains(sel.anchorNode);
    if (lost && caretHome.contains(range0.startContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(range0);
    }
  }
  void renderDiagrams(docEl);
  refreshToc();
  decorateAnnotations();
  repositionHandle();
  refreshStatus();
  finishRemote();
}

/**
 * Puts the caret straight after the n-th engine-drawn piece of a freshly
 * rendered block — where it stood before the block was replaced, since that is
 * where the stand-in had just been dropped in.
 */
function caretAfterIsland(block: HTMLElement, index: number): void {
  const island = inlineIslands(block)[index];
  const host = block.closest<HTMLElement>('[contenteditable="true"]') ?? docEl;
  host.focus();
  const range = document.createRange();
  if (island) {
    range.setStartAfter(island);
  } else {
    range.selectNodeContents(block);
  }
  range.collapse(island ? true : false);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function copySrcAttrs(from: Element, to: Element): void {
  for (const name of ["data-src-line", "data-src-end", "data-block-type"]) {
    const v = from.getAttribute(name);
    if (v !== null) {
      to.setAttribute(name, v);
    }
  }
}

// ---------------------------------------------------------------------------
// Blocks: roles, decoration
// ---------------------------------------------------------------------------

/**
 * Puts the freshly rendered footnote tail in place of the old one. It is drawn
 * by the engine from the definitions in the file, so it is replaced whole
 * rather than patched — nothing in it is edited directly, and the caret is
 * never in it.
 */
function replaceFootnoteService(service: Element[]): void {
  for (const el of Array.from(docEl.children)) {
    if (isFootnoteService(el)) {
      el.remove();
    }
  }
  for (const el of service) {
    docEl.appendChild(el);
    decorateBlock(el as HTMLElement);
  }
}

/**
 * Top-level blocks in document order: the known ones (data-src-line) and the
 * new ones already sent (data-pending — an insert is in flight). Empty drafts
 * are excluded.
 */
function blocksInOrder(): Element[] {
  return Array.from(docEl.children).filter(
    (el) => el.hasAttribute("data-src-line") || el.hasAttribute("data-pending"),
  );
}

function findBlockByStart(start: number): Element | undefined {
  return blocksInOrder().find((b) => Number(b.getAttribute("data-src-line")) === start);
}

/** The top-level block containing the node. */
function topBlockOf(node: Node | null): Element | null {
  let cur: Node | null = node;
  while (cur && cur.parentNode !== docEl) {
    cur = cur.parentNode;
  }
  return cur instanceof Element ? cur : null;
}

function isIsland(el: Element): boolean {
  const t = el.tagName;
  if (
    t === "DIV" &&
    (el.classList.contains("highlight") ||
      el.classList.contains("arithmatex") ||
      el.classList.contains("mkdocstrings") ||
      // An include shows another file's text. Typing in it would be typing into
      // a document that is not open — the marker is all that is written back.
      el.classList.contains("snippet-include"))
  ) {
    return true;
  }
  if (t === "PRE") {
    return true; // both mermaid and indented code
  }
  if (t === "DIV" && el.classList.contains("tabbed-set")) {
    return false; // tabs are partially editable, separate logic
  }
  return false;
}

function decorateAll(): void {
  for (const el of Array.from(docEl.children)) {
    decorateBlock(el);
  }
  decorateCodeNavs();
}

/**
 * A copy button (Material) on every code block, including those nested inside
 * admonitions and tabs. Call only inside mutedRemote: for nested blocks the
 * button is added into an editable area, and a regular mutation would be taken
 * for a document edit.
 */
function decorateCodeNavs(): void {
  for (const block of Array.from(docEl.querySelectorAll<HTMLElement>("div.highlight"))) {
    if (block.classList.contains("mermaid")) {
      continue;
    }
    decorateCodeNav(block, {
      tipAttr: "data-tip",
      codeText: codeCopyText,
      notify: (text) => st.set(text),
    });
  }
}

/** What goes to the clipboard on the copy button: the code without the fence and service markers. */
function codeCopyText(block: HTMLElement): string {
  const codeEl = block.querySelector<HTMLElement>(":scope > pre > code");
  if (!codeEl) {
    return "";
  }
  // Annotations are shown as circles — their text (the number) is no good, so take the file source.
  if (codeEl.querySelector(".md-annotation") && block.hasAttribute("data-src-line")) {
    const { start, end } = rangeOf(block);
    const body = parseFence(dedentLines(docLines().slice(start, end)).lines).body;
    if (body.length > 0) {
      return body.join("\n");
    }
  }
  return codeLinesOf(codeEl).join("\n");
}

/**
 * The inline pieces the engine draws — a formula, a key combination, a footnote
 * marker, an emoji — are sealed off from the caret. Their markup is a rendering
 * of one attribute (data-tex, data-keys) and nothing inside them is written
 * back, so a character typed in there is a character thrown away: the browser
 * happily puts the caret inside a <kbd> or in the middle of KaTeX. A click on
 * one still opens its own form.
 */
function sealInlineIslands(el: Element): void {
  for (const island of inlineIslands(el)) {
    island.setAttribute("contenteditable", "false");
  }
}

/** Assigns a role to the block: island / tabs / details / noedit / free. */
function decorateBlock(el: Element): void {
  if (!(el instanceof HTMLElement)) {
    return;
  }
  sealInlineIslands(el);
  // Tables at any depth: a caret needs a text line inside every cell.
  padEmptyCells(el);
  if (isInlineCode(el)) {
    decorateCodeBlock(el);
    return;
  }
  if (isIsland(el)) {
    el.classList.add("visland");
    el.setAttribute("contenteditable", "false");
    if (el.classList.contains("mermaid") && !el.hasAttribute("data-mermaid-src")) {
      el.setAttribute("data-mermaid-src", el.textContent ?? "");
    }
    if (el.classList.contains("plantuml") && !el.hasAttribute("data-plantuml-src")) {
      el.setAttribute("data-plantuml-src", el.textContent ?? "");
    }
    attachIslandTools(el);
    return;
  }
  if (el.classList.contains("tabbed-set")) {
    el.classList.add("visland");
    el.setAttribute("contenteditable", "false");
    for (const block of Array.from(
      el.querySelectorAll(":scope > .tabbed-content > .tabbed-block"),
    )) {
      const b = block as HTMLElement;
      b.setAttribute("contenteditable", "true");
      // An empty tab (inserted through the form) — give a paragraph as a target
      // for the cursor; `<p><br></p>` serializes to nothing (see paragraphLines),
      // the round-trip stays intact.
      if (b.children.length === 0 && (b.textContent ?? "").trim() === "") {
        const p = document.createElement("p");
        p.appendChild(document.createElement("br"));
        b.appendChild(p);
      }
      decorateNested(b); // islands/containers inside the tab body
    }
    for (const label of Array.from(el.querySelectorAll(":scope > .tabbed-labels > label"))) {
      wireTabLabel(label as HTMLElement);
    }
    wireTabControls(el);
    attachIslandTools(el);
    return;
  }
  if (el.tagName === "DETAILS" && el.classList.contains("admonition")) {
    decorateDetails(el);
    attachIslandTools(el, true);
    const body = el.querySelector(":scope > .adm-body");
    if (body) {
      decorateNested(body);
    }
    return;
  }
  // A card grid (grid cards): freely editable, but the cards (li) are
  // added/removed/reordered with inline controls (see wireGridControls).
  if (el.classList.contains("grid") && el.querySelector(":scope > ul")) {
    wireGridControls(el);
    for (const li of Array.from(el.querySelectorAll(":scope > ul > li"))) {
      decorateNested(li);
    }
  }
  if (el.tagName === "BLOCKQUOTE") {
    decorateNested(el);
  }
  if (isFootnoteService(el)) {
    // The footnote tail (`<hr class="footnotes-sep">` + `<section class="footnotes">`)
    // is generated by the engine itself: it has no source lines. Mark it as
    // service markup, otherwise the editor would take it for a draft and append
    // it to the file (an extra `---`).
    el.classList.add("vservice", "visland", "vnoedit");
    el.setAttribute("contenteditable", "false");
    return;
  }
  if (!el.hasAttribute("data-src-line")) {
    return; // a draft — an ordinary editable p
  }
  if (!canSerialize(el)) {
    // Raw HTML, footnotes and the like — editable only as text.
    el.classList.add("visland", "vnoedit");
    el.setAttribute("contenteditable", "false");
    attachIslandTools(el, true);
    return;
  }
  // An admonition is edited inline, but the buttons in the corner (like the
  // ones on islands) give an obvious way to delete the block or open its source.
  if (el.classList.contains("admonition")) {
    attachIslandTools(el, true);
    decorateNested(el); // islands/containers inside the admonition body
  }
}

/**
 * Decorates nested island blocks (tabs, code, mermaid, formulas, grids, nested
 * admonitions) inside a container — the body of an admonition/tab/card/quote.
 * The top-level decorateBlock walks docEl.children only, so nested blocks have
 * to be decorated separately, otherwise they would not become “islands” (not
 * editable, no controls). Called on a FRESH DOM (a full render or a block
 * replacement in applyPatches) — exactly once, with no risk of double binding.
 */
function decorateNested(container: Element): void {
  for (const child of Array.from(container.children)) {
    if (
      !(child instanceof HTMLElement) ||
      child.classList.contains("admonition-title") ||
      child.tagName === "SUMMARY" ||
      child.classList.contains("isl-tools") ||
      child.classList.contains("vcard-add")
    ) {
      continue;
    }
    decorateBlock(child);
  }
}

/** details: the block itself is noedit (otherwise clicks on summary do not collapse it), the body is editable. */
function decorateDetails(el: HTMLElement): void {
  el.setAttribute("contenteditable", "false");
  let body = el.querySelector(":scope > .adm-body") as HTMLElement | null;
  if (!body) {
    body = document.createElement("div");
    body.className = "adm-body";
    const rest: Node[] = [];
    for (const child of Array.from(el.childNodes)) {
      if (child instanceof Element && child.tagName === "SUMMARY") {
        continue;
      }
      rest.push(child);
    }
    for (const n of rest) {
      body.appendChild(n);
    }
    el.appendChild(body);
  }
  body.setAttribute("contenteditable", "true");
  const summary = el.querySelector(":scope > summary") as HTMLElement | null;
  if (summary) {
    summary.title = t("Double-click to change the title");
    summary.addEventListener("dblclick", () => {
      summary.setAttribute("contenteditable", "true");
      summary.focus();
    });
    summary.addEventListener("blur", () => {
      summary.removeAttribute("contenteditable");
      markDirty(el);
    });
  }
}

function wireTabLabel(label: HTMLElement): void {
  label.title = t("Double-click to rename the tab");
  // The second click of the pair would activate the label and hand focus to the
  // radio behind it, ending the renaming in the tick it began.
  label.addEventListener("mousedown", (e) => {
    if (e.detail >= 2) {
      e.preventDefault();
    }
  });
  label.addEventListener("dblclick", (e) => {
    e.preventDefault();
    // A double click on the set opens its Markdown source; on the name of a tab
    // it means renaming, and only that.
    e.stopPropagation();
    label.draggable = false; // while editing — so that text selection works
    label.setAttribute("contenteditable", "true");
    label.focus();
    selectTabName(label);
  });
  label.addEventListener("blur", () => {
    if (label.getAttribute("contenteditable") !== "true") {
      return; // nothing was being edited — losing focus is not a rename
    }
    label.removeAttribute("contenteditable");
    label.draggable = true;
    const set = label.closest<HTMLElement>(".tabbed-set");
    if (set) {
      renameTabEl(set, label, tabLabelName(label));
    }
  });
  label.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      label.blur();
    }
  });
}

/**
 * The name of a tab. The label also carries the “×” that deletes the tab, and
 * that is not part of the name — reading the label whole wrote `=== "One×"`
 * into the file, one more × each time.
 */
function tabLabelName(label: HTMLElement): string {
  return Array.from(label.childNodes)
    .filter((node) => !(node instanceof Element && node.classList.contains("vtab-x")))
    .map((node) => node.textContent ?? "")
    .join("");
}

/** Selects the name for editing, leaving the “×” out of the selection. */
function selectTabName(label: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(label);
  const remove = label.querySelector(":scope > .vtab-x");
  if (remove) {
    range.setEndBefore(remove);
  }
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Puts the cursor at the start of the block's first paragraph (so that the block becomes “focused”). */
function caretIntoBlock(block: HTMLElement): void {
  const target = block.querySelector("p, li, h1, h2, h3, h4, h5, h6") ?? block;
  // A tab block is a nested editable host. After a click on a menu item the
  // focus moves to body; return it to the editor, otherwise typing goes
  // “nowhere” (execCommand and input require the focus to be inside a
  // contenteditable).
  const host = block.closest<HTMLElement>('[contenteditable="true"]');
  host?.focus();
  const sel = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Island buttons: editing and deletion. */
/**
 * Marks an island/block for the handle menu. There are no corner buttons any
 * more — all the actions (change, type, edit as text, delete) are collected in
 * the “⋮⋮” menu on the left. For editable islands we keep the double click as a
 * quick path.
 */
function attachIslandTools(el: HTMLElement, noedit = false): void {
  if (el.hasAttribute("data-vwired")) {
    return;
  }
  el.setAttribute("data-vwired", "");
  if (!noedit) {
    el.addEventListener("dblclick", () => openIslandEditor(el));
  }
}

// A click on the strip of padding at the bottom of a container opens a line
// there. Inside a tab or a call-out the container ends right below its last
// block, and after a diagram, a table or a button there was nowhere left to
// click — the document's own trailing paragraph sits outside them.
docEl.addEventListener("mousedown", (e) => {
  const container = containerBelowClick(e.target as Element | null, e.clientY);
  if (!container) {
    return;
  }
  e.preventDefault(); // the browser would put the caret in the last block instead
  const line = openTrailingLine(container);
  caretIntoBlock(line);
  // Moving the caret ourselves does not always announce a selectionchange, and
  // the hint belongs to the line the caret just landed in.
  updateDraftHint(docEl, line, t("Keep writing…"));
});

// Typing is what makes the hint stale: the line it marks is no longer empty.
// A selection change alone does not always follow the first character.
docEl.addEventListener("input", () => {
  pruneDraftLines(docEl, caretLineBlock());
  updateDraftHint(docEl, caretLineBlock(), t("Keep writing…"));
});

// Focus leaving the document for good takes the lent line with it. Focus moving
// to the editor's own chrome is NOT leaving: a toolbar button takes focus before
// its popup exists, and taking the line away there would drop the saved
// selection the popup inserts into. Nothing to move focus to — the click landed
// outside the editor — is the case worth cleaning up after.
docEl.addEventListener("focusout", (e) => {
  if (e.relatedTarget !== null || hasActivePopup()) {
    return;
  }
  pruneDraftLines(docEl, null);
});

/** There must always be an editable draft paragraph after the last block. */
function ensureTrailingDraft(): void {
  const last = docEl.lastElementChild;
  const lastReal = last?.classList.contains("isl-tools") ? last.parentElement : last;
  const needsDraft =
    !lastReal ||
    lastReal.getAttribute("contenteditable") === "false" ||
    lastReal.tagName !== "P" ||
    (lastReal.textContent ?? "").trim() !== "";
  if (needsDraft) {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    docEl.appendChild(p);
  }
  if (docEl.children.length === 0) {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    p.setAttribute("data-vph", t("Start writing…"));
    docEl.appendChild(p);
  }
}

// The settings popup may be waiting for a keystroke when it closes.
onPopupClose(() => {
  endKeyCapture();
  endKeysCapture();
});

initMathDialog({ katexUri: cfg.katexUri ?? "", nonce: cfg.nonce });

initMermaidDialog({
  insertBlock: (markdown, at) => insertMarkdownBlock(markdown, at as InsertPoint),
  insertPoint: () => insertPoint(),
});

initInlineElements({
  insertInline: (el) => insertInline(el),
  saveSelection: () => saveSelection(),
  restoreSelection: () => restoreSelection(),
  enclosingTag: (node, tagName) => enclosingTag(node, tagName),
  openLinkPopup: (existing) => openLinkPopup(existing),
  insertLinkAtSelection: (url, text, title) => insertLinkAtSelection(url, text, title),
});

initInserts({
  insertPoint: () => insertPoint(),
  insertMarkdownBlock: (template, at) => insertMarkdownBlock(template, at),
  popupAnchor: () => insertPopupAnchor(),
  blockByStart: (start) => findBlockByStart(start),
  caretInto: (block) => caretIntoBlock(block),
  pickFile: (kind) => pickFile(kind),
  linkSuggestions: () => linkSuggestions(),
});

initView({
  getState: () => api.getState?.(),
  setState: (state) => api.setState?.(state),
});

initSelectionOps({
  docEl,
  currentBlock,
  blocksInOrder,
  caretIntoBlock,
  findBlockByStart,
  insertMarkdownBlock,
});
initComponentMenu({
  docEl,
  post: (msg) => api.postMessage(msg),
  currentBlock,
  iconSvgs: (codes) => requestIcons(codes),
  pinnedButtons: () => pinnedButtons,
});
initTabsGrids({
  docEl,
  indentOfLine,
  rangedAncestor,
  replaceLines,
  caretIntoBlock,
});
initTables({
  placeCaret: (el, atEnd) => placeCaret(el, atEnd),
  caretIntoBlock: (block) => caretIntoBlock(block),
  topBlockOf: (node) => topBlockOf(node),
  rangedAncestor: (el) => rangedAncestor(el),
  indentOfLine: (line) => indentOfLine(line),
  replaceLines: (start, end, lines, caretLine) => replaceLines(start, end, lines, caretLine),
});

initIconPicker({
  iconNames: () => requestIconNames(),
  iconSvgs: (codes) => requestIcons(codes),
  anchor: () => insertPopupAnchor(),
  insertInline: (el) => insertInline(el),
  markDirty: (node) => markDirty(node),
  saveSelection: () => saveSelection(),
  restoreSelection: () => restoreSelection(),
});

// ---------------------------------------------------------------------------
// The live editor of an island (code / mermaid / formula / tabs / “as text”)
// ---------------------------------------------------------------------------

function openIslandEditor(el: HTMLElement): void {
  const { start, end } = rangeOf(el);
  // Code blocks are edited inline (decorateCodeBlock); only snippet islands
  // (`--8<--`) end up here — they are edited as source text.
  // For a nested block the container's service indent is stripped: the user edits
  // the markdown itself, and the admonition's four spaces come back on save.
  const { indent, lines } = dedentLines(docLines().slice(start, end));
  if (el.classList.contains("mermaid") || el.classList.contains("plantuml")) {
    // A diagram gets the dialog with a live preview instead of a plain textarea.
    // The fence lines are preserved as they are — only the body is edited.
    const language = el.classList.contains("plantuml") ? "plantuml" : "mermaid";
    const openLine = lines[0] ?? `\`\`\`${language}`;
    const closeLine = lines.length > 1 ? (lines[lines.length - 1] ?? "```") : "```";
    openMermaidDialog(
      lines.slice(1, Math.max(1, lines.length - 1)).join("\n"),
      t("Save"),
      (code, nextLanguage) => {
        const cur = rangeOf(el); // the range could have shifted due to parallel edits
        const nextOpenLine =
          nextLanguage === language ? openLine : withDiagramLanguage(openLine, nextLanguage);
        const fence = indentLines([nextOpenLine, ...code.split("\n"), closeLine], indent);
        document.getSelection()?.removeAllRanges();
        sendSync([{ start: cur.start, end: cur.end, text: fence.join("\n") + "\n" }]);
      },
      language,
    );
    return;
  }
  if (el.classList.contains("arithmatex")) {
    // A block formula: the same dialog, with the delimiter style preserved
    // (`$$` or `\[…\]`) — a document written by hand keeps its own form.
    const bracket = el.getAttribute("data-math-delim") === "bracket";
    const [open, close] = bracket ? ["\\[", "\\]"] : ["$$", "$$"];
    openMathDialog({
      title: t("Formula"),
      tex: el.getAttribute("data-tex") ?? "",
      block: true,
      okLabel: t("Save"),
      anchor: el,
      onSave: (tex) => {
        const cur = rangeOf(el);
        const body = indentLines([open, ...tex.split("\n"), close], indent);
        document.getSelection()?.removeAllRanges();
        sendSync([{ start: cur.start, end: cur.end, text: body.join("\n") + "\n" }]);
      },
    });
    return;
  }
  openLiveEditor(el, start, end, lines.join("\n"), blockTypeName(el).toLowerCase(), indent);
}

// ---------------------------------------------------------------------------
// Selection: the current block, highlighting, toolbar state
// ---------------------------------------------------------------------------

function currentBlock(): Element | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  const node = sel.anchorNode;
  if (!node || !docEl.contains(node)) {
    return null;
  }
  return topBlockOf(node);
}

/** The line the caret is in — the paragraph, however deeply it is nested. */
function caretLineBlock(): Element | null {
  const sel = document.getSelection();
  const node = sel && sel.rangeCount > 0 ? sel.anchorNode : null;
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el && docEl.contains(el) ? el.closest("p") : null;
}

let lastFocusBlock: Element | null = null;
// A click on an island puts the caret somewhere NEAR it, never inside — the
// selectionchange below would immediately hand the handle to that neighbour.
// The click's activation must survive the caret's, briefly.
let islandClickAt = 0;
document.addEventListener("selectionchange", () => {
  requestAnimationFrame(() => {
    const block = currentBlock();
    // “Keep writing…” marks the ONE empty line the caret is in. Standing in
    // every empty line it was just grey decoration — and Enter kept copying it
    // onto each new paragraph. The caret leaving a line the click zone opened
    // and never used takes that line away too.
    const caretLine = caretLineBlock();
    // While a popup is open the caret is in ITS field, not in the document: the
    // line it left is where the popup will insert, so it has to stay.
    if (!hasActivePopup()) {
      pruneDraftLines(docEl, caretLine);
    }
    updateDraftHint(docEl, caretLine, t("Keep writing…"));
    // The handle follows the caret's nearest special block. It is updated SEPARATELY from
    // the top-level focus block: the caret can move between the “admonition body” ↔
    // nested tabs inside ONE top block — the handle has to move along.
    const handleBlk = caretHandleBlock();
    if (
      handleBlk &&
      handleBlk !== activeHandleBlock() &&
      !hasActivePopup() &&
      !blockDragActive() &&
      performance.now() - islandClickAt > 300
    ) {
      followCaret(handleBlk);
    }
    if (block !== lastFocusBlock) {
      lastFocusBlock?.removeAttribute("data-vfocus");
      block?.setAttribute("data-vfocus", "");
      // Leaving a block that is “catching up”: fetch the fresh render. BUT not while a
      // popup editor (an annotation and the like) is open: focus left the document for its field,
      // and the “catch-up” patch would replace the unfocused block — the reference to it
      // held by the open editor would go stale. Postpone until the popup closes.
      if (catchUpPending() && !hasActivePopup()) {
        scheduleSync(80);
      }
      // Leaving a block with annotations (while focused, the markers are literal text `(n)`
      // / `# (n)!`): restore the plus dots locally. The catch-up sync does not fire
      // here when the caret moves to an ADJACENT block, so we decorate it ourselves.
      const left = lastFocusBlock;
      if (
        left instanceof HTMLElement &&
        left.isConnected &&
        (isInlineCode(left) ||
          left.classList.contains("annotate") ||
          left.querySelector(".annotate"))
      ) {
        decorateAnnotations();
      }
      lastFocusBlock = block;
    }
    updateToolbarState();
    updateTableMenu();
    updateLinkChip();
    updateBubbleMenu();
  });
});

// The bubble menu is positioned in viewport coordinates (position: fixed) —
// on scroll it is recomputed so that it follows the selection.
window.addEventListener(
  "scroll",
  () => {
    if (bubbleShown()) updateBubbleMenu();
  },
  true,
);

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function updateToolbarState(): void {
  const inDoc = currentBlock() !== null;
  const states: [string, string][] = [
    ["tbBold", "bold"],
    ["tbItalic", "italic"],
    ["tbStrike", "strikeThrough"],
  ];
  for (const [id, command] of states) {
    const btn = document.getElementById(id);
    if (btn) {
      let on = false;
      try {
        on = inDoc && document.queryCommandState(command);
      } catch {
        on = false;
      }
      btn.classList.toggle("on", on);
    }
  }
  updateBlockButtons();
}

// ---------------------------------------------------------------------------
// The block drop-down buttons: “List” and “Paragraph style”
//
// Both work the way office editors do: the button label shows the caret's current
// state, the arrow opens the full list with the keyboard shortcuts,
// the active item is highlighted, and picking the active one again removes it (a list
// unfolds into paragraphs, a heading/quote turns into normal text).
// ---------------------------------------------------------------------------

// The command list itself: every entry runs something in this file, which is
// why it stays here. The rules around it — overrides, uniqueness, badges —
// live in keyBindings.ts.

const STYLE_COMMAND_GROUP = t("Paragraph and lists");

/** The full registry. The insert commands come from the component palette. */
function keyCommands(): KeyCommand[] {
  const fmt = t("Formatting");
  const list: KeyCommand[] = [
    { id: "format.bold", group: fmt, label: t("Bold"), def: { key: "B" }, run: () => cmd("bold") },
    {
      id: "format.italic",
      group: fmt,
      label: t("Italic"),
      def: { key: "I" },
      run: () => cmd("italic"),
    },
    {
      id: "format.underline",
      group: fmt,
      label: t("Underline"),
      def: { key: "U" },
      run: () => toggleUnderline(),
    },
    {
      id: "format.strike",
      group: fmt,
      label: t("Strikethrough"),
      def: { shift: true, key: "S" },
      run: () => cmd("strikeThrough"),
    },
    {
      id: "format.code",
      group: fmt,
      label: t("Code"),
      def: { shift: true, key: "M" },
      run: () => toggleInlineCode(),
    },
    {
      id: "format.link",
      group: fmt,
      label: t("Link"),
      def: { key: "K" },
      run: () => openLinkPopup(),
    },
    {
      id: "format.clear",
      group: fmt,
      label: t("Clear formatting"),
      def: { shift: true, key: "\\" },
      run: () => clearFormatting(),
    },
    {
      id: "edit.undo",
      group: t("Edit"),
      label: t("Undo"),
      def: { key: "Z" },
      run: () => undoOnce(),
    },
    {
      id: "edit.redo",
      group: t("Edit"),
      label: t("Redo"),
      def: { shift: true, key: "Z" },
      run: () => redoOnce(),
    },
    {
      id: "list.ul",
      group: STYLE_COMMAND_GROUP,
      label: LIST_NAME.ul,
      def: { shift: true, key: "8" },
      run: () => applyList("ul"),
    },
    {
      id: "list.ol",
      group: STYLE_COMMAND_GROUP,
      label: LIST_NAME.ol,
      def: { shift: true, key: "7" },
      run: () => applyList("ol"),
    },
    {
      id: "list.task",
      group: STYLE_COMMAND_GROUP,
      label: LIST_NAME.task,
      def: { shift: true, key: "6" },
      run: () => applyList("task"),
    },
    {
      id: "style.quote",
      group: STYLE_COMMAND_GROUP,
      label: t("Quote"),
      def: { shift: true, key: "9" },
      run: () => applyStyle("blockquote"),
    },
  ];
  for (const s of STYLE_ITEMS) {
    list.push({
      id: `style.${s.tag}`,
      group: STYLE_COMMAND_GROUP,
      label: s.label,
      def: { alt: true, key: s.key },
      run: () => applyStyle(s.tag),
    });
  }
  for (const item of componentInsertItems()) {
    if (item.id) {
      list.push({
        id: `insert.${item.id}`,
        group: t("Insert components"),
        label: item.label,
        def: item.key ?? null,
        run: () => runComponent(item),
      });
    }
  }
  return list;
}

// Toolbar button tooltips: the name plus the keyboard shortcut as a separate badge (as
// in Confluence). The shortcuts themselves live in the command registry, here there is only the
// “button → command” link; the spelling is platform-specific, so the labels are set
// from code, not in the markup.
const TOOLBAR_TIPS: Record<string, { tip: string; command?: string }> = {
  tbBold: { tip: t("Bold"), command: "format.bold" },
  tbItalic: { tip: t("Italic"), command: "format.italic" },
  tbUnder: { tip: t("Underline"), command: "format.underline" },
  tbStrike: { tip: t("Strikethrough"), command: "format.strike" },
  tbCode: { tip: t("Code"), command: "format.code" },
  tbMark: { tip: t("Highlight") },
  tbLink: { tip: t("Link"), command: "format.link" },
  tbClear: { tip: t("Clear formatting"), command: "format.clear" },
  tbUndo: { tip: t("Undo"), command: "edit.undo" },
  tbRedo: { tip: t("Redo"), command: "edit.redo" },
};

/** Assigns the toolbar buttons their tooltip and their link to a command. */
function applyToolbarTips(): void {
  for (const [id, info] of Object.entries(TOOLBAR_TIPS)) {
    const el = document.getElementById(id);
    if (!el) {
      continue;
    }
    el.removeAttribute("title"); // the slow native tooltip is not needed
    el.setAttribute("data-tip", info.tip);
    if (info.command) {
      el.setAttribute("data-key-command", info.command);
    }
  }
  refreshHotkeyLabels();
}

function wireToolbar(): void {
  const on = (id: string, fn: (e: Event) => void): void => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      e.preventDefault();
      fn(e);
    });
  };

  // Menu buttons must not take focus away from the document: execCommand is applied
  // to the caret, and the caret lives in the contenteditable.
  for (const id of ["tbStyle", "tbList", "tbListMenu"]) {
    document.getElementById(id)?.addEventListener("mousedown", (e) => e.preventDefault());
  }
  on("tbStyle", (e) => openStyleMenu(e.currentTarget as HTMLElement));
  on("tbList", () => applyList(toolbarListKind()));
  on("tbListMenu", () => openListMenu(document.getElementById("vtList") as HTMLElement));

  on("tbBold", () => cmd("bold"));
  on("tbItalic", () => cmd("italic"));
  on("tbUnder", () => toggleUnderline());
  on("tbStrike", () => cmd("strikeThrough"));
  on("tbCode", () => toggleInlineCode());
  on("tbMark", () => openMarkPalette());
  on("tbLink", () => openLinkPopup());
  on("tbClear", () => clearFormatting());
  on("tbComponent", (e) => openComponentMenu(e.target as HTMLElement));
  on("tbUndo", () => undoOnce());
  on("tbRedo", () => redoOnce());
  on("tbSettings", (e) => openEditorSettings(e.currentTarget as HTMLElement));
  on("tbTheme", () => toggleTheme());
  on("tbWidth", () => toggleWidth());
  on("tbSiteHead", () => toggleSiteChrome("header"));
  on("tbSiteNav", () => toggleSiteChrome("nav"));
  on("tbToc", () => toggleToc());
  on("tbAsText", () => api.postMessage({ type: "openAsText" }));
  on("tbSave", () => saveNow());
  document.getElementById("vOutsideReload")?.addEventListener("click", () => {
    showOutsideBar(false);
    api.postMessage({ type: "outsideChange", action: "reload" });
  });
  document.getElementById("vOutsideKeep")?.addEventListener("click", () => {
    showOutsideBar(false);
    api.postMessage({ type: "outsideChange", action: "keep" });
  });
  renderPinnedButtons();
  syncViewButtons();
  applyToolbarTips();
}
// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

docEl.addEventListener("keydown", (e) => {
  if (maybeOpenSlashMenu(e)) {
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  // Commands with keyboard shortcuts (formatting, lists, styles, insertion,
  // undo/redo) come from the registry: a shortcut can be reassigned in the settings.
  // The lookup is by e.code — in a non-Latin layout e.key yields the local letter, e.code the physical key.
  if (consumeHotKey(e)) {
    return;
  }
  // Ctrl/Cmd+Y is a second, non-disableable “redo” key (a Windows habit).
  if (mod && e.code === "KeyY") {
    claimKey(e);
    redoOnce();
    return;
  }
  // Cut/copy the WHOLE current block on the usual shortcuts when nothing is
  // selected: with a collapsed caret the browser does nothing, so no behaviour
  // is taken away. Pasting needs no key of its own — the clipboard carries the
  // block's HTML and Markdown, and the paste path rebuilds the block.
  // The physical key first (a non-Latin layout gives the local letter in e.key),
  // the letter as a fallback — an event synthesized by automation, and some
  // input methods, carry no e.code at all.
  const cutKey = e.code === "KeyX" || (e.code === "" && e.key.toLowerCase() === "x");
  const copyKey = e.code === "KeyC" || (e.code === "" && e.key.toLowerCase() === "c");
  if (mod && !e.shiftKey && !e.altKey && (cutKey || copyKey)) {
    const sel = document.getSelection();
    const collapsed = !sel || sel.rangeCount === 0 || sel.getRangeAt(0).collapsed;
    if (collapsed && (cutKey ? cutCurrentBlock() : copyCurrentBlock())) {
      claimKey(e);
      return;
    }
  }
  if (e.key === "Tab") {
    const cell = currentCell();
    if (cell) {
      e.preventDefault();
      moveCell(cell, e.shiftKey ? -1 : 1);
      return;
    }
    const inLi = caretListItem();
    if (inLi) {
      e.preventDefault();
      if (e.shiftKey) {
        outdentItem(inLi);
      } else {
        indentItem(inLi);
      }
      updateBlockButtons();
      return;
    }
    e.preventDefault();
    document.execCommand("insertText", false, "    ");
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    const cell = currentCell();
    if (cell) {
      // Enter in a cell is a line break INSIDE the cell (as in office editors); moving
      // between cells is Tab/Shift+Tab.
      e.preventDefault();
      insertCellBreak();
      return;
    }
    const inLi = caretListItem();
    const card = inLi ? gridCardOf(inLi) : null;
    if (card) {
      // Enter in a card is a new paragraph INSIDE the card. The browser's own
      // answer — splitting the list item — would mint a new card; a nested list
      // in a card is not affected (its <li> is the nearest one, not the card).
      e.preventDefault();
      const p = splitCardParagraph(card);
      if (p) {
        placeCaret(p);
      }
      return;
    }
    const block = currentBlock();
    if (block && /^H[1-6]$/.test(block.tagName) && caretAtEnd(block)) {
      // Enter at the end of a heading starts a new normal paragraph (as in office editors).
      e.preventDefault();
      const p = document.createElement("p");
      p.appendChild(document.createElement("br"));
      block.after(p);
      placeCaret(p);
      return;
    }
  }
  if (e.key === "Enter" && e.shiftKey && currentCell()) {
    // Shift+Enter in a cell is a line break too (the familiar combination).
    e.preventDefault();
    insertCellBreak();
  }
});

function caretAtEnd(block: Element): boolean {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
    return false;
  }
  const range = sel.getRangeAt(0);
  const probe = range.cloneRange();
  probe.selectNodeContents(block);
  probe.setStart(range.endContainer, range.endOffset);
  return probe.toString().trim() === "";
}

// A Cmd/Ctrl click on a link opens it in the browser/editor. A plain click on a
// footnote marker (or on its item in the rendered list) and on an abbreviation
// opens the corresponding editing popup.
docEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const fnRef = target.closest<HTMLElement>(
    ".footnote-ref[data-fn-label], li.footnote-item[data-fn-label]",
  );
  if (fnRef) {
    e.preventDefault();
    openFootnoteEdit(fnRef);
    return;
  }
  const abbr = target.closest<HTMLElement>("abbr[title]");
  if (abbr) {
    e.preventDefault();
    openAbbrEdit(abbr);
    return;
  }
  // An inline formula is a KaTeX render — there is nothing to place a caret in,
  // so a click opens its editor. A block formula is an island and keeps the
  // double-click, so that it can still be selected and dragged.
  const math = target.closest<HTMLElement>("span.arithmatex[data-tex]");
  if (math) {
    e.preventDefault();
    openInlineMathEdit(math);
    return;
  }
  if (target instanceof HTMLImageElement && !target.hasAttribute("data-emoji")) {
    e.preventDefault();
    openImagePopup(target);
    return;
  }
  const icon = target.closest<HTMLElement>("[data-emoji]");
  if (icon) {
    e.preventDefault();
    openIconPicker(icon);
    return;
  }
  const keys = target.closest<HTMLElement>("span.keys[data-keys]");
  if (keys) {
    e.preventDefault();
    openKeysPopup(keys);
    return;
  }
  const a = target.closest("a");
  if (a && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    api.postMessage({ type: "openLink", href: a.getAttribute("href") ?? "" });
    return;
  }
  // The dead zone of a tab set — its own padding and the gaps around the
  // panel are contenteditable=false. A click there used to move the caret
  // nowhere, silently: the user aims “after the button”, the caret stays in a
  // block they no longer look at, and the next insert lands THERE. Put the
  // caret into the nearest block of the open tab instead.
  const deadSet = target.closest<HTMLElement>(".tabbed-set");
  if (deadSet && !target.closest(".tabbed-block, .tabbed-labels, .vgctl")) {
    if (caretIntoTabAt(deadSet, e.clientY)) {
      return;
    }
  }
  // An island (a diagram, a block formula) never holds the caret, so the
  // handle cannot reach it through the selection — without this, a diagram
  // inside a tab could not be deleted at all. A click is the pointer we get.
  // The walk stops at the first editable region: a tab set is .visland too,
  // but a click inside its editable content belongs to the caret, and its
  // label row is the set's own chrome with controls of its own.
  const island = clickIsland(target);
  if (island) {
    islandClickAt = performance.now();
    activateBlock(island);
  }
});

/** The caret into the block of the OPEN tab nearest to the click, if any. */
function caretIntoTabAt(set: HTMLElement, clientY: number): boolean {
  const inputs = Array.from(set.querySelectorAll<HTMLInputElement>(':scope > input[type="radio"]'));
  const idx = Math.max(
    0,
    inputs.findIndex((i) => i.checked),
  );
  const panel = set.querySelectorAll<HTMLElement>(":scope > .tabbed-content > .tabbed-block")[idx];
  if (!panel) {
    return false;
  }
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const child of Array.from(panel.children)) {
    // Only a block that can hold the caret: islands and service controls cannot.
    if (
      !(child instanceof HTMLElement) ||
      child.classList.contains("vgctl") ||
      child.getAttribute("contenteditable") === "false"
    ) {
      continue;
    }
    const r = child.getBoundingClientRect();
    const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = child;
    }
  }
  if (!best) {
    return false;
  }
  placeCaret(best, clientY > best.getBoundingClientRect().top);
  return true;
}

function clickIsland(target: Element): HTMLElement | null {
  for (let cur: Element | null = target; cur && cur !== docEl; cur = cur.parentElement) {
    if (!(cur instanceof HTMLElement)) {
      continue;
    }
    if (cur.getAttribute("contenteditable") === "true" || cur.classList.contains("tabbed-labels")) {
      return null;
    }
    if (cur.classList.contains("visland") && cur.getAttribute("contenteditable") === "false") {
      return cur;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Instant tooltips: the native title pops up after a one-second delay and in a
// small font. For our own toolbar buttons we show our own plate right away.
// The title attribute is lazily moved into data-tip so that the native one does not duplicate it.
// ---------------------------------------------------------------------------

const tipEl = document.createElement("div");
tipEl.id = "vtip";
document.body.appendChild(tipEl);

const TIP_SCOPE =
  "#vt, .vpop, .vbubble, #vhandle, .vlive-bar, .tabbed-labels, .vcode-ln, .md-code__nav";

document.addEventListener("mouseover", (e) => {
  const from = e.target as HTMLElement | null;
  const holder = from?.closest?.("[data-tip], [title]") as HTMLElement | null;
  if (!holder || !holder.closest(TIP_SCOPE)) {
    hideTip();
    return;
  }
  const nativeTitle = holder.getAttribute("title");
  if (nativeTitle) {
    holder.setAttribute("data-tip", nativeTitle);
    holder.removeAttribute("title");
  }
  const text = holder.getAttribute("data-tip");
  if (!text) {
    hideTip();
    return;
  }
  tipEl.textContent = text;
  // The keyboard shortcut goes into a separate badge on the right (⌘⇧S / Ctrl+Shift+S).
  const hotkey = holder.getAttribute("data-tip-key");
  if (hotkey) {
    const badge = document.createElement("span");
    badge.className = "vtip-key";
    badge.textContent = hotkey;
    tipEl.appendChild(badge);
  }
  tipEl.classList.add("show");
  const rect = holder.getBoundingClientRect();
  // It is shown first to learn its dimensions, then positioned centered
  // under the button, without going outside the window edges.
  const width = tipEl.offsetWidth;
  let left = rect.left + window.scrollX + rect.width / 2 - width / 2;
  left = Math.max(
    6,
    Math.min(left, window.scrollX + document.documentElement.clientWidth - width - 6),
  );
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${rect.bottom + window.scrollY + 7}px`;
});

document.addEventListener("mouseout", (e) => {
  const to = e.relatedTarget as HTMLElement | null;
  if (!to || !to.closest?.("[data-tip]")) {
    hideTip();
  }
});
document.addEventListener("mousedown", hideTip);

function hideTip(): void {
  tipEl.classList.remove("show");
}

// Escape peels the interface one layer at a time, from the most temporary
// outwards: a drag in progress, then a popup (which handles its own), then the
// top annotation tip, then the top editor window — closed like “Done”, so
// nothing typed is lost by a reflex keypress. With nothing open it leaves the
// text and marks blocks, each press one container wider.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    saveNow();
    return;
  }
  if (e.key !== "Escape" || cancelBlockDrag() || hasActivePopup()) {
    return;
  }
  if (annotTips.length > 0) {
    closeAnnotationTips(annotTips.length - 1);
    return;
  }
  if (inSubEditor()) {
    closeSubEditor(true);
    return;
  }
  escalateBlock();
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

document.execCommand("defaultParagraphSeparator", false, "p");
initCodeBlockEdit({ findBlockByStart });
initKeyBindings({ commands: keyCommands, persistOverrides: persistUiConfig });
initAnnotations({
  docEl,
  post: (msg) => api.postMessage(msg),
  blocksInOrder,
  currentBlock,
  topBlockOf,
  caretIntoBlock,
  applyPatches,
  insertBlockEdit,
});
initMediaLinks({
  docEl,
  post: (msg) => api.postMessage(msg),
  activePage: () => activePage,
  chromeData: () => chromeData,
  enclosingTag,
  topBlockOf,
  ensureTrailingDraft,
  insertPoint,
  insertMarkdownBlock,
});
initPasteContent({ docEl, topBlockOf, insertMarkdownBlock });
initDeleteGuard(docEl);
initParagraphStyle({
  docEl,
  cmd,
  currentBlock,
  caretIntoBlock,
  rangedAncestor,
  enclosingTag,
  indentOfLine,
  replaceLines,
  selectionLines,
  selectionRange,
});
initInlineTools({
  docEl,
  cmd,
  openLinkPopup: () => openLinkPopup(),
  enclosingTag,
  topBlockOf,
  markDirtyAtSelection,
  bubbleEnabled: () => bubbleEnabled,
});
initSettingsUi({
  componentInsertItems,
  componentIconEl,
  isPinned: (id) => pinnedButtons.includes(id),
  setPinned: (id, pinned) => {
    pinnedButtons = pinned
      ? [...new Set([...pinnedButtons, id])]
      : pinnedButtons.filter((x) => x !== id);
    renderPinnedButtons();
  },
  inlineFormatting: () => inlineFormatting,
  setInlineFormatting: (mode) => {
    inlineFormatting = mode;
    applyInlineFormattingMode();
  },
  keyCommands,
  persistUiConfig,
});
initBlockHandle({
  docEl,
  topBlockOf,
  rangedAncestor,
  indentOfLine,
  replaceLines,
  insertMarkdownBlock,
  openIslandEditor,
  hideTip,
  renderQuickMenu,
  isInlineCode,
  codeMenuItems,
  fenceInfoOf,
});
wireToolbar();
restoreViewState();
prefetchComponentIcons();
api.postMessage({ type: "ready" });
