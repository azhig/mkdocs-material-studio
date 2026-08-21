// The visual editor's dev harness: it emulates the VS Code provider right in the
// browser. The document lives in memory, and the protocol is the same as
// VisualEditorProvider's (render / sync / synced / rejected). The panel at the
// bottom shows the document's current text and a log of the edits — handy for
// checking that the diffs stay minimal.
//
// Loaded BEFORE visual.js; it replaces acquireVsCodeApi.

import { buildMarkdownEngine } from "../../src/preview/markdownEngine";
import { rewriteHtmlAssetUrls } from "../../src/core/assetUrls";

interface SyncEdit {
  start: number;
  end: number;
  text: string;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void };
    __buildEngine?: () => { render: (src: string) => string };
    __harness?: {
      load: (text: string) => void;
      outside: (text: string) => void;
      getText: () => string;
      getFile: () => string;
      extraCss: (css: string) => void;
    };
  }
}

/** Where the pages come from: the sample project, served by the harness server. */
const DOCS = "/samples/demo/docs/";
/** The page the harness opens with; ?page=… picks another one. */
const START_PAGE = "guide/writing.md";

// Shown until the sample project answers — and if it does not (the harness may
// be served from somewhere else), this stays as the document.
const INITIAL = `# Sample project not found

The harness reads the pages of \`samples/demo\` over HTTP. Run it from the
repository root:

\`\`\`bash
npm run harness
\`\`\`
`;

let text = INITIAL;
let version = 1;
let toWebview: ((msg: unknown) => void) | null = null;
// We emulate the VS Code UI settings (the harness has no real config).
const uiConfig: {
  inlineFormatting: string;
  toolbarButtons: string[];
  keybindings: Record<string, string>;
} = {
  inlineFormatting: "both",
  toolbarButtons: ["table", "image", "code", "hr"],
  keybindings: {},
};

const logEl = (): HTMLElement | null => document.getElementById("hlog");
const docViewEl = (): HTMLElement | null => document.getElementById("hdoc");

function log(line: string): void {
  const el = logEl();
  if (el) {
    el.textContent = `${line}\n` + (el.textContent ?? "");
  }
}

function refreshDocView(): void {
  const el = docViewEl();
  if (el) {
    el.textContent = text;
  }
}

function lineRange(startLine: number, endLine: number): [number, number] {
  // The [start, end) offsets in characters for replacing lines [startLine, endLine).
  const lines = text.split("\n");
  const lineCount = lines.length;
  const clampStart = Math.max(0, Math.min(startLine, Math.max(0, lineCount - 1)));
  let startOffset = 0;
  for (let i = 0; i < clampStart; i++) {
    startOffset += lines[i].length + 1;
  }
  if (endLine >= lineCount) {
    return [startOffset, text.length];
  }
  let endOffset = 0;
  for (let i = 0; i < endLine; i++) {
    endOffset += lines[i].length + 1;
  }
  return [startOffset, endOffset];
}

function applyEdits(edits: SyncEdit[]): void {
  // We apply the independent edits from the bottom up so the offsets do not drift.
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (const e of sorted) {
    if (e.start === e.end && e.text !== "") {
      const lines = text.split("\n");
      if (e.start >= lines.length) {
        text = text + e.text;
      } else {
        const [off] = lineRange(e.start, e.start);
        text = text.slice(0, off) + e.text + text.slice(off);
      }
      log(`insert @${e.start}: ${JSON.stringify(e.text).slice(0, 80)}`);
    } else if (e.text === "") {
      const [a, b] = lineRange(e.start, e.end);
      log(`delete @${e.start}-${e.end}: ${JSON.stringify(text.slice(a, b)).slice(0, 80)}`);
      text = text.slice(0, a) + text.slice(b);
    } else {
      const [a, b] = lineRange(e.start, e.end);
      let replacement = e.text;
      if (e.end >= text.split("\n").length) {
        replacement = replacement.replace(/\n$/, "");
      }
      log(`replace @${e.start}-${e.end}: ${JSON.stringify(replacement).slice(0, 80)}`);
      text = text.slice(0, a) + replacement + text.slice(b);
    }
    version++;
  }
}

// The site header and the left panel. In the extension this is read out of
// mkdocs.yml; here it repeats the nav of samples/demo by hand, so the harness
// shows the same site the sample project describes.
const chrome = { header: true, nav: true };
let activePage = START_PAGE;
const SITE_CHROME = {
  siteName: "Aurora Docs",
  repoUrl: "https://github.com/example/aurora",
  repoName: "example/aurora",
  tabs: true,
  nav: [
    { kind: "page" as const, title: "Home", path: "index.md" },
    {
      kind: "section" as const,
      title: "Getting started",
      children: [
        { kind: "page" as const, title: "Installation", path: "getting-started/installation.md" },
        { kind: "page" as const, title: "Configuration", path: "getting-started/configuration.md" },
      ],
    },
    {
      kind: "section" as const,
      title: "Guide",
      children: [
        { kind: "page" as const, title: "Writing", path: "guide/writing.md" },
        { kind: "page" as const, title: "Diagrams and images", path: "guide/diagrams.md" },
        {
          kind: "section" as const,
          title: "Advanced",
          children: [
            {
              kind: "page" as const,
              title: "Annotations and notes",
              path: "guide/advanced/annotations.md",
            },
          ],
        },
      ],
    },
    {
      kind: "section" as const,
      title: "Reference",
      children: [
        { kind: "page" as const, title: "API", path: "reference/api.md" },
        { kind: "page" as const, title: "Questions and answers", path: "reference/faq.md" },
      ],
    },
    { kind: "link" as const, title: "Project site", href: "https://example.com" },
  ],
};

function sendSiteChrome(): void {
  toWebview?.({ type: "chromeState", ...chrome });
  toWebview?.({ type: "siteChrome", data: SITE_CHROME });
  toWebview?.({ type: "siteActive", active: activePage });
}

/**
 * Media links of a page point at files next to it (`../assets/scheme.svg`). In
 * the extension FallbackRenderer turns them into webview addresses; here the
 * pages are served over HTTP, so the same paths are resolved against the URL of
 * the page being shown.
 *
 * Through the same function the provider uses, and not a regular expression of
 * our own: it is the one that leaves the author's path in `data-md-src`, and
 * the editor reads that when it writes an image back. A harness that forgot to
 * would fake a bug the extension does not have — and hide the one it does.
 */
function resolveMedia(html: string): string {
  const base = `${location.origin}${DOCS}${activePage}`;
  return rewriteHtmlAssetUrls(html, (target) => {
    // The anchor rides along, the same way the extension keeps it: an image
    // marked `#only-dark` is hidden by Material's own stylesheet, and a stand
    // that dropped it would show both images of a theme pair at once.
    const url = new URL(target, base);
    return url.pathname + url.hash;
  });
}

/** Loads a page of the sample project. */
async function loadPage(rel: string): Promise<void> {
  try {
    const res = await fetch(DOCS + rel);
    if (!res.ok) {
      throw new Error(String(res.status));
    }
    text = await res.text();
    fileText = text; // the page as the "file" has it: a fresh page has no draft
    unsaved = false;
    activePage = rel;
    version++;
    render("render");
    toWebview?.({ type: "saveState", unsaved: false });
    toWebview?.({ type: "siteActive", active: activePage });
  } catch (err) {
    log(`could not read ${rel}: ${String(err)}`);
  }
}

/** The stand's file, and whether the page has anything the file does not. */
let fileText = "";
let unsaved = false;

/** An edit to the file made by somebody else — the console calls this. */
function editFromOutside(next: string): void {
  fileText = next;
  if (!unsaved) {
    text = next;
    version++;
    render("synced");
    return;
  }
  toWebview?.({ type: "outsideChange" });
}

function render(kind: "render" | "synced"): void {
  const engine = window.__buildEngine?.();
  if (!engine || !toWebview) {
    return;
  }
  toWebview({
    type: kind,
    html: resolveMedia(engine.render(text)),
    text,
    version,
    // The palette of samples/demo/mkdocs.yml.
    palette: {
      light: { primary: "deep-purple", accent: "amber" },
      dark: { primary: "deep-purple", accent: "amber" },
    },
    // mkdocsStudio.pageBackground — “material” by default; “editor” is checked
    // by flipping data-vs-bg by hand in the console.
    background: "material",
  });
  refreshDocView();
}

function handleFromWebview(msg: unknown): void {
  const m = msg as { type?: string; [k: string]: unknown };
  switch (m.type) {
    case "ready":
      render("render");
      toWebview?.({ type: "saveState", unsaved });
      sendSiteChrome();
      void start();
      break;
    case "setChrome":
      // Emulating the VS Code settings: the provider would store them and reply
      // with chromeState.
      if (typeof m.header === "boolean") chrome.header = m.header;
      if (typeof m.nav === "boolean") chrome.nav = m.nav;
      toWebview?.({ type: "chromeState", ...chrome });
      break;
    case "openPage":
      // The extension opens the file in the same editor; the harness reads it
      // over HTTP — the navigation is live, links and tabs included.
      log(`openPage: ${String(m.path)}`);
      void loadPage(String(m.path));
      break;
    case "renderSub": {
      // The annotation editor's fragment render: the text lives in the webview,
      // the harness (like the provider) only renders it.
      const engine = window.__buildEngine?.();
      if (engine) {
        toWebview?.({ type: "subRendered", id: m.id, html: engine.render(String(m.text ?? "")) });
      }
      break;
    }
    case "sync": {
      const base = Number(m.baseVersion);
      if (base !== version) {
        log(`sync REJECTED: base=${base}, current=${version}`);
        toWebview?.({ type: "rejected", version });
        render("render");
        return;
      }
      const edits = (m.edits ?? []) as SyncEdit[];
      applyEdits(edits);
      // Like the provider: typing changes the page, not the file. The stand
      // keeps a "file" of its own so the difference shows here too.
      unsaved = unsaved || edits.length > 0;
      render("synced");
      toWebview?.({ type: "saveState", unsaved });
      break;
    }
    case "save": {
      fileText = text;
      unsaved = false;
      log(`save: ${text.length} characters written to the file`);
      toWebview?.({ type: "saveState", unsaved: false, justSaved: true });
      break;
    }
    case "outsideChange": {
      if (String(m.action) === "reload") {
        text = fileText;
        version++;
        unsaved = false;
        toWebview?.({ type: "saveState", unsaved: false });
        render("render");
      } else {
        fileText = text; // keeping the page: the next save writes over the file
        toWebview?.({ type: "saveState", unsaved: true });
      }
      break;
    }
    case "setConfig": {
      // Emulating writing the settings into the VS Code config: we store them
      // and reflect them back with a uiConfig message (the way the provider
      // would via onDidChangeConfiguration).
      if (typeof m.inlineFormatting === "string") uiConfig.inlineFormatting = m.inlineFormatting;
      if (Array.isArray(m.toolbarButtons)) uiConfig.toolbarButtons = m.toolbarButtons as string[];
      if (m.keybindings && typeof m.keybindings === "object") {
        uiConfig.keybindings = m.keybindings as Record<string, string>;
      }
      log(`setConfig: ${JSON.stringify(m).slice(0, 120)}`);
      toWebview?.({ type: "uiConfig", ...uiConfig });
      break;
    }
    case "saveImage": {
      // A stub: the extension's backend (the file system) is not available in
      // the harness — we simply emulate a successful save and return a
      // plausible path.
      const token = Number(m.token);
      const name = String(m.name || "image");
      const base = name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "image";
      const ext =
        String(m.mime || "")
          .split("/")[1]
          ?.replace("+xml", "") || "png";
      log(`saveImage(#${token}): ${name} → assets/${base}.${ext}`);
      toWebview?.({
        type: "imageSaved",
        token,
        relPath: `assets/${base}.${ext}`,
        // The provider answers with an address the webview may load; nothing was
        // written to disk here, so the bytes that arrived stand in for the file.
        // A stand that answered with the relative path alone would show an empty
        // frame the extension does not have.
        webUri: `data:${String(m.mime || "image/png")};base64,${String(m.data ?? "")}`,
      });
      break;
    }
    case "pickFile": {
      // A stub for the “Choose file…” buttons: there is no VS Code open dialog
      // in the harness, so we answer with a fixed relative path.
      const token = Number(m.token);
      const rel = m.kind === "image" ? "assets/picked.png" : "includes/abbreviations.md";
      log(`pickFile(#${token}, ${String(m.kind)}) → ${rel}`);
      toWebview?.({
        type: "filePicked",
        token,
        relPath: rel,
        webUri: m.kind === "image" ? `${location.origin}${DOCS}${rel}` : "",
      });
      break;
    }
    case "iconNames": {
      // The extension answers from its icon pack; here the server does.
      void fetch("/icons/names")
        .then((r) => r.json())
        .then((sets) => toWebview?.({ type: "iconNames", sets }))
        .catch(() => toWebview?.({ type: "iconNames", sets: {} }));
      break;
    }
    case "iconSvgs": {
      const codes = Array.isArray(m.codes) ? m.codes.map((c) => String(c)) : [];
      const id = Number(m.id);
      void fetch(`/icons/svgs?codes=${encodeURIComponent(codes.join(","))}`)
        .then((r) => r.json())
        .then((svgs) => toWebview?.({ type: "iconSvgs", id, svgs }))
        .catch(() => toWebview?.({ type: "iconSvgs", id, svgs: {} }));
      break;
    }
    default:
      log(`message: ${JSON.stringify(m).slice(0, 120)}`);
  }
}

window.acquireVsCodeApi = () => ({
  postMessage(msg: unknown): void {
    // Asynchronous, just like the real postMessage.
    setTimeout(() => handleFromWebview(msg), 0);
  },
});

// The “extension → webview” channel: a real window message event.
toWebview = (msg) => window.postMessage(msg, "*");

window.__harness = {
  load(t: string): void {
    text = t;
    fileText = t;
    unsaved = false;
    version++;
    render("render");
  },
  /** Somebody else edits the file while the page is open. */
  outside(t: string): void {
    editFromOutside(t);
  },
  getText(): string {
    return text;
  },
  /** What the stand's "file" holds — the page reaches it only on save. */
  getFile(): string {
    return fileText;
  },
  extraCss(css: string): void {
    // A manual check of extra_css loading: we imitate the extension's message.
    toWebview?.({ type: "extraCss", css });
  },
};

// The harness's icon resolver: synchronous reading of SVGs from the dev server
// (in the extension this is done by FallbackRenderer from the file system). A
// synchronous XHR is acceptable here — this is a developer tool, not production.
const iconCache = new Map<string, string | undefined>();
function resolveIconSync(shortcode: string): string | undefined {
  if (iconCache.has(shortcode)) {
    return iconCache.get(shortcode);
  }
  const dash = shortcode.indexOf("-");
  let svg: string | undefined;
  if (dash > 0) {
    const set = shortcode.slice(0, dash);
    const rest = shortcode.slice(dash + 1);
    try {
      const xhr = new XMLHttpRequest();
      // The harness stands in for the extension, which reads the icon pack.
      xhr.open("GET", `/icons/svgs?codes=${encodeURIComponent(`${set}-${rest}`)}`, false);
      xhr.send();
      svg =
        xhr.status === 200
          ? ((JSON.parse(xhr.responseText) as Record<string, string>)[`${set}-${rest}`] ??
            undefined)
          : undefined;
    } catch {
      svg = undefined;
    }
  }
  iconCache.set(shortcode, svg);
  return svg;
}

/**
 * The opening state: the page asked for in the query (?page=guide/writing.md)
 * and the project's own stylesheet, the way the extension sends extra_css.
 */
async function start(): Promise<void> {
  const wanted = new URLSearchParams(location.search).get("page") ?? START_PAGE;
  await loadPage(wanted);
  try {
    const res = await fetch(`${DOCS}stylesheets/extra.css`);
    if (res.ok) {
      const css = (await res.text()).replace(/url\((["']?)\.\.\//g, `url($1${DOCS}`);
      toWebview?.({ type: "extraCss", css });
    }
  } catch {
    // No stylesheet — the pages simply look like plain Material.
  }
}

// The render engine — the same one as in the extension.
const engine = buildMarkdownEngine({
  resolveIcon: resolveIconSync,
  readSnippet: () => undefined,
});
window.__buildEngine = () => ({ render: (src: string) => engine.render(src) });
