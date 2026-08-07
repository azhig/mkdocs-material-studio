// The light/dark scheme of the page, shared by the preview and the visual editor.
//
// Both webviews follow the VS Code theme by default (the vscode-dark/-light
// class VS Code puts on body) and let the toolbar button override it until the
// user switches back. The colours of each scheme come from mkdocs.yml, and the
// page background may be taken from the editor instead of Material.
//
// This used to live twice, once per webview, in copies that were identical
// character for character — so a fix landed twice or, worse, once.

export type Scheme = "default" | "slate";

export interface SchemeColors {
  primary?: string;
  accent?: string;
}

/** The colours of both schemes, as the extension sends them with a render. */
export interface PaletteMsg {
  light?: SchemeColors;
  dark?: SchemeColors;
}

export interface SchemeHooks {
  /** After every application: the webview syncs its own theme button here. */
  afterApply?: () => void;
  /** The scheme actually changed — diagrams drawn in the old colours need a redraw. */
  onSchemeChange?: () => void;
  /** The manual choice changed: the webview stores it the way it prefers. */
  persist?: (override: Scheme | null) => void;
}

let hooks: SchemeHooks = {};
let themeOverride: Scheme | null = null;
let palette: PaletteMsg | undefined;
/** What mkdocsStudio.pageBackground asks for; when it applies is decided below. */
let backgroundMode = "material";

/**
 * Starts following the theme: restores the remembered choice, applies the scheme
 * at once (before the first render, or the pane flashes white) and watches the
 * body classes — the VS Code theme can change while the webview is open.
 */
export function initScheme(next: SchemeHooks, saved?: unknown): void {
  hooks = next;
  themeOverride = saved === "default" || saved === "slate" ? saved : null;
  new MutationObserver(() => {
    if (themeOverride === null) {
      applyScheme();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  applyScheme();
}

/** The VS Code theme, read off the webview body's classes. */
function vscodeScheme(): Scheme {
  const cl = document.body.classList;
  if (cl.contains("vscode-light") || cl.contains("vscode-high-contrast-light")) {
    return "default";
  }
  if (cl.contains("vscode-dark") || cl.contains("vscode-high-contrast")) {
    return "slate";
  }
  return "default";
}

/** The effective scheme: the manual choice, otherwise the VS Code theme. */
export function effectiveScheme(): Scheme {
  return themeOverride ?? vscodeScheme();
}

function applyScheme(): void {
  const scheme = effectiveScheme();
  const prev = document.body.getAttribute("data-md-color-scheme");
  document.body.setAttribute("data-md-color-scheme", scheme);
  applyColors(scheme);
  applyBackground();
  hooks.afterApply?.();
  if (prev !== null && prev !== scheme) {
    hooks.onSchemeChange?.();
  }
}

export function toggleTheme(): void {
  themeOverride = effectiveScheme() === "slate" ? "default" : "slate";
  applyScheme();
  hooks.persist?.(themeOverride);
}

/** The colours of both schemes arrive with every render. */
export function applyPalette(next: PaletteMsg | undefined): void {
  palette = next;
  applyScheme();
}

/**
 * Where the background comes from — the Material scheme or the VS Code theme
 * (mkdocsStudio.pageBackground). The colours themselves live in fallback.css;
 * the attribute only says which set to take.
 *
 * The editor background is taken ONLY while the page scheme matches the VS Code
 * theme. Switch the page to light over a dark editor and the two sets would come
 * from different worlds: Material's near-black text on the editor's near-black
 * background. In that pairing the page keeps its own background.
 */
export function applyBackground(mode?: string): void {
  if (mode !== undefined) {
    backgroundMode = mode;
  }
  if (backgroundMode === "editor" && effectiveScheme() === vscodeScheme()) {
    document.body.setAttribute("data-vs-bg", "editor");
  } else {
    document.body.removeAttribute("data-vs-bg");
  }
}

/**
 * primary/accent of the current scheme. Material describes each scheme with its
 * own colours, and both webviews switch between them without a re-render — so
 * the attributes are reapplied on every scheme change.
 */
function applyColors(scheme: Scheme): void {
  const colors = (scheme === "slate" ? palette?.dark : palette?.light) ?? {};
  for (const [attr, value] of [
    ["data-md-color-primary", colors.primary],
    ["data-md-color-accent", colors.accent],
  ] as const) {
    if (value) {
      document.body.setAttribute(attr, value);
    } else {
      document.body.removeAttribute(attr);
    }
  }
}
