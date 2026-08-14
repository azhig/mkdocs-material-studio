// Diagrams, shared by the preview and the visual editor.
//
// The bundle is big and most pages have no diagram at all, so it is loaded on
// first sight of one and cached. Before drawing, the source is stashed in
// data-mermaid-src: mermaid replaces the node with SVG, and a scheme change has
// to rebuild the picture from the text.

declare const window: Window & {
  __mermaid?: { initialize: (o: unknown) => void; run: (o?: unknown) => Promise<void> };
  __plantuml?: {
    renderToString: (
      lines: string[],
      onSuccess: (svg: string) => void,
      onError: (message: string) => void,
      // Undocumented but present since the engine's first npm release: without
      // it a diagram is drawn in near-black ink, unreadable on a dark page.
      options?: { dark?: boolean },
    ) => void;
  };
};

import { mermaidTheme, readDiagramColors, type MermaidTheme } from "./diagramTheme";

export interface MermaidConfig {
  /** Address of the bundle inside the webview; empty means diagrams are off. */
  mermaidUri: string;
  /** Addresses of the local PlantUML engine and its Graphviz runtime. */
  plantumlUri?: string;
  plantumlVizUri?: string;
  /** The CSP nonce of this webview — without it the script is refused. */
  nonce?: string;
}

let config: MermaidConfig = { mermaidUri: "" };
let loading: Promise<void> | undefined;
let plantUmlLoading: Promise<void> | undefined;
let plantUmlQueue = Promise.resolve();

/**
 * Drawn diagrams by source. Every keystroke in the document replaces the whole
 * markup of the preview, so without this the TeaVM engine would redraw every
 * diagram of the page on every edit — seconds of work for a picture that has
 * not changed. Bounded: an SVG is large, and editing a diagram produces a new
 * source (and a new entry) on every keystroke.
 */
const plantUmlCache = new Map<string, string>();
const PLANTUML_CACHE_LIMIT = 16;

function cachePlantUml(key: string, svg: string): void {
  plantUmlCache.set(key, svg);
  for (const oldest of plantUmlCache.keys()) {
    if (plantUmlCache.size <= PLANTUML_CACHE_LIMIT) {
      break;
    }
    plantUmlCache.delete(oldest); // insertion order — the oldest entry goes first
  }
}

export function initMermaid(next: MermaidConfig): void {
  config = next;
  // The cache belongs to the engine these addresses point at: a new
  // configuration is a new panel, and pictures drawn by the previous one are no
  // longer ours to hand out.
  plantUmlCache.clear();
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
    window.__mermaid?.initialize(mermaidConfig());
    // In the visual editor these mutations happen inside islands
    // (contenteditable=false), which the edit observer ignores — no muting needed.
    await window.__mermaid?.run({ nodes: blocks });
  } catch {
    /* a malformed diagram — the original text stays */
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    if (config.nonce) {
      script.setAttribute("nonce", config.nonce);
    }
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`diagram runtime load failed: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Loads the official browser-native PlantUML engine once, with no server or
 * Java. A failed load is forgotten rather than cached: one lost script would
 * otherwise leave the panel without diagrams until it is recreated.
 */
export function ensurePlantUml(): Promise<void> {
  if (window.__plantuml) {
    return Promise.resolve();
  }
  if (!plantUmlLoading) {
    plantUmlLoading = (async () => {
      if (!config.plantumlUri || !config.plantumlVizUri) {
        throw new Error("PlantUML runtime is unavailable");
      }
      await loadScript(config.plantumlVizUri);
      await loadScript(config.plantumlUri);
    })().catch((e: unknown) => {
      plantUmlLoading = undefined;
      throw e;
    });
  }
  return plantUmlLoading;
}

/**
 * A diagram PlantUML cannot read comes back as a picture, not as an error: a
 * “PlantUML version …” page with the parser's complaint drawn inside it. Shown
 * as it is, it looks like the diagram the author wrote — so it is turned back
 * into the error the engine should have reported. Both marks are required: a
 * diagram is free to contain either phrase as ordinary text.
 */
function engineComplaint(svg: string): string | undefined {
  if (!svg.includes("PlantUML version")) {
    return undefined;
  }
  const complaint = /Syntax Error\?[^<]*|Diagram not supported[^<]*/.exec(svg);
  return complaint?.[0].trim();
}

function checked(svg: string): string {
  const complaint = engineComplaint(svg);
  if (complaint) {
    throw new Error(complaint);
  }
  return svg;
}

/** The page's colour scheme, which the engine draws the diagram for. */
function isDark(): boolean {
  return document.body.getAttribute("data-md-color-scheme") === "slate";
}

/**
 * What mermaid is initialized with, here and in the diagram dialog: the page's
 * own colours, so a diagram looks like a block of this site and not like a
 * picture pasted onto it.
 */
export function mermaidConfig(): MermaidTheme {
  return mermaidTheme(
    readDiagramColors(),
    isDark(),
    getComputedStyle(document.body).fontFamily || undefined,
  );
}

/** Renders through a serialized queue: the PlantUML TeaVM engine has shared state. */
export function renderPlantUmlSource(source: string): Promise<string> {
  const dark = isDark();
  // The same source is two different pictures, one per scheme.
  const key = `${dark ? "dark" : "light"}\n${source}`;
  const done = plantUmlCache.get(key);
  if (done !== undefined) {
    return Promise.resolve().then(() => checked(done));
  }
  const render = async (): Promise<string> => {
    const drawn = plantUmlCache.get(key);
    if (drawn !== undefined) {
      return checked(drawn); // an identical diagram was drawn while this one waited
    }
    await ensurePlantUml();
    const svg = await new Promise<string>((resolve, reject) => {
      const engine = window.__plantuml;
      if (!engine) {
        // The scripts loaded but the global is missing. Settling here is the
        // whole point: an unsettled promise would hold the queue — and every
        // diagram behind it — forever, with nothing on screen to explain it.
        reject(new Error("PlantUML runtime did not start"));
        return;
      }
      engine.renderToString(
        source.split(/\r\n|\r|\n/),
        resolve,
        (message) => reject(new Error(message)),
        { dark },
      );
    });
    // Cached before the check: a diagram the engine refuses must not be sent
    // through it again on every redraw of the page.
    cachePlantUml(key, svg);
    return checked(svg);
  };
  const result = plantUmlQueue.then(render);
  // The tail of the queue is always a fulfilled promise: a diagram the engine
  // refused must not stop the ones behind it.
  plantUmlQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Draws PlantUML fences locally while retaining their source for serialization. */
export async function renderPlantUml(root: ParentNode): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".plantuml")).filter(
    (block) => !block.hasAttribute("data-processed") && isRevealed(block),
  );
  if (blocks.length === 0 || !config.plantumlUri || !config.plantumlVizUri) {
    return;
  }
  for (const block of blocks) {
    const source = block.getAttribute("data-plantuml-src") ?? block.textContent ?? "";
    block.setAttribute("data-plantuml-src", source);
    try {
      const svg = await renderPlantUmlSource(source);
      if (!block.isConnected) {
        continue; // the page was re-rendered while the engine worked — this node is gone
      }
      block.innerHTML = svg;
      block.removeAttribute("data-render-error");
      block.removeAttribute("title");
      block.setAttribute("data-processed", "true");
    } catch (e) {
      if (!block.isConnected) {
        continue;
      }
      block.textContent = source;
      // The marker draws the block as refused (fallback.css); the engine's own
      // words go into the tooltip — they are the only clue to what is wrong.
      block.setAttribute("data-render-error", "true");
      block.setAttribute("title", errorText(e));
    }
  }
}

/** The engine's message, first line only: it likes to append its whole context. */
function errorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split("\n")[0].trim() || "PlantUML: rendering failed";
}

/** Draws both diagram languages supported by the editor. */
export async function renderDiagrams(root: ParentNode): Promise<void> {
  await Promise.all([renderPlantUml(root), renderMermaid(root)]);
}

/**
 * Draws deferred diagrams when their container opens: a tab switch flips a
 * radio (change bubbles), a call-out unfolds its details (toggle does not
 * bubble — captured instead). Cheap to leave on: renderMermaid exits at once
 * when every visible diagram is already drawn.
 */
export function watchMermaidReveal(root: HTMLElement): void {
  const redraw = (): void => void renderDiagrams(root);
  root.addEventListener("change", redraw);
  root.addEventListener("toggle", redraw, true);
}

/**
 * Redraws the diagrams already on screen: their SVG carries the colours of the
 * scheme that has just been left. Both engines draw in ink of their own —
 * PlantUML's near-black lines are all but invisible on a dark page.
 */
export async function reRenderDiagramTheme(root: ParentNode): Promise<void> {
  const restore = (selector: string, attribute: string): number => {
    const drawn = Array.from(root.querySelectorAll<HTMLElement>(selector));
    for (const block of drawn) {
      const src = block.getAttribute(attribute);
      if (src !== null) {
        block.removeAttribute("data-processed");
        block.textContent = src; // restore the source — the render draws it again
      }
    }
    return drawn.length;
  };
  const mermaid = restore(".mermaid[data-processed]", "data-mermaid-src");
  const plantuml = restore(".plantuml[data-processed]", "data-plantuml-src");
  if (mermaid === 0 && plantuml === 0) {
    return;
  }
  await renderDiagrams(root);
}

/**
 * Loads the bundle once; every later call awaits the same promise. A failed
 * load is forgotten, so a next attempt may still succeed.
 */
export function ensureMermaid(): Promise<void> {
  if (window.__mermaid) {
    return Promise.resolve();
  }
  if (!loading) {
    loading = loadScript(config.mermaidUri).catch((e: unknown) => {
      loading = undefined;
      throw e;
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
