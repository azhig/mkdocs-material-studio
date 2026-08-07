import type { PaletteConfig } from "./mkdocsConfigParse";

/** The primary/accent pair of one scheme, ready for Material's data-md-color-* attributes. */
export interface SchemeColors {
  primary?: string;
  accent?: string;
}

/**
 * The colors of both schemes. The preview switches between light and dark on its
 * own (the toolbar button, the VS Code theme), so it needs both pairs at once —
 * unlike a built site, where MkDocs re-renders the page for the chosen palette.
 */
export interface PaletteInfo {
  light: SchemeColors;
  dark: SchemeColors;
}

/**
 * `deep purple` in mkdocs.yml turns into `deep-purple` in the attribute — the
 * Material template does exactly the same substitution.
 */
export function normalizeColor(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return normalized === "" ? undefined : normalized;
}

/** The palette entries of mkdocs.yml, split by scheme. The first entry of a kind wins. */
function fromYaml(palette: PaletteConfig | PaletteConfig[] | undefined): PaletteInfo {
  const entries = (Array.isArray(palette) ? palette : palette ? [palette] : []).filter(
    (entry): entry is PaletteConfig => Boolean(entry) && typeof entry === "object",
  );
  const out: PaletteInfo = { light: {}, dark: {} };
  for (const entry of entries) {
    // An entry without a scheme is the light one — that is Material's default.
    const target = normalizeColor(entry.scheme) === "slate" ? out.dark : out.light;
    target.primary ??= normalizeColor(entry.primary);
    target.accent ??= normalizeColor(entry.accent);
  }
  return out;
}

/**
 * The final colors of both schemes. mkdocs.yml wins: the settings only fill in
 * what the project has not spelled out. When a scheme is missing from both, it
 * borrows the colors of the other one — a project that describes a single
 * palette still gets a coherent look in the preview's second scheme.
 */
export function resolvePalette(
  yaml: PaletteConfig | PaletteConfig[] | undefined,
  settings: PaletteInfo,
): PaletteInfo {
  const project = fromYaml(yaml);
  const pick = (scheme: "light" | "dark", field: "primary" | "accent"): string | undefined =>
    project[scheme][field] ??
    normalizeColor(settings[scheme][field]) ??
    project[scheme === "light" ? "dark" : "light"][field];
  return {
    light: { primary: pick("light", "primary"), accent: pick("light", "accent") },
    dark: { primary: pick("dark", "primary"), accent: pick("dark", "accent") },
  };
}
