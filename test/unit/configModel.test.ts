import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { parseMkdocsConfig } from "../../src/core/mkdocsConfigParse";
import { setBundle } from "../../src/core/i18nCore";
import {
  buildConfigModel,
  applyConfigChange,
  generalFields,
} from "../../src/configEditor/configModel";

function apply(src: string, change: Parameters<typeof applyConfigChange>[1]): string {
  const { doc } = parseMkdocsConfig(src);
  applyConfigChange(doc, change);
  return doc.toString();
}

function model(src: string) {
  const { doc } = parseMkdocsConfig(src);
  return buildConfigModel(doc);
}

const SAMPLE = `# Project configuration
site_name: Old name  # heading of the site
site_url: https://example.com/

theme:
  name: material
  palette:
    scheme: default
    primary: indigo
  features:
    - navigation.tabs

markdown_extensions:
  - admonition
  - pymdownx.highlight:
      anchor_linenums: true

plugins:
  - search
`;

describe("configModel — targeted edits keep comments", () => {
  it("changes a scalar without touching comments and other lines", () => {
    const out = apply(SAMPLE, { kind: "scalar", path: ["site_name"], value: "New name" });
    expect(out).toContain("site_name: New name");
    expect(out).toContain("# Project configuration");
    expect(out).toContain("# heading of the site"); // the inline comment survived
    expect(out).toContain("site_url: https://example.com/");
  });

  it("an empty value removes the key", () => {
    const out = apply(SAMPLE, { kind: "scalar", path: ["site_url"], value: "" });
    expect(out).not.toContain("site_url");
    expect(out).toContain("site_name: Old name");
  });

  it("palette (single): changes primary in place", () => {
    const out = apply(SAMPLE, { kind: "palette", field: "primary", value: "teal" });
    expect(out).toContain("primary: teal");
    expect(out).toContain("scheme: default");
  });

  it("adds a theme feature, keeping the existing one", () => {
    const out = apply(SAMPLE, {
      kind: "toggle",
      group: "features",
      id: "navigation.top",
      on: true,
    });
    expect(out).toContain("- navigation.tabs");
    expect(out).toContain("- navigation.top");
  });

  it("removes a theme feature", () => {
    const out = apply(SAMPLE, {
      kind: "toggle",
      group: "features",
      id: "navigation.tabs",
      on: false,
    });
    expect(out).not.toContain("navigation.tabs");
  });

  it("an extension with options (map) is recognized as enabled and not duplicated", () => {
    const out = apply(SAMPLE, {
      kind: "toggle",
      group: "extensions",
      id: "pymdownx.highlight",
      on: true,
    });
    // no second entry appeared
    expect(out.match(/pymdownx\.highlight/g)?.length).toBe(1);
    expect(out).toContain("anchor_linenums: true"); // options intact
  });

  it("disabling an extension with options removes the whole block", () => {
    const out = apply(SAMPLE, {
      kind: "toggle",
      group: "extensions",
      id: "pymdownx.highlight",
      on: false,
    });
    expect(out).not.toContain("pymdownx.highlight");
    expect(out).not.toContain("anchor_linenums");
    expect(out).toContain("- admonition");
  });
});

describe("configModel — materializing lists", () => {
  it("enabling a plugin when the key is missing keeps the default search", () => {
    const src = "site_name: X\n";
    const out = apply(src, { kind: "toggle", group: "plugins", id: "tags", on: true });
    expect(out).toContain("search");
    expect(out).toContain("tags");
  });

  it("disabling search when the key is missing yields an empty list", () => {
    const src = "site_name: X\n";
    const out = apply(src, { kind: "toggle", group: "plugins", id: "search", on: false });
    expect(out).toMatch(/plugins:\s*\[\s*\]/);
  });

  it("theme given as a string becomes a map when the palette is edited", () => {
    const src = "site_name: X\ntheme: material\n";
    const out = apply(src, { kind: "palette", field: "primary", value: "red" });
    expect(out).toContain("name: material");
    expect(out).toContain("primary: red");
  });
});

describe("configModel — reading the model", () => {
  it("reflects the state correctly", () => {
    const m = model(SAMPLE);
    expect(m.general.site_name).toBe("Old name");
    expect(m.theme.name).toBe("material");
    expect(m.theme.paletteMode).toBe("single");
    expect(m.theme.primary).toBe("indigo");
    expect(m.theme.scheme).toBe("default");
    expect(m.features.find((f) => f.id === "navigation.tabs")?.enabled).toBe(true);
    expect(m.features.find((f) => f.id === "navigation.top")?.enabled).toBe(false);
    expect(m.extensions.find((e) => e.id === "pymdownx.highlight")?.enabled).toBe(true);
    expect(m.plugins.find((p) => p.id === "search")?.enabled).toBe(true);
  });

  it("plugins: search is enabled by default when the key is missing", () => {
    const m = model("site_name: X\n");
    expect(m.plugins.find((p) => p.id === "search")?.enabled).toBe(true);
    expect(m.plugins.find((p) => p.id === "tags")?.enabled).toBe(false);
  });

  it("palette as a list: paletteMode=list, the first scheme is read", () => {
    const src = `theme:
  name: material
  palette:
    - scheme: default
      primary: red
    - scheme: slate
      primary: blue
`;
    const m = model(src);
    expect(m.theme.paletteMode).toBe("list");
    expect(m.theme.primary).toBe("red");
  });
});

// The bundle is installed during activation, which is after every module has
// been imported. So the labels of the panel must be translated when the model
// is built, not when the catalogues are declared — a t() in a module-level
// constant runs too early and leaves the panel in English however
// `mkdocsStudio.language` is set. Installing the bundle here, well after the
// import above, is exactly that situation.
describe("configModel — the panel speaks the configured language", () => {
  beforeEach(() => {
    // German, so every value differs from its key: a “translation” equal to the
    // key would let an untranslated label pass for a translated one.
    setBundle("de", {
      "Site name": "Website-Name",
      "My documentation": "Meine Dokumentation",
      "Repository URL": "Repository-Adresse",
      "Tabs in the header": "Tabs in der Kopfzeile",
      Search: "Suche",
      "Admonition blocks": "Hinweisblöcke",
      "Dark (slate)": "Dunkel (slate)",
    });
  });

  afterEach(() => {
    setBundle("en", {});
  });

  it("translates the field labels and their placeholders", () => {
    const fields = generalFields();
    const siteName = fields.find((f) => f.key === "site_name");
    expect(siteName?.label).toBe("Website-Name");
    expect(siteName?.placeholder).toBe("Meine Dokumentation");
    expect(fields.find((f) => f.key === "repo_url")?.label).toBe("Repository-Adresse");
  });

  it("leaves a label the bundle does not carry in English rather than blank", () => {
    expect(generalFields().find((f) => f.key === "copyright")?.label).toBe("Copyright");
  });

  it("translates the toggles of every group", () => {
    const m = model("site_name: X\n");
    expect(m.features.find((f) => f.id === "navigation.tabs")?.label).toBe("Tabs in der Kopfzeile");
    expect(m.plugins.find((p) => p.id === "search")?.label).toBe("Suche");
    expect(m.extensions.find((e) => e.id === "admonition")?.label).toBe("Hinweisblöcke");
  });

  it("translates the palette schemes", () => {
    const m = model("site_name: X\n");
    expect(m.catalogs.schemes.find((s) => s.value === "slate")?.label).toBe("Dunkel (slate)");
  });

  it("follows a language change without a reload", () => {
    expect(generalFields()[0].label).toBe("Website-Name");
    setBundle("fr", { "Site name": "Nom du site" });
    expect(generalFields()[0].label).toBe("Nom du site");
  });

  it("leaves the language names alone — they are names, not interface strings", () => {
    // The list is the set of languages Material's theme ships translations for.
    // What goes into mkdocs.yml is the code; the label is only there to read,
    // and it stays English whatever the panel's own language is.
    const m = model("site_name: X\n");
    expect(m.catalogs.languages).toContainEqual({ value: "ru", label: "Russian" });
    expect(m.catalogs.languages).toContainEqual({ value: "ja", label: "Japanese" });
  });
});
