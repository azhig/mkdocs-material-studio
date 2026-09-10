/**
 * “Find on this page” for both webviews — the bar, the keys and the highlight.
 *
 * A webview gets no browser find of its own: Ctrl/Cmd+F arrives as a plain
 * keystroke and nothing happens, which is why reading and editing here had no
 * search at all. This is that search, and it is one implementation for the
 * preview and the visual editor, because a reader who learns it in one expects
 * it in the other.
 *
 * The highlight goes through the CSS Custom Highlight API, and that is the
 * point of the module: it paints ranges without inserting a single node. In the
 * visual editor a `<mark>` around a hit would be an edit of the author's file —
 * the MutationObserver would see it, the block would be serialized with the
 * markup in it, and searching a document would rewrite it. Where the API is
 * missing the bar still counts and still scrolls; only the colour is lost.
 */

import { t } from "./i18n";
import { findMatches, firstMatchFrom, stepMatch, type FindMatch } from "./findModel";
import { chunkTexts, collectChunks, rangeOfMatch, revealMatch, type TextChunk } from "./findText";

export interface FindBarHost {
  /** The subtree to search. */
  root: () => HTMLElement;
  /** The box that scrolls, or null when the page itself does. */
  scroller: () => HTMLElement | null;
  /** How far down the bar hangs — below the toolbar, which is sticky. */
  topOffset: () => number;
  /**
   * Runs a DOM change the finder had to make (opening a folded call-out). The
   * editor passes its “this was not the author” wrapper; the preview omits it.
   */
  apply?: (change: () => void) => void;
  /** Whether the module binds Cmd/Ctrl+F itself (the editor routes it through its own registry). */
  bindOpenKey?: boolean;
  /** Called after the bar closes, so the editor can take the caret back. */
  onClose?: () => void;
}

export interface FindBar {
  open: () => void;
  close: () => void;
  /** Recounts the matches — the document under the bar has changed. */
  refresh: () => void;
  isOpen: () => boolean;
}

const ALL = "mkdocs-find";
const CURRENT = "mkdocs-find-current";
/** Typing redraws the editor's blocks; recounting on every keystroke is wasted work. */
const REFRESH_DELAY_MS = 120;

export function initFindBar(host: FindBarHost): FindBar {
  const bar = document.createElement("div");
  bar.className = "mkfind";
  bar.hidden = true;
  bar.innerHTML = `
<span class="codicon codicon-search mkfind-ico"></span>
<input class="mkfind-q" type="text" spellcheck="false" />
<span class="mkfind-count"></span>
<button class="mkfind-opt" data-opt="case">Aa</button>
<button class="mkfind-opt" data-opt="word">ab</button>
<button class="mkfind-act" data-act="prev"><span class="codicon codicon-arrow-up"></span></button>
<button class="mkfind-act" data-act="next"><span class="codicon codicon-arrow-down"></span></button>
<button class="mkfind-act" data-act="close"><span class="codicon codicon-close"></span></button>`;
  const input = bar.querySelector<HTMLInputElement>(".mkfind-q") as HTMLInputElement;
  const counter = bar.querySelector<HTMLElement>(".mkfind-count") as HTMLElement;
  const optCase = bar.querySelector<HTMLElement>('[data-opt="case"]') as HTMLElement;
  const optWord = bar.querySelector<HTMLElement>('[data-opt="word"]') as HTMLElement;
  input.placeholder = t("Find");
  optCase.title = t("Match case");
  optWord.title = t("Whole word");
  (bar.querySelector('[data-act="prev"]') as HTMLElement).title = t("Previous match (Shift+Enter)");
  (bar.querySelector('[data-act="next"]') as HTMLElement).title = t("Next match (Enter)");
  (bar.querySelector('[data-act="close"]') as HTMLElement).title = t("Close (Esc)");
  document.body.appendChild(bar);

  let chunks: TextChunk[] = [];
  let matches: FindMatch[] = [];
  let current = -1;
  let caseSensitive = false;
  let wholeWord = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  function isOpen(): boolean {
    return !bar.hidden;
  }

  function place(): void {
    bar.style.top = `${host.topOffset()}px`;
  }

  /** Recounts from the page as it now is, staying on the match nearest to where we were. */
  function recount(keepAt = matches[current]?.start ?? -1): void {
    chunks = collectChunks(host.root());
    matches = findMatches(chunkTexts(chunks), input.value, { caseSensitive, wholeWord });
    current = keepAt >= 0 ? firstMatchFrom(matches, keepAt) : matches.length > 0 ? 0 : -1;
    paint();
    showCount();
  }

  function showCount(): void {
    const empty = input.value === "";
    counter.textContent = empty
      ? ""
      : matches.length === 0
        ? t("No results")
        : t("{0} of {1}", current + 1, matches.length);
    bar.classList.toggle("mkfind-empty", !empty && matches.length === 0);
  }

  /** Repaints both highlights: every match, and the one the reader is on. */
  function paint(): void {
    const registry = window.CSS?.highlights;
    if (!registry) {
      return;
    }
    registry.delete(ALL);
    registry.delete(CURRENT);
    if (matches.length === 0) {
      return;
    }
    const ranges: Range[] = [];
    let currentRange: Range | null = null;
    for (let i = 0; i < matches.length; i++) {
      const range = rangeOfMatch(chunks, matches[i]);
      if (!range) {
        continue;
      }
      if (i === current) {
        currentRange = range;
      } else {
        ranges.push(range);
      }
    }
    if (ranges.length > 0) {
      registry.set(ALL, new Highlight(...ranges));
    }
    if (currentRange) {
      const highlight = new Highlight(currentRange);
      highlight.priority = 1;
      registry.set(CURRENT, highlight);
    }
  }

  /** Moves to a match: opens whatever hides it, scrolls it into view, repaints. */
  function go(index: number): void {
    if (index < 0 || matches.length === 0) {
      return;
    }
    current = index;
    const range = rangeOfMatch(chunks, matches[current]);
    const node = range?.startContainer;
    if (node) {
      const reveal = (): void => void revealMatch(node, host.root());
      if (host.apply) {
        host.apply(reveal);
      } else {
        reveal();
      }
    }
    paint();
    showCount();
    if (range) {
      scrollTo(range);
    }
  }

  /**
   * Brings the range into view. The bar covers the top of the page, so “visible”
   * starts below it — otherwise the first match of a page found itself right
   * under the toolbar and looked like no match at all.
   */
  function scrollTo(range: Range): void {
    const rect = range.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) {
      return; // a match inside something that still has no layout
    }
    const box = host.scroller();
    const view = box
      ? box.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const top = Math.max(view.top, bar.getBoundingClientRect().bottom) + 24;
    const bottom = view.bottom - 24;
    if (rect.top >= top && rect.bottom <= bottom) {
      return;
    }
    const delta = rect.top - (top + Math.max(0, bottom - top) / 3);
    if (box) {
      box.scrollTop += delta;
    } else {
      window.scrollBy(0, delta);
    }
  }

  function open(): void {
    if (bar.hidden) {
      bar.hidden = false;
      // A selection is what the reader usually means to look for.
      const selected = (document.getSelection()?.toString() ?? "").trim();
      if (selected !== "" && !selected.includes("\n")) {
        input.value = selected;
      }
    }
    place();
    input.focus();
    input.select();
    recount(-1);
    if (current >= 0) {
      go(current);
    }
  }

  function close(): void {
    if (bar.hidden) {
      return;
    }
    bar.hidden = true;
    window.CSS?.highlights?.delete(ALL);
    window.CSS?.highlights?.delete(CURRENT);
    matches = [];
    chunks = [];
    current = -1;
    host.onClose?.();
  }

  function step(dir: 1 | -1): void {
    if (matches.length === 0) {
      return;
    }
    go(stepMatch(current, matches.length, dir));
  }

  input.addEventListener("input", () => {
    recount(-1);
    if (current >= 0) {
      go(current);
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    // Typing in the bar is not typing in the document: the editor's own
    // shortcuts (bold, lists, the slash menu) must not see these keys.
    e.stopPropagation();
  });
  // Keeping the focus in the field is what lets Enter work right after a click
  // on “next”, and in the editor it keeps the caret's selection alive.
  bar.addEventListener("mousedown", (e) => {
    if (e.target !== input) {
      e.preventDefault();
    }
  });
  bar.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest("button");
    if (!button) {
      return;
    }
    const act = button.getAttribute("data-act");
    const opt = button.getAttribute("data-opt");
    if (act === "next" || act === "prev") {
      step(act === "next" ? 1 : -1);
    } else if (act === "close") {
      close();
    } else if (opt) {
      if (opt === "case") {
        caseSensitive = !caseSensitive;
        optCase.classList.toggle("on", caseSensitive);
      } else {
        wholeWord = !wholeWord;
        optWord.classList.toggle("on", wholeWord);
      }
      recount(-1);
      if (current >= 0) {
        go(current);
      }
      input.focus();
    }
  });

  document.addEventListener(
    "keydown",
    (e) => {
      const mod = e.metaKey || e.ctrlKey;
      // The physical key first (a non-Latin layout gives the local letter in
      // e.key), the letter as a fallback — a synthesized keystroke carries no
      // e.code at all.
      const findKey = e.code === "KeyF" || (e.code === "" && e.key.toLowerCase() === "f");
      if (host.bindOpenKey !== false && mod && !e.altKey && findKey) {
        e.preventDefault();
        // VS Code replays a webview's keystrokes as its own commands unless the
        // event stops here — see claimKey() in the editor's key registry.
        e.stopPropagation();
        open();
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        e.stopPropagation();
        if (bar.hidden) {
          open();
        } else {
          step(e.shiftKey ? -1 : 1);
        }
        return;
      }
      if (e.key === "Escape" && !bar.hidden) {
        // Nothing below gets the key: in the editor Escape also peels off a
        // block selection, and closing the search must not do both at once.
        e.stopPropagation();
        close();
      }
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (!bar.hidden) {
      place();
    }
  });

  return {
    open,
    close,
    isOpen,
    refresh: () => {
      if (bar.hidden) {
        return;
      }
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (!bar.hidden) {
          recount();
        }
      }, REFRESH_DELAY_MS);
    },
  };
}
