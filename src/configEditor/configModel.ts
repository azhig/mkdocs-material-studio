import { isMap, isScalar, isSeq, YAMLSeq, type Document } from "yaml";
import { t } from "../core/i18nCore";

/**
 * Model of the visual mkdocs.yml editor and surgical edits of the yaml Document.
 * All changes are applied to the AST via setIn/deleteIn/splice, which preserves
 * the comments and the formatting of the rest of the file (only the minimal
 * fragment is rewritten).
 */

export interface ToggleItem {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ConfigModel {
  general: Record<string, string>;
  theme: {
    name: string;
    language: string;
    paletteMode: "none" | "single" | "list";
    primary: string;
    accent: string;
    scheme: string;
  };
  features: ToggleItem[];
  plugins: ToggleItem[];
  extensions: ToggleItem[];
  catalogs: {
    primary: string[];
    accent: string[];
    schemes: { value: string; label: string }[];
    languages: { value: string; label: string }[];
  };
}

/** A change coming from the webview. */
export type ConfigChange =
  | { kind: "scalar"; path: string[]; value: string }
  | { kind: "palette"; field: "primary" | "accent" | "scheme"; value: string }
  | { kind: "toggle"; group: "features" | "plugins" | "extensions"; id: string; on: boolean };

// --- Material catalogs (curated lists) ---
//
// The labels below are English text that doubles as the translation key, and
// they are deliberately NOT wrapped in t() here. These are module-level
// constants: a t() in them would run when the module is imported, which is
// before activation loads the bundle, so every label would come out English no
// matter what `mkdocsStudio.language` says. Translation happens where the model
// is built — which also means switching the language redraws the panel in the
// new one, with no reload.

const GENERAL_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: "site_name", label: "Site name", placeholder: "My documentation" },
  { key: "site_url", label: "Site URL", placeholder: "https://example.com/" },
  { key: "site_description", label: "Description" },
  { key: "site_author", label: "Author" },
  { key: "repo_url", label: "Repository URL", placeholder: "https://github.com/user/repo" },
  { key: "repo_name", label: "Repository name", placeholder: "user/repo" },
  { key: "edit_uri", label: "Edit path", placeholder: "edit/main/docs/" },
  { key: "copyright", label: "Copyright" },
];

const PALETTE_PRIMARY = [
  "red",
  "pink",
  "purple",
  "deep purple",
  "indigo",
  "blue",
  "light blue",
  "cyan",
  "teal",
  "green",
  "light green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "deep orange",
  "brown",
  "grey",
  "blue grey",
  "black",
  "white",
];

const PALETTE_ACCENT = [
  "red",
  "pink",
  "purple",
  "deep purple",
  "indigo",
  "blue",
  "light blue",
  "cyan",
  "teal",
  "green",
  "light green",
  "lime",
  "yellow",
  "amber",
  "orange",
  "deep orange",
];

const SCHEMES = [
  { value: "default", label: "Light (default)" },
  { value: "slate", label: "Dark (slate)" },
];

// The languages Material's theme ships translations for. The labels are the
// English names rather than endonyms: everything else in this file is English
// too, and the two-letter code next to each one is what actually goes into
// mkdocs.yml.
const LANGUAGES = [
  { value: "ru", label: "Russian" },
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
];

const MATERIAL_FEATURES: { id: string; label: string }[] = [
  { id: "navigation.instant", label: "Instant loading" },
  { id: "navigation.instant.progress", label: "Loading indicator" },
  { id: "navigation.tracking", label: "Anchor tracking" },
  { id: "navigation.tabs", label: "Tabs in the header" },
  { id: "navigation.tabs.sticky", label: "Sticky tabs" },
  { id: "navigation.sections", label: "Sections as headings" },
  { id: "navigation.expand", label: "Expand navigation" },
  { id: "navigation.path", label: "Breadcrumbs" },
  { id: "navigation.indexes", label: "Section index pages" },
  { id: "navigation.top", label: "“Back to top” button" },
  { id: "navigation.footer", label: "Prev/next links in the footer" },
  { id: "toc.follow", label: "Table of contents follows scrolling" },
  { id: "toc.integrate", label: "Table of contents in the sidebar" },
  { id: "search.suggest", label: "Search suggestions" },
  { id: "search.highlight", label: "Highlight search results" },
  { id: "search.share", label: "Search share link" },
  { id: "header.autohide", label: "Auto-hide the header" },
  { id: "announce.dismiss", label: "Dismissible announcement" },
  { id: "content.code.copy", label: "Code copy button" },
  { id: "content.code.annotate", label: "Code annotations" },
  { id: "content.code.select", label: "Code line selection" },
  { id: "content.tabs.link", label: "Linked tabs" },
  { id: "content.tooltips", label: "Tooltips" },
  { id: "content.footnote.tooltips", label: "Footnote tooltips" },
  { id: "content.action.edit", label: "“Edit” button" },
  { id: "content.action.view", label: "“View source” button" },
];

const MATERIAL_PLUGINS: { id: string; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "tags", label: "Tags" },
  { id: "offline", label: "Offline mode" },
  { id: "blog", label: "Blog" },
  { id: "social", label: "Social cards" },
];

const PLUGIN_DEFAULTS = ["search"]; // mkdocs enables search by default

const MATERIAL_EXTENSIONS: { id: string; label: string }[] = [
  { id: "abbr", label: "Abbreviations" },
  { id: "admonition", label: "Admonition blocks" },
  { id: "attr_list", label: "Attribute lists" },
  { id: "def_list", label: "Definition lists" },
  { id: "footnotes", label: "Footnotes" },
  { id: "md_in_html", label: "Markdown in HTML" },
  { id: "tables", label: "Tables" },
  { id: "toc", label: "Table of contents (toc)" },
  { id: "pymdownx.betterem", label: "Better emphasis" },
  { id: "pymdownx.caret", label: "Insert/superscript (^)" },
  { id: "pymdownx.details", label: "Collapsible blocks" },
  { id: "pymdownx.emoji", label: "Emoji and icons" },
  { id: "pymdownx.highlight", label: "Syntax highlighting" },
  { id: "pymdownx.inlinehilite", label: "Inline highlighting" },
  { id: "pymdownx.keys", label: "Keys (++ctrl++)" },
  { id: "pymdownx.mark", label: "Mark (==)" },
  { id: "pymdownx.smartsymbols", label: "Smart symbols" },
  { id: "pymdownx.superfences", label: "Super code fences" },
  { id: "pymdownx.tabbed", label: "Content tabs" },
  { id: "pymdownx.tasklist", label: "Task lists" },
  { id: "pymdownx.tilde", label: "Strikethrough/subscript (~)" },
  { id: "pymdownx.arithmatex", label: "Formulas (KaTeX/MathJax)" },
  { id: "pymdownx.snippets", label: "File includes" },
  { id: "pymdownx.critic", label: "Critic markup" },
];

// --- Reading the model ---

/** The fields of the General tab, in the language in use right now. */
export function generalFields(): { key: string; label: string; placeholder?: string }[] {
  return GENERAL_FIELDS.map((field) =>
    field.placeholder === undefined
      ? { key: field.key, label: t(field.label) }
      : { key: field.key, label: t(field.label), placeholder: t(field.placeholder) },
  );
}

export function buildConfigModel(doc: Document): ConfigModel {
  const general: Record<string, string> = {};
  for (const { key } of GENERAL_FIELDS) {
    general[key] = readScalar(doc, [key]);
  }

  const themeNode = doc.getIn(["theme"]);
  const themeName =
    typeof themeNode === "string" ? themeNode : readScalar(doc, ["theme", "name"]) || "material";

  const paletteNode = doc.getIn(["theme", "palette"], true);
  const paletteMode = isSeq(paletteNode) ? "list" : isMap(paletteNode) ? "single" : "none";
  const palettePath = paletteMode === "list" ? ["theme", "palette", 0] : ["theme", "palette"];

  return {
    general,
    theme: {
      name: themeName,
      language: readScalar(doc, ["theme", "language"]),
      paletteMode,
      primary: paletteMode === "none" ? "" : readScalar(doc, [...palettePath, "primary"]),
      accent: paletteMode === "none" ? "" : readScalar(doc, [...palettePath, "accent"]),
      scheme: paletteMode === "none" ? "" : readScalar(doc, [...palettePath, "scheme"]),
    },
    features: readToggles(doc, ["theme", "features"], MATERIAL_FEATURES, []),
    plugins: readToggles(doc, ["plugins"], MATERIAL_PLUGINS, PLUGIN_DEFAULTS),
    extensions: readToggles(doc, ["markdown_extensions"], MATERIAL_EXTENSIONS, []),
    catalogs: {
      primary: PALETTE_PRIMARY,
      accent: PALETTE_ACCENT,
      schemes: SCHEMES.map((scheme) => ({ value: scheme.value, label: t(scheme.label) })),
      languages: LANGUAGES,
    },
  };
}

// --- Applying a change ---

export function applyConfigChange(doc: Document, change: ConfigChange): void {
  switch (change.kind) {
    case "scalar":
      if (change.path[0] === "theme") {
        ensureThemeMap(doc);
      }
      setScalar(doc, change.path, change.value);
      break;
    case "palette":
      setPalette(doc, change.field, change.value);
      break;
    case "toggle": {
      const path =
        change.group === "features"
          ? ["theme", "features"]
          : change.group === "plugins"
            ? ["plugins"]
            : ["markdown_extensions"];
      if (change.group === "features") {
        ensureThemeMap(doc);
      }
      const seed = change.group === "plugins" ? PLUGIN_DEFAULTS : [];
      toggleSeqItem(doc, path, change.id, change.on, seed);
      break;
    }
  }
}

// --- Internals ---

function readScalar(doc: Document, path: (string | number)[]): string {
  const value = doc.getIn(path);
  if (value == null) {
    return "";
  }
  return typeof value === "string" ? value : typeof value === "object" ? "" : String(value);
}

function setScalar(doc: Document, path: (string | number)[], value: string): void {
  if (value === "") {
    doc.deleteIn(path);
    return;
  }
  // Mutate the existing scalar (this keeps the inline comment attached to the
  // value); create a new node only when there is none.
  const node = doc.getIn(path, true);
  if (isScalar(node)) {
    node.value = value;
  } else {
    doc.setIn(path, value);
  }
}

/** Ensures that theme is a map (string `theme: material` → `{name: material}`). */
function ensureThemeMap(doc: Document): void {
  const themeNode = doc.getIn(["theme"], true);
  if (isMap(themeNode)) {
    return;
  }
  const name = typeof doc.getIn(["theme"]) === "string" ? String(doc.getIn(["theme"])) : "material";
  doc.setIn(["theme"], doc.createNode({ name }));
}

function setPalette(doc: Document, field: "primary" | "accent" | "scheme", value: string): void {
  ensureThemeMap(doc);
  const paletteNode = doc.getIn(["theme", "palette"], true);
  const base: (string | number)[] = isSeq(paletteNode)
    ? ["theme", "palette", 0]
    : ["theme", "palette"];
  setScalar(doc, [...base, field], value);
}

/** Index of a seq item by name (a string, or a map keyed by id); -1 when absent. */
function findSeqItemIndex(seq: YAMLSeq, id: string): number {
  for (let i = 0; i < seq.items.length; i++) {
    const item = seq.items[i];
    if (isScalar(item) && item.value === id) {
      return i;
    }
    if (isMap(item) && item.items.length >= 1) {
      const key = item.items[0].key;
      const keyVal = isScalar(key) ? key.value : key;
      if (keyVal === id) {
        return i;
      }
    }
  }
  return -1;
}

function readToggles(
  doc: Document,
  path: string[],
  catalog: { id: string; label: string }[],
  defaultsWhenAbsent: string[],
): ToggleItem[] {
  const seq = doc.getIn(path, true);
  const present = isSeq(seq);
  return catalog.map((c) => ({
    id: c.id,
    label: t(c.label),
    enabled: present
      ? findSeqItemIndex(seq as YAMLSeq, c.id) >= 0
      : defaultsWhenAbsent.includes(c.id),
  }));
}

function toggleSeqItem(
  doc: Document,
  path: string[],
  id: string,
  on: boolean,
  seedDefaults: string[],
): void {
  let seq = doc.getIn(path, true);
  if (!isSeq(seq)) {
    // Materialize the list from the default values (for plugins this preserves
    // mkdocs behaviour, where a missing key means search is enabled).
    const node = doc.createNode(seedDefaults) as unknown as YAMLSeq;
    node.flow = false;
    doc.setIn(path, node);
    seq = doc.getIn(path, true);
  }
  const s = seq as YAMLSeq;
  s.flow = false;
  const idx = findSeqItemIndex(s, id);
  if (on && idx < 0) {
    s.items.push(doc.createNode(id));
  } else if (!on && idx >= 0) {
    s.items.splice(idx, 1);
  }
}
