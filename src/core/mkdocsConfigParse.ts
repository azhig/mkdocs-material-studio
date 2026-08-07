import { parseDocument, type Document } from "yaml";

/** The mkdocs.yml values that matter to the extension, parsed out. */
export interface MkdocsConfig {
  siteName?: string;
  docsDir: string;
  siteDir: string;
  useDirectoryUrls: boolean;
  /** Repository link (the button in the site header). */
  repoUrl?: string;
  /** Label of the repository button; without it MkDocs substitutes the host name. */
  repoName?: string;
  theme: {
    name?: string;
    palette?: PaletteConfig | PaletteConfig[];
    features?: string[];
    /** Logo: path to the image relative to docs_dir. */
    logo?: string;
    /** Theme icons; we care about icon.logo — a shortcode like `material/library`. */
    icon?: Record<string, string>;
  };
  markdownExtensions: MarkdownExtension[];
  plugins: string[];
  nav?: NavItem[];
  /** User stylesheets (extra_css) — paths relative to docs_dir. */
  extraCss: string[];
}

export interface PaletteConfig {
  scheme?: string;
  primary?: string;
  accent?: string;
  media?: string;
}

/** A markdown_extensions entry: a name plus (optionally) options. */
export interface MarkdownExtension {
  name: string;
  options?: Record<string, unknown>;
}

/** A navigation node: either a link to a file, or a section with children. */
export type NavItem = NavPage | NavSection;

export interface NavPage {
  kind: "page";
  title?: string;
  path: string;
}

export interface NavSection {
  kind: "section";
  title: string;
  children: NavItem[];
}

/**
 * Parses the text of mkdocs.yml. Returns a typed model and the “raw” yaml
 * Document for surgical edits that preserve comments (M4/M7).
 * Does not depend on vscode — suitable for unit tests.
 */
export function parseMkdocsConfig(text: string): { config: MkdocsConfig; doc: Document } {
  // MkDocs uses tags like `!!python/name:...`; strict validation is switched off.
  const doc = parseDocument(text, { strict: false, logLevel: "silent" });
  const raw = (doc.toJS({ maxAliasCount: -1 }) ?? {}) as Record<string, unknown>;

  const config: MkdocsConfig = {
    siteName: typeof raw.site_name === "string" ? raw.site_name : undefined,
    docsDir: typeof raw.docs_dir === "string" ? raw.docs_dir : "docs",
    siteDir: typeof raw.site_dir === "string" ? raw.site_dir : "site",
    useDirectoryUrls: raw.use_directory_urls !== false,
    repoUrl: typeof raw.repo_url === "string" ? raw.repo_url : undefined,
    repoName: typeof raw.repo_name === "string" ? raw.repo_name : undefined,
    theme: normalizeTheme(raw.theme),
    markdownExtensions: normalizeExtensions(raw.markdown_extensions),
    plugins: normalizePlugins(raw.plugins),
    nav: Array.isArray(raw.nav) ? normalizeNav(raw.nav) : undefined,
    extraCss: normalizeStringList(raw.extra_css),
  };
  return { config, doc };
}

function normalizeTheme(value: unknown): MkdocsConfig["theme"] {
  if (typeof value === "string") {
    return { name: value };
  }
  if (value && typeof value === "object") {
    const t = value as Record<string, unknown>;
    return {
      name: typeof t.name === "string" ? t.name : undefined,
      palette: t.palette as PaletteConfig | PaletteConfig[] | undefined,
      features: Array.isArray(t.features) ? (t.features as string[]) : undefined,
      logo: typeof t.logo === "string" ? t.logo : undefined,
      icon: normalizeIcons(t.icon),
    };
  }
  return {};
}

/** theme.icon is a flat dictionary of shortcodes (logo, repo, edit, …). */
function normalizeIcons(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, icon] of Object.entries(value as Record<string, unknown>)) {
    if (typeof icon === "string") {
      result[key] = icon;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeExtensions(value: unknown): MarkdownExtension[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: MarkdownExtension[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      result.push({ name: item });
    } else if (item && typeof item === "object") {
      for (const [name, options] of Object.entries(item as Record<string, unknown>)) {
        result.push({
          name,
          options: (options ?? undefined) as Record<string, unknown> | undefined,
        });
      }
    }
  }
  return result;
}

function normalizePlugins(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      result.push(item);
    } else if (item && typeof item === "object") {
      result.push(...Object.keys(item as Record<string, unknown>));
    }
  }
  return result;
}

/** Coerces extra_css into an array of strings (in mkdocs.yml it is a list of paths). */
function normalizeStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeNav(value: unknown[]): NavItem[] {
  const result: NavItem[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      result.push({ kind: "page", path: entry });
      continue;
    }
    if (entry && typeof entry === "object") {
      for (const [title, target] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof target === "string") {
          result.push({ kind: "page", title, path: target });
        } else if (Array.isArray(target)) {
          result.push({ kind: "section", title, children: normalizeNav(target) });
        }
      }
    }
  }
  return result;
}
