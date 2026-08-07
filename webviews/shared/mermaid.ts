// Diagrams, shared by the preview and the visual editor.
//
// The bundle is big and most pages have no diagram at all, so it is loaded on
// first sight of one and cached. Before drawing, the source is stashed in
// data-mermaid-src: mermaid replaces the node with SVG, and a scheme change has
// to rebuild the picture from the text.

declare const window: Window & {
  __mermaid?: { initialize: (o: unknown) => void; run: (o?: unknown) => Promise<void> };
};

export interface MermaidConfig {
  /** Address of the bundle inside the webview; empty means diagrams are off. */
  mermaidUri: string;
  /** The CSP nonce of this webview — without it the script is refused. */
  nonce?: string;
}

let config: MermaidConfig = { mermaidUri: "" };
let loading: Promise<void> | undefined;

export function initMermaid(next: MermaidConfig): void {
  config = next;
}

/**
 * A diagram can only be drawn where it can be measured. Mermaid lays text out
 * through the live DOM; inside display:none (an unopened tab, a collapsed
 * call-out) every measure comes back empty, mermaid draws its “Syntax error in
 * text” bomb instead — and data-processed pins the wreck even after the tab is
 * opened. Hidden diagrams are left undrawn; watchMermaidReveal draws them the
 * moment their container opens.
 */
function isRevealed(el: HTMLElement): boolean {
  for (let cur: HTMLElement | null = el; cur && cur !== document.body; cur = cur.parentElement) {
    if (getComputedStyle(cur).display === "none") {
      return false;
    }
    if (cur instanceof HTMLDetailsElement && !cur.open) {
      return false;
    }
  }
  return true;
}

/** Draws every diagram of `root` that has not been drawn yet. */
export async function renderMermaid(root: ParentNode): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".mermaid")).filter(
    (block) => !block.hasAttribute("data-processed") && isRevealed(block),
  );
  if (blocks.length === 0 || !config.mermaidUri) {
    return;
  }
  for (const block of blocks) {
    if (!block.hasAttribute("data-mermaid-src")) {
      block.setAttribute("data-mermaid-src", block.textContent ?? "");
    }
  }
  await ensureMermaid();
  try {
    const scheme = document.body.getAttribute("data-md-color-scheme");
    window.__mermaid?.initialize({
      startOnLoad: false,
      theme: scheme === "slate" ? "dark" : "default",
    });
    // In the visual editor these mutations happen inside islands
    // (contenteditable=false), which the edit observer ignores — no muting needed.
    await window.__mermaid?.run({ nodes: blocks });
  } catch {
    /* a malformed diagram — the original text stays */
  }
}

/**
 * Draws deferred diagrams when their container opens: a tab switch flips a
 * radio (change bubbles), a call-out unfolds its details (toggle does not
 * bubble — captured instead). Cheap to leave on: renderMermaid exits at once
 * when every visible diagram is already drawn.
 */
export function watchMermaidReveal(root: HTMLElement): void {
  const redraw = (): void => void renderMermaid(root);
  root.addEventListener("change", redraw);
  root.addEventListener("toggle", redraw, true);
}

/** Redraws the diagrams already on screen: they carry the colours of the old scheme. */
export async function reRenderMermaidTheme(root: ParentNode): Promise<void> {
  const drawn = Array.from(root.querySelectorAll<HTMLElement>(".mermaid[data-processed]"));
  if (drawn.length === 0) {
    return;
  }
  for (const block of drawn) {
    const src = block.getAttribute("data-mermaid-src");
    if (src !== null) {
      block.removeAttribute("data-processed");
      block.textContent = src; // restore the source — renderMermaid draws it again
    }
  }
  await renderMermaid(root);
}

/** Loads the bundle once; every later call awaits the same promise. */
export function ensureMermaid(): Promise<void> {
  if (window.__mermaid) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = config.mermaidUri;
      if (config.nonce) {
        script.setAttribute("nonce", config.nonce);
      }
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("mermaid load failed"));
      document.head.appendChild(script);
    });
  }
  return loading;
}

/**
 * The project's own stylesheet (extra_css). Each webview keeps it under an id of
 * its own so the two never fight over one tag.
 */
export function applyExtraCss(css: string, id: string): void {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
