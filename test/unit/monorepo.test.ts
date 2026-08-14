import { describe, expect, it } from "vitest";

import { parseMkdocsConfig, type NavItem } from "../../src/core/mkdocsConfigParse";
import {
  expandIncludes,
  includeTargetOf,
  prefixNavPaths,
  resolveSectionPath,
  rootIncludeConfig,
  sectionFor,
  sectionPathOf,
  type MonorepoSection,
} from "../../src/core/monorepoParse";

const page = (title: string, path: string): NavItem => ({ kind: "page", title, path });

/** The two sections of the project the defect was reported on. */
const SECTIONS: MonorepoSection[] = [
  { prefix: "lib", docsDir: "lib/docs", nav: [page("Home", "lib/2/index.md")] },
  {
    prefix: "conv/user_docs",
    docsDir: "conv/user_docs/docs",
    nav: [page("Get started", "conv/user_docs/get_started.md")],
  },
];

describe("spotting an !include entry in nav", () => {
  it("reads the quoted form the plugin documents", () => {
    expect(includeTargetOf(page("Library", "!include ./lib/mkdocs.yml"))).toBe("lib/mkdocs.yml");
  });

  it("reads the form yaml leaves behind when the tag is not quoted", () => {
    // Unquoted, `!include` is a yaml tag: the value that reaches us is the path
    // alone. Verified against the parser rather than assumed.
    const { config } = parseMkdocsConfig("nav:\n  - Tools: !include ./conv/user_docs/mkdocs.yml\n");
    expect(includeTargetOf(config.nav![0])).toBe("conv/user_docs/mkdocs.yml");
  });

  it("takes mkdocs.yaml as readily as mkdocs.yml", () => {
    expect(includeTargetOf(page("Library", "!include ./lib/mkdocs.yaml"))).toBe("lib/mkdocs.yaml");
  });

  it("says nothing about an ordinary page", () => {
    expect(includeTargetOf(page("Home", "index.md"))).toBeUndefined();
    expect(includeTargetOf({ kind: "section", title: "Guide", children: [] })).toBeUndefined();
  });

  it("refuses a config outside the project", () => {
    expect(includeTargetOf(page("Other", "!include ../other/mkdocs.yml"))).toBeUndefined();
    expect(includeTargetOf(page("Other", "!include /etc/mkdocs.yml"))).toBeUndefined();
  });
});

describe("the URL prefix of a section", () => {
  it("goes onto every page of the included nav", () => {
    const nav: NavItem[] = [
      page("Home", "2/index.md"),
      { kind: "section", title: "Guides", children: [page("Metrics", "4/index.md")] },
    ];
    expect(prefixNavPaths(nav, "lib")).toEqual([
      page("Home", "lib/2/index.md"),
      { kind: "section", title: "Guides", children: [page("Metrics", "lib/4/index.md")] },
    ]);
  });

  it("leaves a URL alone — it is not a file of the section", () => {
    expect(prefixNavPaths([page("Site", "https://example.org")], "lib")).toEqual([
      page("Site", "https://example.org"),
    ]);
  });

  it("leaves an !include entry alone — it names a config, not a page", () => {
    // Prefixing it would break the lookup that expands the nested section.
    const nav = [page("Nested", "!include ./inner/mkdocs.yml")];
    expect(prefixNavPaths(nav, "lib")).toEqual(nav);
  });
});

describe("expanding !include into a section", () => {
  const sections = new Map<string, MonorepoSection>([
    ["lib/mkdocs.yml", SECTIONS[0]],
    ["conv/user_docs/mkdocs.yml", SECTIONS[1]],
  ]);

  it("turns the entry into a section with the pages of the included config", () => {
    const nav = [page("Library", "!include ./lib/mkdocs.yml")];
    expect(expandIncludes(nav, sections)).toEqual([
      { kind: "section", title: "Library", children: [page("Home", "lib/2/index.md")] },
    ]);
  });

  it("keeps ordinary entries as they are", () => {
    const nav = [page("Home", "index.md"), page("Library", "!include ./lib/mkdocs.yml")];
    expect(expandIncludes(nav, sections)[0]).toEqual(page("Home", "index.md"));
  });

  it("reaches an entry nested inside a section", () => {
    const nav: NavItem[] = [
      { kind: "section", title: "All", children: [page("Library", "!include ./lib/mkdocs.yml")] },
    ];
    const expanded = expandIncludes(nav, sections)[0];
    expect(expanded).toEqual({
      kind: "section",
      title: "All",
      children: [{ kind: "section", title: "Library", children: [page("Home", "lib/2/index.md")] }],
    });
  });

  it("looks a nested entry up relative to the config it is written in", () => {
    // `lib/mkdocs.yml` includes `./inner/mkdocs.yml` — that is `lib/inner/mkdocs.yml`
    // from the project root, which is how the sections are keyed.
    const inner: MonorepoSection = {
      prefix: "lib/inner",
      docsDir: "lib/inner/docs",
      nav: [page("Deep", "lib/inner/index.md")],
    };
    const nested = new Map([["lib/inner/mkdocs.yml", inner]]);
    const nav = [page("Nested", "!include ./inner/mkdocs.yml")];
    expect(expandIncludes(nav, nested, "lib")).toEqual([
      { kind: "section", title: "Nested", children: [page("Deep", "lib/inner/index.md")] },
    ]);
  });

  it("leaves an empty section behind when the config could not be read", () => {
    const nav = [page("Missing", "!include ./gone/mkdocs.yml")];
    expect(expandIncludes(nav, sections)).toEqual([
      { kind: "section", title: "Missing", children: [] },
    ]);
  });
});

describe("which section a path belongs to", () => {
  it("picks the longer prefix when one section sits inside another", () => {
    // The shorter section is listed last on purpose: matching by order alone
    // would answer `conv` here, and the page would be read from the wrong docs_dir.
    const nested: MonorepoSection[] = [
      ...SECTIONS,
      { prefix: "conv", docsDir: "conv/docs", nav: [] },
    ];
    expect(sectionFor("conv/user_docs/get_started.md", nested)?.prefix).toBe("conv/user_docs");
  });

  it("finds nothing for a page of the root site", () => {
    expect(sectionFor("index.md", SECTIONS)).toBeUndefined();
  });

  it("does not mistake a lookalike directory for the prefix", () => {
    expect(sectionFor("library/index.md", SECTIONS)).toBeUndefined();
  });
});

describe("where a prefixed path really lives", () => {
  it("resolves a section page against the section's own docs_dir", () => {
    expect(resolveSectionPath("lib/2/index.md", "docs", SECTIONS)).toBe("lib/docs/2/index.md");
  });

  it("resolves a stylesheet the same way — that is the reported defect", () => {
    // extra_css: lib/stylesheets/extra.css → lib/docs/stylesheets/extra.css
    expect(resolveSectionPath("lib/stylesheets/extra.css", "docs", SECTIONS)).toBe(
      "lib/docs/stylesheets/extra.css",
    );
  });

  it("resolves a path with no prefix against the root docs_dir, as before", () => {
    expect(resolveSectionPath("stylesheets/extra.css", "docs", SECTIONS)).toBe(
      "docs/stylesheets/extra.css",
    );
  });

  it("copes with a project whose docs_dir is the root itself", () => {
    expect(resolveSectionPath("index.md", ".", SECTIONS)).toBe("index.md");
  });

  it("names the page of a section back from the file it lives in", () => {
    expect(sectionPathOf("lib/docs/2/index.md", SECTIONS)).toBe("lib/2/index.md");
    expect(sectionPathOf("docs/index.md", SECTIONS)).toBeUndefined();
  });

  it("names it by the deepest docs_dir when one section sits inside another", () => {
    const nested: MonorepoSection[] = [...SECTIONS, { prefix: "conv", docsDir: "conv", nav: [] }];
    expect(sectionPathOf("conv/user_docs/docs/get_started.md", nested)).toBe(
      "conv/user_docs/get_started.md",
    );
  });
});

describe("finding the root of an include chain", () => {
  it("climbs from an included config to the one that includes it", () => {
    const parents = new Map([["lib/mkdocs.yml", "mkdocs.yml"]]);
    expect(rootIncludeConfig("lib/mkdocs.yml", parents)).toBe("mkdocs.yml");
  });

  it("climbs the whole way when sections are nested", () => {
    const parents = new Map([
      ["a/b/mkdocs.yml", "a/mkdocs.yml"],
      ["a/mkdocs.yml", "mkdocs.yml"],
    ]);
    expect(rootIncludeConfig("a/b/mkdocs.yml", parents)).toBe("mkdocs.yml");
  });

  it("stays put for a config nobody includes", () => {
    expect(rootIncludeConfig("mkdocs.yml", new Map())).toBe("mkdocs.yml");
  });

  it("stops instead of spinning when the includes form a loop", () => {
    const parents = new Map([
      ["a/mkdocs.yml", "b/mkdocs.yml"],
      ["b/mkdocs.yml", "a/mkdocs.yml"],
    ]);
    expect(rootIncludeConfig("a/mkdocs.yml", parents)).toBe("b/mkdocs.yml");
  });
});
