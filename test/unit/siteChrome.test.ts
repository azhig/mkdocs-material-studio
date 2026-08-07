// @vitest-environment happy-dom
//
// The site header, drawn the same way in the preview and in the visual editor.
// Everything in that strip is read out of mkdocs.yml — the name, the section
// tabs, the repository link — which is why the button that opens the config
// editor lives there too. It is optional: the preview has one on its toolbar
// instead, and asking for it twice in the same window would be two buttons for
// one thing.

import { beforeEach, describe, expect, it } from "vitest";
import type { SiteNode } from "../../src/core/siteNavBuild";
import {
  renderSiteHeader,
  renderSiteNav,
  type SiteChromeData,
  type SiteChromeHooks,
} from "../../webviews/shared/siteChrome";

const NAV: SiteNode[] = [
  { kind: "page", title: "Home", path: "index.md" },
  {
    kind: "section",
    title: "Guide",
    children: [
      { kind: "page", title: "Writing", path: "guide/writing.md" },
      { kind: "page", title: "Diagrams", path: "guide/diagrams.md" },
    ],
  },
  { kind: "link", title: "Project site", href: "https://example.com" },
];

const DATA: SiteChromeData = {
  siteName: "Aurora Docs",
  repoUrl: "https://github.com/example/aurora",
  repoName: "example/aurora",
  tabs: true,
  nav: NAV,
};

interface Calls {
  pages: string[];
  links: string[];
  settings: number;
}

let host: HTMLElement;
let calls: Calls;

/** The hooks the visual editor passes: it is the one with the header button. */
function editorHooks(): SiteChromeHooks {
  return {
    openPage: (path) => calls.pages.push(path),
    openLink: (href) => calls.links.push(href),
    openSettings: () => {
      calls.settings++;
    },
  };
}

/** The hooks the preview passes: no header button, it has a toolbar one. */
function previewHooks(): SiteChromeHooks {
  return {
    openPage: (path) => calls.pages.push(path),
    openLink: (href) => calls.links.push(href),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("header");
  host.className = "mv-head";
  document.body.appendChild(host);
  calls = { pages: [], links: [], settings: 0 };
});

describe("the mkdocs.yml button in the header", () => {
  it("is there when the editor asks for it", () => {
    renderSiteHeader(host, DATA, "index.md", editorHooks());
    const gear = host.querySelector<HTMLElement>(".mvh-settings");
    expect(gear).not.toBe(null);
    expect(gear!.title).toBe("Site settings — mkdocs.yml");
    expect(gear!.getAttribute("aria-label")).toBe(gear!.title);
  });

  it("is not there for the preview, which has its own on the toolbar", () => {
    renderSiteHeader(host, DATA, "index.md", previewHooks());
    expect(host.querySelector(".mvh-settings")).toBe(null);
  });

  it("opens the settings on a click, and nothing else", () => {
    renderSiteHeader(host, DATA, "index.md", editorHooks());
    host.querySelector<HTMLElement>(".mvh-settings")!.click();
    expect(calls.settings).toBe(1);
    expect(calls.links).toEqual([]);
    expect(calls.pages).toEqual([]);
  });

  it("sits before the repository link, which stays the rightmost thing", () => {
    renderSiteHeader(host, DATA, "index.md", editorHooks());
    const order = Array.from(host.querySelectorAll(".mvh-inner > *")).map((el) => el.className);
    expect(order).toEqual([
      "mvh-logo mvh-logo-default",
      "mvh-title",
      "mvh-tabs",
      "mvh-settings",
      "mvh-repo",
    ]);
  });

  it("is still there for a project without a repository", () => {
    renderSiteHeader(host, { ...DATA, repoUrl: undefined }, "index.md", editorHooks());
    expect(host.querySelector(".mvh-settings")).not.toBe(null);
    expect(host.querySelector(".mvh-repo")).toBe(null);
  });

  it("is absent outside an MkDocs project — there is no mkdocs.yml to open", () => {
    renderSiteHeader(host, undefined, undefined, editorHooks());
    expect(host.querySelector(".mvh-settings")).toBe(null);
    expect(host.textContent).toContain("MkDocs project not found");
  });
});

describe("the rest of the header", () => {
  it("shows the site name and the top-level tabs", () => {
    renderSiteHeader(host, DATA, "index.md", editorHooks());
    expect(host.querySelector(".mvh-title")?.textContent).toBe("Aurora Docs");
    expect(Array.from(host.querySelectorAll(".mvh-tab")).map((el) => el.textContent)).toEqual([
      "Home",
      "Guide",
      "Project site",
    ]);
  });

  it("marks the tab the open page belongs to", () => {
    renderSiteHeader(host, DATA, "guide/diagrams.md", editorHooks());
    const on = Array.from(host.querySelectorAll(".mvh-tab.on")).map((el) => el.textContent);
    expect(on).toEqual(["Guide"]);
  });

  it("a section tab opens its first page, a link tab goes outside", () => {
    renderSiteHeader(host, DATA, "index.md", editorHooks());
    const tabs = host.querySelectorAll<HTMLElement>(".mvh-tab");
    tabs[1].click();
    tabs[2].click();
    expect(calls.pages).toEqual(["guide/writing.md"]);
    expect(calls.links).toEqual(["https://example.com"]);
  });

  it("without tabs the name is followed by a spacer, not by an empty tab strip", () => {
    renderSiteHeader(host, { ...DATA, tabs: false }, "index.md", previewHooks());
    expect(host.querySelector(".mvh-tabs")).toBe(null);
    expect(host.querySelector(".mvh-grow")).not.toBe(null);
  });

  it("the repository button carries its address in the tooltip", () => {
    renderSiteHeader(host, DATA, "index.md", previewHooks());
    const repo = host.querySelector<HTMLElement>(".mvh-repo")!;
    expect(repo.textContent).toBe("example/aurora");
    expect(repo.title).toBe("https://github.com/example/aurora");
    repo.click();
    expect(calls.links).toEqual(["https://github.com/example/aurora"]);
  });
});

describe("the page panel", () => {
  let nav: HTMLElement;
  beforeEach(() => {
    nav = document.createElement("aside");
    nav.className = "mv-nav";
    document.body.appendChild(nav);
  });

  it("says so outside an MkDocs project", () => {
    renderSiteNav(nav, undefined, undefined, previewHooks());
    expect(nav.textContent).toContain("MkDocs project not found");
  });

  it("says so for a project whose nav is empty", () => {
    renderSiteNav(nav, { ...DATA, nav: [] }, undefined, previewHooks());
    expect(nav.querySelector(".mvn-head")?.textContent).toBe("Aurora Docs");
    expect(nav.textContent).toContain("No pages found");
  });
});
