import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  candidatePaths,
  externalTarget,
  findLinkTarget,
  isMarkdownPath,
  linkCandidates,
  parseDocLink,
} from "../../src/core/docLinks";

/**
 * A fixture path in the spelling of the machine running the test. The module
 * builds absolute paths with node:path, so on Windows “/p/docs/api/index.md”
 * comes back as “D:\p\docs\api\index.md” — the same file, said differently.
 * What is asserted below is which files are tried and in what order.
 */
const abs = (posix: string): string => path.resolve(posix);

const link = (href: string) => {
  const parsed = parseDocLink(href);
  if (!parsed) {
    throw new Error(`${href} did not parse`);
  }
  return parsed;
};

describe("parseDocLink", () => {
  it("tells an address of its own from a page of the project", () => {
    expect(parseDocLink("https://example.com/a")?.kind).toBe("external");
    expect(parseDocLink("mailto:doc@example.com")?.kind).toBe("external");
    expect(parseDocLink("//cdn.example.com/a.png")?.kind).toBe("external");
    expect(parseDocLink("guide/setup.md")?.kind).toBe("page");
  });

  it("keeps the anchor apart from the path", () => {
    expect(parseDocLink("#installation")).toEqual({
      kind: "anchor",
      target: "",
      hash: "installation",
    });
    expect(parseDocLink("guide/setup.md#step-2")).toEqual({
      kind: "page",
      target: "guide/setup.md",
      hash: "step-2",
    });
  });

  it("drops the query and decodes the path", () => {
    expect(parseDocLink("guide/setup.md?v=2")?.target).toBe("guide/setup.md");
    expect(parseDocLink("aper%C3%A7u.md")?.target).toBe("aperçu.md");
    // A stray percent must not throw the click away.
    expect(parseDocLink("100%.md")?.target).toBe("100%.md");
  });

  it("has nothing to follow in an empty href", () => {
    expect(parseDocLink("")).toBeUndefined();
    expect(parseDocLink("   ")).toBeUndefined();
    expect(parseDocLink("?v=2")).toBeUndefined();
  });
});

describe("linkCandidates", () => {
  it("a Markdown link means itself", () => {
    expect(linkCandidates("guide/setup.md")).toEqual(["guide/setup.md"]);
  });

  it("a directory URL is the index of that directory", () => {
    expect(linkCandidates("guide/")).toEqual(["guide/index.md", "guide/README.md"]);
  });

  it("an extensionless link is a page first of all", () => {
    expect(linkCandidates("guide/setup")).toEqual([
      "guide/setup.md",
      "guide/setup/index.md",
      "guide/setup/README.md",
      "guide/setup",
    ]);
  });

  it("an address copied from the built site leads back to the source", () => {
    expect(linkCandidates("guide/setup.html")).toEqual(["guide/setup.md", "guide/setup.html"]);
  });

  it("an ordinary file stays what it is", () => {
    expect(linkCandidates("assets/scheme.png")).toEqual(["assets/scheme.png"]);
  });
});

describe("candidatePaths", () => {
  it("a relative link counts from the page, an absolute one from docs_dir", () => {
    expect(candidatePaths(link("../api/index.md"), "/p/docs/guide", "/p/docs")).toEqual([
      abs("/p/docs/api/index.md"),
    ]);
    expect(candidatePaths(link("/api/index.md"), "/p/docs/guide", "/p/docs")).toEqual([
      abs("/p/docs/api/index.md"),
    ]);
  });

  it("an anchor and an external address lead to no file", () => {
    expect(candidatePaths(link("#top"), "/p/docs", "/p/docs")).toEqual([]);
    expect(candidatePaths(link("https://example.com"), "/p/docs", "/p/docs")).toEqual([]);
  });
});

describe("findLinkTarget", () => {
  const present = new Set([abs("/p/docs/guide/index.md"), abs("/p/docs/assets/scheme.png")]);
  const exists = async (file: string) => present.has(file);

  it("takes the first candidate that is there", async () => {
    expect(await findLinkTarget(link("guide/"), "/p/docs", "/p/docs", exists)).toBe(
      abs("/p/docs/guide/index.md"),
    );
    expect(await findLinkTarget(link("guide"), "/p/docs", "/p/docs", exists)).toBe(
      abs("/p/docs/guide/index.md"),
    );
  });

  it("says nothing when the link leads nowhere", async () => {
    expect(await findLinkTarget(link("missing.md"), "/p/docs", "/p/docs", exists)).toBeUndefined();
  });

  it("finds a file that is not a page either", async () => {
    const file = await findLinkTarget(link("assets/scheme.png"), "/p/docs", "/p/docs", exists);
    expect(file).toBe(abs("/p/docs/assets/scheme.png"));
    expect(isMarkdownPath(file!)).toBe(false);
  });
});

describe("externalTarget", () => {
  it("passes through the schemes a reader expects", () => {
    expect(externalTarget("https://example.com/a")).toBe("https://example.com/a");
    expect(externalTarget("http://example.com")).toBe("http://example.com");
    expect(externalTarget("mailto:doc@example.com")).toBe("mailto:doc@example.com");
    expect(externalTarget("HTTPS://Example.COM")).toBe("HTTPS://Example.COM");
  });

  it("gives a protocol-relative address the scheme the site would have", () => {
    expect(externalTarget("//cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
  });

  it("refuses a scheme that would reach past the browser", () => {
    // A page is text somebody else wrote; none of these is worth a click.
    expect(externalTarget("file:///etc/passwd")).toBeUndefined();
    expect(externalTarget("vscode://ms-vscode.remote/x")).toBeUndefined();
    expect(externalTarget("command:workbench.action.terminal.new")).toBeUndefined();
    expect(externalTarget("javascript:alert(1)")).toBeUndefined();
    expect(externalTarget("  JavaScript:alert(1)")).toBeUndefined();
    expect(externalTarget("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  it("refuses an address with no scheme — that is a page of the project", () => {
    expect(externalTarget("guide/setup.md")).toBeUndefined();
  });
});
