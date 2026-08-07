import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { parseMkdocsConfig } from "../../src/core/mkdocsConfigParse";
import { resolvePalette } from "../../src/core/paletteResolve";

// samples/demo is what a developer opens to check the extension by hand, so it
// has to stay a project the extension actually understands: a broken sample
// looks exactly like a broken feature.

const ROOT = path.resolve(__dirname, "../../samples/demo");
const { config } = parseMkdocsConfig(readFileSync(path.join(ROOT, "mkdocs.yml"), "utf8"));

/** Every page mentioned in the nav, flattened. */
function navPages(items = config.nav ?? []): string[] {
  return items.flatMap((item) => (item.kind === "section" ? navPages(item.children) : [item.path]));
}

describe("the sample project", () => {
  it("survives the python tags a real mkdocs.yml carries", () => {
    // `!!python/name:material.extensions.emoji.twemoji` is not YAML the parser
    // knows — it must not take the rest of the file down with it.
    const names = config.markdownExtensions.map((e) => e.name);
    expect(names).toContain("pymdownx.emoji");
    expect(names).toContain("pymdownx.superfences");
    expect(config.siteName).toBe("Aurora Docs");
  });

  it("describes both palettes", () => {
    const palette = resolvePalette(config.theme.palette, { light: {}, dark: {} });
    expect(palette.light).toEqual({ primary: "deep-purple", accent: "amber" });
    expect(palette.dark).toEqual({ primary: "deep-purple", accent: "amber" });
  });

  it("has the header filled in: the logo, the repository, the tabs", () => {
    expect(config.theme.icon?.logo).toBe("material/rocket-launch");
    expect(config.repoUrl).toBe("https://github.com/example/aurora");
    expect(config.theme.features).toContain("navigation.tabs");
    expect(config.extraCss).toEqual(["stylesheets/extra.css"]);
  });

  it("every page of the nav is on disk", () => {
    // The last nav entry is an address of its own — the header turns it into a
    // link, and there is no file behind it.
    const pages = navPages().filter((p) => !/^[a-z][a-z0-9+.-]*:/i.test(p));
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      expect(existsSync(path.join(ROOT, config.docsDir, page)), page).toBe(true);
    }
  });

  it("the files the theme points at are on disk too", () => {
    for (const rel of [...config.extraCss, "assets/favicon.svg"]) {
      expect(existsSync(path.join(ROOT, config.docsDir, rel)), rel).toBe(true);
    }
  });
});
