// @vitest-environment happy-dom
//
// The path arithmetic behind a link to another page. MkDocs resolves a link
// relative to the file it is written in, so the same target page is a different
// string depending on which page is being edited. Get this wrong and the link
// still looks right in the editor and 404s on the built site — which is why it
// is worth pinning down separately from the form that uses it.

import { describe, expect, it } from "vitest";
import { chromePages, relativeDocPath } from "../../webviews/visual/mediaLinks";
import type { SiteNode } from "../../src/core/siteNavBuild";

describe("a link from one page to another", () => {
  it("is the bare name between neighbours", () => {
    expect(relativeDocPath("guide/writing.md", "guide/diagrams.md")).toBe("diagrams.md");
  });

  it("goes down into a folder", () => {
    expect(relativeDocPath("index.md", "guide/writing.md")).toBe("guide/writing.md");
  });

  it("climbs back out of one", () => {
    expect(relativeDocPath("guide/writing.md", "index.md")).toBe("../index.md");
  });

  it("climbs out of several", () => {
    expect(relativeDocPath("guide/advanced/annotations.md", "index.md")).toBe("../../index.md");
  });

  it("crosses between branches", () => {
    expect(relativeDocPath("guide/writing.md", "reference/api.md")).toBe("../reference/api.md");
  });

  it("keeps the shared prefix out of the path", () => {
    expect(relativeDocPath("a/b/c/one.md", "a/b/d/two.md")).toBe("../d/two.md");
  });

  it("is the page itself when it is its own target", () => {
    expect(relativeDocPath("guide/writing.md", "guide/writing.md")).toBe("writing.md");
  });

  it("is the plain path when there is no page to be relative to", () => {
    // No mkdocs.yml, or the document is not inside the docs folder yet.
    expect(relativeDocPath(undefined, "guide/writing.md")).toBe("guide/writing.md");
  });
});

describe("the pages offered while typing a link", () => {
  const nav: SiteNode[] = [
    { kind: "page", path: "index.md", title: "Home" },
    {
      kind: "section",
      title: "Guide",
      children: [
        { kind: "page", path: "guide/writing.md", title: "Writing" },
        {
          kind: "section",
          title: "Advanced",
          children: [{ kind: "page", path: "guide/advanced/annotations.md", title: "Annotations" }],
        },
      ],
    },
  ] as SiteNode[];

  it("are every page of the site, however deep the sections go", () => {
    expect(chromePages(nav)).toEqual([
      { path: "index.md", title: "Home" },
      { path: "guide/writing.md", title: "Writing" },
      { path: "guide/advanced/annotations.md", title: "Annotations" },
    ]);
  });

  it("are none for an empty tree", () => {
    expect(chromePages([])).toEqual([]);
  });

  it("skip anything that is neither a page nor a section", () => {
    const withLink = [
      { kind: "link", title: "External", url: "https://example.com" },
      { kind: "page", path: "index.md", title: "Home" },
    ] as SiteNode[];
    expect(chromePages(withLink)).toEqual([{ path: "index.md", title: "Home" }]);
  });
});
