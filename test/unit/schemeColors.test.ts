// @vitest-environment happy-dom
//
// The palette attributes the page carries.
//
// Material describes a colour pair per scheme and reads them off
// `data-md-color-primary` / `data-md-color-accent`. Several of its rules need
// BOTH the scheme and the colour — `[data-md-color-scheme=slate][data-md-color-primary=indigo]`
// is what lightens links for the dark page. Leaving the colour attribute off
// when the project names none is therefore not neutral: the dark scheme kept the
// light one's link colour, #4051b5 on the slate background, a contrast of
// 2.35:1. A built site never has that problem — its template writes indigo.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Scheme = typeof import("../../webviews/shared/scheme");

/** A fresh copy of the module: the scheme it holds is module-level state. */
async function fresh(bodyClass = ""): Promise<Scheme> {
  vi.resetModules();
  document.body.className = bodyClass;
  for (const attr of ["data-md-color-scheme", "data-md-color-primary", "data-md-color-accent"]) {
    document.body.removeAttribute(attr);
  }
  const scheme: Scheme = await import("../../webviews/shared/scheme");
  scheme.initScheme({});
  return scheme;
}

const colors = (): { primary: string | null; accent: string | null; scheme: string | null } => ({
  scheme: document.body.getAttribute("data-md-color-scheme"),
  primary: document.body.getAttribute("data-md-color-primary"),
  accent: document.body.getAttribute("data-md-color-accent"),
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("a project that names no colours", () => {
  it("still gets the pair Material itself defaults to", async () => {
    const scheme = await fresh();
    scheme.applyPalette({ light: {}, dark: {} });
    expect(colors()).toEqual({ scheme: "default", primary: "indigo", accent: "indigo" });
  });

  it("keeps them in the dark scheme, where the link colour depends on them", async () => {
    const scheme = await fresh();
    scheme.applyPalette({ light: {}, dark: {} });
    scheme.toggleTheme();
    expect(colors()).toEqual({ scheme: "slate", primary: "indigo", accent: "indigo" });
  });

  it("gets them even before a render has brought a palette", async () => {
    await fresh();
    expect(colors()).toMatchObject({ primary: "indigo", accent: "indigo" });
  });
});

describe("a project that does name them", () => {
  it("is followed, scheme by scheme", async () => {
    const scheme = await fresh();
    scheme.applyPalette({
      light: { primary: "teal", accent: "amber" },
      dark: { primary: "black", accent: "lime" },
    });
    expect(colors()).toMatchObject({ primary: "teal", accent: "amber" });
    scheme.toggleTheme();
    expect(colors()).toMatchObject({ scheme: "slate", primary: "black", accent: "lime" });
  });

  it("has the half it left out filled in, not dropped", async () => {
    const scheme = await fresh();
    scheme.applyPalette({ light: { primary: "teal" }, dark: {} });
    expect(colors()).toMatchObject({ primary: "teal", accent: "indigo" });
  });
});

describe("the scheme itself", () => {
  it("follows the VS Code theme when nothing overrides it", async () => {
    const scheme = await fresh("vscode-dark");
    expect(scheme.effectiveScheme()).toBe("slate");
    expect(colors()).toMatchObject({ scheme: "slate" });
  });
});
