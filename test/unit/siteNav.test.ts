// The page tree for the header and the left panel: order and titles must
// match what a built MkDocs site shows, otherwise navigation in the
// editor and on the site will diverge.

import { describe, expect, it } from "vitest";
import { parseMkdocsConfig } from "../../src/core/mkdocsConfigParse";
import {
  firstHeading,
  markdownLinks,
  navFromConfig,
  navFromFiles,
  navFromFolder,
  resolveLink,
  titleFromPath,
  type SiteNode,
} from "../../src/core/siteNavBuild";

const noTitles = (): undefined => undefined;

/** Compact representation of the tree for comparison in tests. */
function flat(nodes: SiteNode[], depth = 0): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const pad = "  ".repeat(depth);
    if (node.kind === "section") {
      lines.push(`${pad}[${node.title}]`);
      lines.push(...flat(node.children, depth + 1));
    } else if (node.kind === "page") {
      lines.push(`${pad}${node.title} → ${node.path}`);
    } else {
      lines.push(`${pad}${node.title} ↗ ${node.href}`);
    }
  }
  return lines;
}

describe("navFromConfig", () => {
  it("takes titles from nav and nests sections", () => {
    const { config } = parseMkdocsConfig(`
site_name: Demo
nav:
  - Home: index.md
  - Reference:
      - Classes: reference/classes.md
      - reference/status.md
  - External link: https://example.com
`);
    expect(flat(navFromConfig(config.nav ?? [], noTitles))).toEqual([
      "Home → index.md",
      "[Reference]",
      "  Classes → reference/classes.md",
      "  Status → reference/status.md",
      "External link ↗ https://example.com",
    ]);
  });

  it("for a page without a title in nav it takes the H1 from the file", () => {
    const { config } = parseMkdocsConfig("nav:\n  - api/response.md\n");
    const titles = (path: string): string | undefined =>
      path === "api/response.md" ? "Response class" : undefined;
    expect(flat(navFromConfig(config.nav ?? [], titles))).toEqual([
      "Response class → api/response.md",
    ]);
  });
});

describe("navFromFiles", () => {
  it("index first, then files alphabetically, then directories", () => {
    const files = [
      "tutorial/first-steps.md",
      "about.md",
      "reference/status.md",
      "index.md",
      "reference/index.md",
      "tutorial/index.md",
    ];
    expect(flat(navFromFiles(files, noTitles))).toEqual([
      "Index → index.md",
      "About → about.md",
      "[Reference]",
      "  Index → reference/index.md",
      "  Status → reference/status.md",
      "[Tutorial]",
      "  Index → tutorial/index.md",
      "  First steps → tutorial/first-steps.md",
    ]);
  });

  it("the page title is taken from the H1 when there is one", () => {
    const titles = (path: string): string | undefined =>
      path === "about.md" ? "About" : undefined;
    expect(flat(navFromFiles(["about.md", "faq.md"], titles))).toEqual([
      "About → about.md",
      "Faq → faq.md",
    ]);
  });
});

// A project without mkdocs.yml: the tree comes from the files, the order from the directory index.
describe("navFromFolder", () => {
  const files = [
    "README.md",
    "CHANGELOG.md",
    "docs/install.md",
    "docs/usage.md",
    "docs/README.md",
    "api/index.md",
  ];

  it("puts the index first and orders the rest by the links inside it", () => {
    const links = (path: string): string[] =>
      path === "README.md"
        ? ["docs/usage.md", "api/index.md"]
        : path === "docs/README.md"
          ? ["docs/usage.md"]
          : [];
    expect(flat(navFromFolder(files, noTitles, links))).toEqual([
      "README → README.md",
      "CHANGELOG → CHANGELOG.md",
      // Directories follow the order of first mention in README: docs first, then api.
      "[Docs]",
      "  README → docs/README.md",
      "  Usage → docs/usage.md",
      "  Install → docs/install.md",
      "[Api]",
      "  Index → api/index.md",
    ]);
  });

  it("without links: README first, the rest alphabetically, no file is lost", () => {
    expect(flat(navFromFolder(files, noTitles, () => []))).toEqual([
      "README → README.md",
      "CHANGELOG → CHANGELOG.md",
      "[Api]",
      "  Index → api/index.md",
      "[Docs]",
      "  README → docs/README.md",
      "  Install → docs/install.md",
      "  Usage → docs/usage.md",
    ]);
  });

  it("collapses a chain of directories without branches", () => {
    expect(
      flat(navFromFolder(["samples/demo/docs/index.md", "readme.md"], noTitles, () => [])),
    ).toEqual([
      "Readme → readme.md",
      "[Samples / Demo / Docs]",
      "  Index → samples/demo/docs/index.md",
    ]);
  });

  it("SUMMARY.md wins over README.md", () => {
    const links = (path: string): string[] =>
      path === "SUMMARY.md" ? ["second.md", "first.md"] : ["first.md", "second.md"];
    expect(
      flat(navFromFolder(["README.md", "SUMMARY.md", "first.md", "second.md"], noTitles, links)),
    ).toEqual([
      "SUMMARY → SUMMARY.md",
      "Second → second.md",
      "First → first.md",
      "README → README.md",
    ]);
  });
});

describe("markdownLinks", () => {
  it("takes the relative page links, in order and without duplicates", () => {
    const text = [
      "# Contents",
      "- [Installation](install.md)",
      "- [Usage](./usage.md#quick-start)",
      "- [Repeat](install.md)",
      "- [Site](https://example.com/page.md)",
      "- [Code](../src/main.ts)",
      "- [Anchor](#section)",
      "",
      "[label]: guide/advanced.md",
    ].join("\n");
    expect(markdownLinks(text)).toEqual(["install.md", "./usage.md", "guide/advanced.md"]);
  });

  it("ignores links inside code blocks", () => {
    expect(markdownLinks("```md\n[X](inside.md)\n```\n\n[Y](outside.md)\n")).toEqual([
      "outside.md",
    ]);
  });
});

describe("resolveLink", () => {
  it("resolves the path relative to the source file", () => {
    expect(resolveLink("docs/README.md", "install.md")).toBe("docs/install.md");
    expect(resolveLink("docs/guide/a.md", "../b.md")).toBe("docs/b.md");
    expect(resolveLink("docs/README.md", "./x/y.md")).toBe("docs/x/y.md");
    expect(resolveLink("docs/README.md", "/root.md")).toBe("root.md");
  });
});

describe("titleFromPath", () => {
  it("turns a file name into a title following the MkDocs rules", () => {
    expect(titleFromPath("getting-started.md")).toBe("Getting started");
    expect(titleFromPath("docs/user_guide.markdown")).toBe("User guide");
    // MkDocs leaves a name that is not lowercase alone — otherwise it would come out as “Fastapi”.
    expect(titleFromPath("FastAPI.md")).toBe("FastAPI");
  });
});

describe("firstHeading", () => {
  it("finds the H1 and strips the markup", () => {
    expect(firstHeading("# Heading { #custom }\n\ntext")).toBe("Heading");
    expect(firstHeading("# `Response` class\n")).toBe("Response class");
    expect(firstHeading("Heading\n=========\n\ntext")).toBe("Heading");
  });

  it("skips front matter and code blocks", () => {
    expect(firstHeading("---\ntitle: X\n---\n\n# The real one\n")).toBe("The real one");
    expect(firstHeading("```sh\n# not heading\n```\n\n# The real one\n")).toBe("The real one");
    expect(firstHeading("## Only second level\n")).toBeUndefined();
  });
});
