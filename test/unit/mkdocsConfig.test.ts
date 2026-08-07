import { describe, it, expect } from "vitest";
import { parseMkdocsConfig } from "../../src/core/mkdocsConfigParse";

const SAMPLE = `site_name: Demo
docs_dir: documentation
use_directory_urls: false
theme:
  name: material
  palette:
    - scheme: default
      primary: indigo
      accent: pink
  features:
    - navigation.tabs
    - toc.follow
markdown_extensions:
  - admonition
  - pymdownx.tabbed:
      alternate_style: true
plugins:
  - search
  - social
nav:
  - Home: index.md
  - Section:
      - Page: sec/page.md
`;

describe("parseMkdocsConfig", () => {
  it("reads the basic fields", () => {
    const { config } = parseMkdocsConfig(SAMPLE);
    expect(config.siteName).toBe("Demo");
    expect(config.docsDir).toBe("documentation");
    expect(config.useDirectoryUrls).toBe(false);
  });

  it("reads the site header fields: repository, logo, icon", () => {
    const { config } = parseMkdocsConfig(`
site_name: Demo
repo_url: https://github.com/example/demo
repo_name: example/demo
theme:
  name: material
  logo: assets/logo.png
  icon:
    logo: material/library
    repo: fontawesome/brands-github
`);
    expect(config.repoUrl).toBe("https://github.com/example/demo");
    expect(config.repoName).toBe("example/demo");
    expect(config.theme.logo).toBe("assets/logo.png");
    expect(config.theme.icon?.logo).toBe("material/library");
  });

  it("use_directory_urls defaults to true", () => {
    const { config } = parseMkdocsConfig("site_name: X\n");
    expect(config.useDirectoryUrls).toBe(true);
  });

  it("parses the palette and the theme features", () => {
    const { config } = parseMkdocsConfig(SAMPLE);
    const palette = Array.isArray(config.theme.palette)
      ? config.theme.palette[0]
      : config.theme.palette;
    expect(palette?.primary).toBe("indigo");
    expect(config.theme.features).toContain("navigation.tabs");
  });

  it("normalizes markdown_extensions (strings and objects)", () => {
    const { config } = parseMkdocsConfig(SAMPLE);
    const names = config.markdownExtensions.map((e) => e.name);
    expect(names).toContain("admonition");
    expect(names).toContain("pymdownx.tabbed");
    const tabbed = config.markdownExtensions.find((e) => e.name === "pymdownx.tabbed");
    expect(tabbed?.options).toEqual({ alternate_style: true });
  });

  it("normalizes plugins", () => {
    const { config } = parseMkdocsConfig(SAMPLE);
    expect(config.plugins).toEqual(["search", "social"]);
  });

  it("builds the nav tree (pages and sections)", () => {
    const { config } = parseMkdocsConfig(SAMPLE);
    expect(config.nav).toHaveLength(2);
    expect(config.nav?.[0]).toEqual({ kind: "page", title: "Home", path: "index.md" });
    const section = config.nav?.[1];
    expect(section?.kind).toBe("section");
    if (section?.kind === "section") {
      expect(section.title).toBe("Section");
      expect(section.children[0]).toEqual({ kind: "page", title: "Page", path: "sec/page.md" });
    }
  });

  it("Document is available for comment-preserving edits", () => {
    const { doc } = parseMkdocsConfig("site_name: X # comment\n");
    expect(doc.toString()).toContain("# comment");
  });

  it("parses extra_css (a list and a single string)", () => {
    const list = parseMkdocsConfig(
      "extra_css:\n  - css/extra.css\n  - stylesheets/theme.css\n",
    ).config;
    expect(list.extraCss).toEqual(["css/extra.css", "stylesheets/theme.css"]);
    const single = parseMkdocsConfig("extra_css: css/one.css\n").config;
    expect(single.extraCss).toEqual(["css/one.css"]);
    const none = parseMkdocsConfig("site_name: X\n").config;
    expect(none.extraCss).toEqual([]);
  });
});
