// Rendering of the site header and the left navigation panel in a webview.
// Shared module: works the same in the lightweight preview and in the visual editor,
// the data arrives from the extension in the `siteChrome` message
// (see src/core/siteChrome.ts).

import type { SiteNode } from "../../src/core/siteNavBuild";
import { inkFor } from "./contrast";
import { t } from "./i18n";

export interface SiteChromeData {
  siteName: string;
  logoUri?: string;
  logoSvg?: string;
  repoUrl?: string;
  repoName?: string;
  tabs: boolean;
  nav: SiteNode[];
}

export interface SiteChromeHooks {
  /** Page click: path relative to docs_dir. */
  openPage: (path: string) => void;
  /** Click on an external link (repository, URL item in nav). */
  openLink: (href: string) => void;
  /**
   * Opens the `mkdocs.yml` editor. Optional on purpose: the header is shared,
   * and only the visual editor puts the button in it — the preview has its own
   * on the toolbar, where there is room for it.
   */
  openSettings?: () => void;
}

/**
 * Sections expanded/collapsed by the user manually. By default only the path to
 * the active page is expanded — as in Material without navigation.expand.
 */
const manualOpen = new Map<string, boolean>();

/** No data — the file is opened outside an MkDocs project (no mkdocs.yml nearby). */
const NO_PROJECT = t("MkDocs project not found");

/** Header: logo, site name, top-level tabs, repository link. */
export function renderSiteHeader(
  host: HTMLElement,
  data: SiteChromeData | undefined,
  active: string | undefined,
  hooks: SiteChromeHooks,
): void {
  host.textContent = "";
  const inner = div("mvh-inner", host);
  if (!data) {
    // The button was pressed outside an MkDocs project — say plainly why it is empty.
    div("mvh-title", inner).textContent = NO_PROJECT;
    return;
  }

  const logo = div("mvh-logo", inner);
  if (data.logoUri) {
    const img = document.createElement("img");
    img.src = data.logoUri;
    img.alt = "";
    logo.appendChild(img);
  } else if (data.logoSvg) {
    // SVG from our own assets (theme.icon.logo) — inserted as markup.
    logo.innerHTML = data.logoSvg;
  } else {
    logo.classList.add("mvh-logo-default");
  }

  const title = div("mvh-title", inner);
  title.textContent = data.siteName;

  if (data.tabs) {
    const tabs = div("mvh-tabs", inner);
    for (const node of data.nav) {
      const target = firstPageOf(node);
      const tab = document.createElement("button");
      tab.className = "mvh-tab";
      tab.textContent = nodeTitle(node);
      if (active !== undefined && containsPage(node, active)) {
        tab.classList.add("on");
      }
      if (node.kind === "link") {
        tab.addEventListener("click", () => hooks.openLink(node.href));
      } else if (target) {
        tab.addEventListener("click", () => hooks.openPage(target));
      } else {
        tab.disabled = true;
      }
      tabs.appendChild(tab);
    }
  } else {
    div("mvh-grow", inner);
  }

  // Everything in this bar — the name, the tabs, the repository link — is read
  // out of mkdocs.yml, so it is where a reader already looks when they want to
  // change one of them.
  const openSettings = hooks.openSettings;
  if (openSettings) {
    const gear = document.createElement("button");
    gear.className = "mvh-settings";
    gear.title = t("Site settings — mkdocs.yml");
    gear.setAttribute("aria-label", gear.title);
    const icon = document.createElement("span");
    icon.className = "codicon codicon-settings-gear";
    gear.appendChild(icon);
    gear.addEventListener("click", () => openSettings());
    inner.appendChild(gear);
  }

  if (data.repoUrl) {
    const repo = document.createElement("button");
    repo.className = "mvh-repo";
    repo.textContent = data.repoName ?? t("Repository");
    repo.title = data.repoUrl;
    const href = data.repoUrl;
    repo.addEventListener("click", () => hooks.openLink(href));
    inner.appendChild(repo);
  }

  keepHeaderReadable(host);
}

/**
 * Repaints the header ink when the stylesheets have left it unreadable — see
 * contrast.ts for how that happens. Everything in the bar inherits its color, so
 * one property on the bar covers the name, the tabs and the repository link.
 *
 * Call after anything that can change the colors: the render above, a scheme
 * switch, a fresh extra_css.
 */
export function keepHeaderReadable(host: HTMLElement): void {
  // Measure what the stylesheets say now, not what this function wrote last time.
  host.style.removeProperty("color");
  const style = getComputedStyle(host);
  const ink = inkFor(style.backgroundColor, style.color);
  if (ink !== null) {
    host.style.color = ink;
  }
}

/** Left panel: tree of site pages with the open one highlighted. */
export function renderSiteNav(
  host: HTMLElement,
  data: SiteChromeData | undefined,
  active: string | undefined,
  hooks: SiteChromeHooks,
): void {
  host.textContent = "";
  if (!data) {
    div("mvn-empty", host).textContent = NO_PROJECT;
    return;
  }
  if (data.nav.length === 0) {
    div("mvn-head", host).textContent = data.siteName;
    const empty = div("mvn-empty", host);
    empty.textContent = t("No pages found");
    return;
  }

  // With navigation.tabs the top level has already been said once — in the
  // header. Material lifts it out of the panel entirely (`md-nav--lifted`):
  // the site name goes away, the open tab's own title becomes the heading, and
  // the panel holds that tab's pages and nothing else.
  const lifted =
    data.tabs && active !== undefined
      ? data.nav.find((node) => containsPage(node, active))
      : undefined;

  if (lifted) {
    div("mvn-head mvn-head-tab", host).textContent = lifted.title;
    // A tab that is a single page has nothing to list: its title above IS the
    // page, and repeating it as the only item would read as two entries.
    if (lifted.kind === "section") {
      host.appendChild(buildList(lifted.children, active, hooks, ""));
    }
  } else {
    div("mvn-head", host).textContent = data.siteName;
    host.appendChild(buildList(data.nav, active, hooks, ""));
  }

  const current = host.querySelector<HTMLElement>(".mvn-page.on");
  if (current) {
    scrollIntoPanel(host, current);
  }
}

/**
 * Scrolls THE PANEL ITSELF to the active page. `scrollIntoView` is not suitable
 * here: it drags the outer scroller too — opening a document would scroll the
 * page down to the navigation item.
 */
function scrollIntoPanel(host: HTMLElement, el: HTMLElement): void {
  const view = host.getBoundingClientRect();
  const item = el.getBoundingClientRect();
  if (item.top < view.top) {
    host.scrollTop -= view.top - item.top;
  } else if (item.bottom > view.bottom) {
    host.scrollTop += item.bottom - view.bottom;
  }
}

function buildList(
  nodes: SiteNode[],
  active: string | undefined,
  hooks: SiteChromeHooks,
  keyPrefix: string,
): HTMLElement {
  const list = document.createElement("ul");
  list.className = "mvn-list";
  for (const node of nodes) {
    list.appendChild(buildItem(node, active, hooks, keyPrefix));
  }
  return list;
}

function buildItem(
  node: SiteNode,
  active: string | undefined,
  hooks: SiteChromeHooks,
  keyPrefix: string,
): HTMLElement {
  const li = document.createElement("li");
  li.className = "mvn-node";

  if (node.kind === "section") {
    const key = `${keyPrefix}/${node.title}`;
    const hasActive = active !== undefined && containsPage(node, active);
    const open = manualOpen.get(key) ?? hasActive;
    li.classList.add("mvn-sec");
    li.classList.toggle("open", open);

    const toggle = document.createElement("button");
    toggle.className = "mvn-item mvn-toggle";
    toggle.setAttribute("aria-expanded", String(open));
    div("mvn-caret", toggle);
    const label = document.createElement("span");
    label.textContent = node.title;
    toggle.appendChild(label);
    toggle.addEventListener("click", () => {
      const next = !li.classList.contains("open");
      manualOpen.set(key, next);
      li.classList.toggle("open", next);
      toggle.setAttribute("aria-expanded", String(next));
    });
    li.appendChild(toggle);
    li.appendChild(buildList(node.children, active, hooks, key));
    return li;
  }

  const item = document.createElement("button");
  item.className = "mvn-item";
  item.textContent = node.kind === "page" ? node.title : `${node.title} ↗`;
  if (node.kind === "page") {
    item.classList.add("mvn-page");
    item.title = node.path;
    item.classList.toggle("on", node.path === active);
    item.addEventListener("click", () => hooks.openPage(node.path));
  } else {
    item.classList.add("mvn-link");
    item.title = node.href;
    item.addEventListener("click", () => hooks.openLink(node.href));
  }
  li.appendChild(item);
  return li;
}

/** Whether the subtree contains the page — for tab highlighting and section expansion. */
function containsPage(node: SiteNode, path: string): boolean {
  if (node.kind === "page") {
    return node.path === path;
  }
  if (node.kind === "section") {
    return node.children.some((child) => containsPage(child, path));
  }
  return false;
}

/** First page of the subtree — opened by a click on a section tab. */
function firstPageOf(node: SiteNode): string | undefined {
  if (node.kind === "page") {
    return node.path;
  }
  if (node.kind === "section") {
    for (const child of node.children) {
      const found = firstPageOf(child);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

function nodeTitle(node: SiteNode): string {
  return node.title;
}

function div(className: string, parent: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  parent.appendChild(el);
  return el;
}
