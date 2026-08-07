// @vitest-environment happy-dom
//
// The left panel next to navigation.tabs. Material “lifts” the top level out of
// the panel when it is already shown as tabs (`md-nav--lifted`): repeating it
// below would be the same list twice.

import { describe, expect, it } from "vitest";
import { renderSiteNav, type SiteChromeData } from "../../webviews/shared/siteChrome";

const hooks = { openPage: () => {}, openLink: () => {} };

const DATA: SiteChromeData = {
  siteName: "Aurora Docs",
  tabs: true,
  nav: [
    { kind: "page", title: "Home", path: "index.md" },
    {
      kind: "section",
      title: "Guide",
      children: [
        { kind: "page", title: "Writing", path: "guide/writing.md" },
        {
          kind: "section",
          title: "Advanced",
          children: [{ kind: "page", title: "Annotations", path: "guide/adv/annotations.md" }],
        },
      ],
    },
    {
      kind: "section",
      title: "Reference",
      children: [{ kind: "page", title: "API", path: "reference/api.md" }],
    },
    { kind: "link", title: "Project site", href: "https://example.com" },
  ],
};

function render(data: SiteChromeData, active?: string): HTMLElement {
  const host = document.createElement("div");
  renderSiteNav(host, data, active, hooks);
  return host;
}

const lines = (host: HTMLElement): string[] =>
  [...host.querySelectorAll(".mvn-head, .mvn-item")].map((el) => (el.textContent ?? "").trim());

describe("the left panel with navigation.tabs", () => {
  it("shows the open tab and its pages, not the whole tree", () => {
    expect(lines(render(DATA, "guide/writing.md"))).toEqual([
      "Guide",
      "Writing",
      "Advanced",
      "Annotations",
    ]);
  });

  it("a tab that is one page is its own title", () => {
    // Listing “Home” under a heading that also says “Home” reads as two pages.
    expect(lines(render(DATA, "index.md"))).toEqual(["Home"]);
  });

  it("falls back to the whole tree when the page is outside the nav", () => {
    expect(lines(render(DATA, "stray.md"))).toEqual([
      "Aurora Docs",
      "Home",
      "Guide",
      "Writing",
      "Advanced",
      "Annotations",
      "Reference",
      "API",
      "Project site ↗",
    ]);
  });

  it("without tabs the panel keeps the site name and the top level", () => {
    const out = lines(render({ ...DATA, tabs: false }, "guide/writing.md"));
    expect(out[0]).toBe("Aurora Docs");
    expect(out).toContain("Reference");
  });
});
