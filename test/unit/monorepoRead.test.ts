// Reading the configs a monorepo nav includes, off a real directory tree.
//
// The layout below is the one from the bug report: a root site whose nav is two
// `!include` entries, each pointing at a config with pages and a stylesheet of
// its own.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { loadExtraCss } from "../../src/core/extraCss";
import { readMkdocsConfig } from "../../src/core/mkdocsConfig";
import { collectSections, expandedNav, sectionConfigFiles } from "../../src/core/monorepo";
import type { MkdocsProject, ProjectService } from "../../src/core/projectService";
import { activePagePath, buildSiteChrome, chromeScope, pageUri } from "../../src/core/siteChrome";
import { MkdocsTreeProvider } from "../../src/tree/treeProvider";

let root: string;
let project: MkdocsProject;

function write(rel: string, text: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "monorepo-"));
  write(
    "mkdocs.yml",
    [
      "site_name: Documentation",
      "nav:",
      "  - Home: index.md",
      "  - Library: '!include ./lib/mkdocs.yml'",
      "  - Tools: '!include ./conv/user_docs/mkdocs.yml'",
      "extra_css:",
      "  - lib/stylesheets/extra.css",
      "  - stylesheets/site.css",
      "",
    ].join("\n"),
  );
  write(
    "lib/mkdocs.yml",
    ["site_name: lib", "nav:", "  - Home page: 2/index.md", "  - Metrics: 4/index.md", ""].join(
      "\n",
    ),
  );
  write(
    "conv/user_docs/mkdocs.yml",
    [
      "site_name: conv/user_docs",
      "nav:",
      "  - Get started: get_started.md",
      // No title in nav: it has to come from the H1 of the file, which lives in
      // the section's docs_dir rather than in the root one.
      "  - index.md",
      "",
    ].join("\n"),
  );
  write("docs/index.md", "# Documentation\n");
  write("lib/docs/2/index.md", "# Home page\n");
  write("lib/docs/4/index.md", "# Metrics\n");
  write("conv/user_docs/docs/get_started.md", "# Get started\n");
  write("conv/user_docs/docs/index.md", "# Developer tools\n");
  // The stylesheet of a section lives in the section's own docs_dir, while
  // extra_css spells it with the section prefix instead.
  write("lib/docs/stylesheets/extra.css", ".md-header { background: #16171d; }\n");
  write("docs/stylesheets/site.css", "body { font-size: 16px; }\n");
  const rootUri = vscode.Uri.file(root);
  project = {
    root: rootUri,
    configFile: vscode.Uri.joinPath(rootUri, "mkdocs.yml"),
    docsDir: vscode.Uri.joinPath(rootUri, "docs"),
  };
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function sections() {
  const { config } = await readMkdocsConfig(project.configFile);
  return { config, sections: await collectSections(project, config) };
}

describe("the sections of a monorepo", () => {
  it("takes the URL prefix from site_name of the included config", async () => {
    const { sections: map } = await sections();
    expect([...map.keys()].sort()).toEqual(["conv/user_docs/mkdocs.yml", "lib/mkdocs.yml"]);
    expect(map.get("lib/mkdocs.yml")?.prefix).toBe("lib");
    expect(map.get("conv/user_docs/mkdocs.yml")?.prefix).toBe("conv/user_docs");
  });

  it("resolves docs_dir against the included config, not against the root", async () => {
    const { sections: map } = await sections();
    expect(map.get("lib/mkdocs.yml")?.docsDir).toBe("lib/docs");
    expect(map.get("conv/user_docs/mkdocs.yml")?.docsDir).toBe("conv/user_docs/docs");
  });

  it("carries the prefix into the pages of the section", async () => {
    const { sections: map } = await sections();
    expect(map.get("lib/mkdocs.yml")?.nav).toEqual([
      { kind: "page", title: "Home page", path: "lib/2/index.md" },
      { kind: "page", title: "Metrics", path: "lib/4/index.md" },
    ]);
  });

  it("turns the root nav into tabs with the section pages under them", async () => {
    const { config, sections: map } = await sections();
    expect(expandedNav(config, map)).toEqual([
      { kind: "page", title: "Home", path: "index.md" },
      {
        kind: "section",
        title: "Library",
        children: [
          { kind: "page", title: "Home page", path: "lib/2/index.md" },
          { kind: "page", title: "Metrics", path: "lib/4/index.md" },
        ],
      },
      {
        kind: "section",
        title: "Tools",
        children: [
          { kind: "page", title: "Get started", path: "conv/user_docs/get_started.md" },
          // No title in the included nav — the H1 is read later, by siteChrome.
          { kind: "page", path: "conv/user_docs/index.md" },
        ],
      },
    ]);
  });

  it("names the config files, so a watcher can follow them", async () => {
    const { sections: map } = await sections();
    expect(sectionConfigFiles(project, map).map((u) => path.basename(u.fsPath))).toEqual([
      "mkdocs.yml",
      "mkdocs.yml",
    ]);
  });
});

describe("the stylesheets of a monorepo", () => {
  it("finds the section stylesheet where the section keeps it", async () => {
    // The reported defect: this file was looked for in docs/lib/stylesheets/ and
    // the whole custom theme silently never arrived.
    const result = await loadExtraCss(project, (u) => u.toString());
    expect(result.css).toContain("#16171d");
    expect(
      result.files.map((u) => path.relative(root, u.fsPath).split(path.sep).join("/")),
    ).toEqual(["lib/docs/stylesheets/extra.css", "docs/stylesheets/site.css"]);
  });
});

describe("the header and the page panel of a monorepo", () => {
  const page = (rel: string) => vscode.Uri.joinPath(vscode.Uri.file(root), rel);

  async function chrome() {
    const scope = await chromeScope(page("lib/docs/2/index.md"), project);
    const data = await buildSiteChrome(scope, (u) => u.toString(), vscode.Uri.file(root));
    return { scope, data };
  }

  it("shows the sections as top-level entries with their pages inside", async () => {
    const { data } = await chrome();
    expect(data.nav).toEqual([
      { kind: "page", title: "Home", path: "index.md" },
      {
        kind: "section",
        title: "Library",
        children: [
          { kind: "page", title: "Home page", path: "lib/2/index.md" },
          { kind: "page", title: "Metrics", path: "lib/4/index.md" },
        ],
      },
      {
        kind: "section",
        title: "Tools",
        children: [
          { kind: "page", title: "Get started", path: "conv/user_docs/get_started.md" },
          // Taken from the H1 of conv/user_docs/docs/index.md.
          { kind: "page", title: "Developer tools", path: "conv/user_docs/index.md" },
        ],
      },
    ]);
  });

  it("knows the open page of a section by its prefixed path", async () => {
    const { scope } = await chrome();
    expect(activePagePath(scope, page("lib/docs/2/index.md"))).toBe("lib/2/index.md");
    expect(activePagePath(scope, page("docs/index.md"))).toBe("index.md");
    expect(activePagePath(scope, page("elsewhere/notes.md"))).toBeUndefined();
  });

  it("opens a section page from the file it really lives in", async () => {
    const { scope } = await chrome();
    expect(pageUri(scope, "conv/user_docs/get_started.md").fsPath).toBe(
      path.join(root, "conv", "user_docs", "docs", "get_started.md"),
    );
    expect(pageUri(scope, "index.md").fsPath).toBe(path.join(root, "docs", "index.md"));
  });
});

describe("the project tree of a monorepo", () => {
  function provider() {
    const projects = { getProjects: async () => [project] } as unknown as ProjectService;
    return new MkdocsTreeProvider(projects);
  }

  it("shows an !include entry as a section with the pages of its config", async () => {
    const roots = await provider().getChildren();
    const library = roots.find((n) => n.title === "Library");
    expect(library?.type).toBe("section");
    expect(library?.children?.map((c) => c.title)).toEqual(["Home page", "Metrics"]);
    expect(library?.children?.[0].fileUri?.fsPath).toBe(
      path.join(root, "lib", "docs", "2", "index.md"),
    );
  });

  it("lets the entry itself be moved but not the lines of the included config", async () => {
    const roots = await provider().getChildren();
    const library = roots.find((n) => n.title === "Library");
    // The entry is a line of THIS nav — dragging it rewrites this config.
    expect(library?.navPath).toEqual([1]);
    // Its contents are lines of lib/mkdocs.yml; writing them back here would
    // edit the wrong file, so they carry no nav path at all.
    expect(library?.children?.every((c) => c.navPath === undefined)).toBe(true);
  });

  it("counts a page of a section as being in the navigation", async () => {
    const roots = await provider().getChildren();
    const loose = roots.find((n) => n.type === "looseGroup");
    const titles = loose?.children?.map((c) => c.title) ?? [];
    expect(titles).not.toContain("lib/2/index.md");
    // The stylesheet directory holds no pages, so nothing else creeps in either.
    expect(titles).toEqual([]);
  });
});

describe("a section with no nav of its own", () => {
  it("is its files, the way MkDocs builds a site without nav", async () => {
    write(
      "plain/mkdocs.yml",
      ["site_name: Docs", "nav:", "  - Notes: '!include ./notes/mkdocs.yml'", ""].join("\n"),
    );
    write("plain/notes/mkdocs.yml", "site_name: notes\n");
    write("plain/notes/docs/index.md", "# Notes\n");
    write("plain/notes/docs/deep/page.md", "# A page\n");
    const configFile = vscode.Uri.joinPath(vscode.Uri.file(root), "plain", "mkdocs.yml");
    const { config } = await readMkdocsConfig(configFile);
    const plain: MkdocsProject = {
      root: vscode.Uri.joinPath(configFile, ".."),
      configFile,
      docsDir: vscode.Uri.joinPath(configFile, "..", "docs"),
    };
    const map = await collectSections(plain, config);
    expect(map.get("notes/mkdocs.yml")?.nav).toEqual([
      { kind: "page", path: "notes/index.md" },
      { kind: "section", title: "Deep", children: [{ kind: "page", path: "notes/deep/page.md" }] },
    ]);
  });
});

describe("the monorepo sample in the repository", () => {
  // samples/monorepo is what a developer opens to check this by hand — a sample
  // the extension misreads looks exactly like a broken feature.
  const sampleRoot = path.resolve(__dirname, "../../samples/monorepo");
  const sample: MkdocsProject = {
    root: vscode.Uri.file(sampleRoot),
    configFile: vscode.Uri.file(path.join(sampleRoot, "mkdocs.yml")),
    docsDir: vscode.Uri.file(path.join(sampleRoot, "docs")),
  };

  it("reads as two sections, one of them built from its files", async () => {
    const { config } = await readMkdocsConfig(sample.configFile);
    const map = await collectSections(sample, config);
    expect([...map.keys()].sort()).toEqual(["lib/mkdocs.yml", "tools/mkdocs.yml"]);
    expect(map.get("lib/mkdocs.yml")?.nav).toEqual([
      { kind: "page", title: "Overview", path: "lib/index.md" },
      { kind: "page", title: "Metrics", path: "lib/guide/metrics.md" },
    ]);
    expect(map.get("tools/mkdocs.yml")?.nav).toEqual([
      { kind: "page", path: "tools/index.md" },
      { kind: "page", path: "tools/get-started.md" },
    ]);
  });

  it("finds the stylesheet its extra_css names with the section prefix", async () => {
    const result = await loadExtraCss(sample, (u) => u.toString());
    expect(result.css).toContain("--md-primary-fg-color");
    expect(result.files).toHaveLength(1);
  });

  it("marks the open page of a section for the webview", async () => {
    const doc = vscode.Uri.file(path.join(sampleRoot, "lib", "docs", "guide", "metrics.md"));
    const scope = await chromeScope(doc, sample);
    expect(activePagePath(scope, doc)).toBe("lib/guide/metrics.md");
    const data = await buildSiteChrome(scope, (u) => u.toString(), vscode.Uri.file(sampleRoot));
    expect(data.tabs).toBe(true);
    expect(data.nav.map((n) => n.title)).toEqual(["Home", "Library", "Tools"]);
  });
});

describe("a monorepo that is not quite right", () => {
  it("keeps the rest of the site when one included config is missing", async () => {
    write(
      "broken/mkdocs.yml",
      ["site_name: Docs", "nav:", "  - Gone: '!include ./nowhere/mkdocs.yml'", ""].join("\n"),
    );
    const configFile = vscode.Uri.joinPath(vscode.Uri.file(root), "broken", "mkdocs.yml");
    const { config } = await readMkdocsConfig(configFile);
    const broken: MkdocsProject = {
      root: vscode.Uri.joinPath(configFile, ".."),
      configFile,
      docsDir: vscode.Uri.joinPath(configFile, "..", "docs"),
    };
    const map = await collectSections(broken, config);
    expect(map.size).toBe(0);
    // The entry stays as a section with nothing in it — a title with no pages
    // says “this part did not load”, a vanished tab says nothing at all.
    expect(expandedNav(config, map)).toEqual([{ kind: "section", title: "Gone", children: [] }]);
  });

  it("stops instead of spinning when two configs include each other", async () => {
    write(
      "loop/mkdocs.yml",
      ["site_name: loop", "nav:", "  - Back: '!include ./b/mkdocs.yml'", ""].join("\n"),
    );
    write(
      "loop/b/mkdocs.yml",
      ["site_name: b", "nav:", "  - Up: '!include ../mkdocs.yml'", ""].join("\n"),
    );
    const configFile = vscode.Uri.joinPath(vscode.Uri.file(root), "loop", "mkdocs.yml");
    const { config } = await readMkdocsConfig(configFile);
    const looping: MkdocsProject = {
      root: vscode.Uri.joinPath(configFile, ".."),
      configFile,
      docsDir: vscode.Uri.joinPath(configFile, "..", "docs"),
    };
    const map = await collectSections(looping, config);
    // `../mkdocs.yml` leaves the project and is refused outright, so only the
    // one section is read — and nothing loops.
    expect([...map.keys()]).toEqual(["b/mkdocs.yml"]);
  });
});
