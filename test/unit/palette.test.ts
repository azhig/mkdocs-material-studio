import { describe, it, expect } from "vitest";
import { resolvePalette, normalizeColor } from "../../src/core/paletteResolve";

const NO_SETTINGS = { light: {}, dark: {} };

describe("normalizeColor", () => {
  it("turns the mkdocs.yml spelling into the attribute one", () => {
    expect(normalizeColor("deep purple")).toBe("deep-purple");
    expect(normalizeColor("  Light Blue ")).toBe("light-blue");
  });

  it("treats an empty value as “not set”", () => {
    expect(normalizeColor("")).toBeUndefined();
    expect(normalizeColor("   ")).toBeUndefined();
    expect(normalizeColor(undefined)).toBeUndefined();
  });
});

describe("resolvePalette", () => {
  it("splits the mkdocs.yml entries by scheme", () => {
    const out = resolvePalette(
      [
        { scheme: "default", primary: "indigo", accent: "pink" },
        { scheme: "slate", primary: "deep purple", accent: "amber" },
      ],
      NO_SETTINGS,
    );
    expect(out.light).toEqual({ primary: "indigo", accent: "pink" });
    expect(out.dark).toEqual({ primary: "deep-purple", accent: "amber" });
  });

  it("counts an entry without a scheme as the light one", () => {
    const out = resolvePalette({ primary: "teal" }, NO_SETTINGS);
    expect(out.light.primary).toBe("teal");
  });

  it("keeps mkdocs.yml above the settings", () => {
    const out = resolvePalette([{ scheme: "default", primary: "indigo" }], {
      light: { primary: "red", accent: "lime" },
      dark: { primary: "black" },
    });
    expect(out.light).toEqual({ primary: "indigo", accent: "lime" });
    expect(out.dark.primary).toBe("black");
  });

  it("falls back to the settings with no mkdocs.yml palette", () => {
    const out = resolvePalette(undefined, {
      light: { primary: "teal", accent: "orange" },
      dark: { primary: "black", accent: "cyan" },
    });
    expect(out.light).toEqual({ primary: "teal", accent: "orange" });
    expect(out.dark).toEqual({ primary: "black", accent: "cyan" });
  });

  it("lends the colors of the other scheme when one is described nowhere", () => {
    const out = resolvePalette(
      [{ scheme: "default", primary: "indigo", accent: "pink" }],
      NO_SETTINGS,
    );
    expect(out.dark).toEqual({ primary: "indigo", accent: "pink" });
  });

  it("does not lend when the settings cover the second scheme", () => {
    const out = resolvePalette([{ scheme: "default", primary: "indigo" }], {
      light: {},
      dark: { primary: "deep purple" },
    });
    expect(out.dark.primary).toBe("deep-purple");
  });

  it("takes the first entry of a kind", () => {
    const out = resolvePalette(
      [
        { scheme: "slate", primary: "amber" },
        { scheme: "slate", primary: "red" },
      ],
      NO_SETTINGS,
    );
    expect(out.dark.primary).toBe("amber");
  });

  it("survives an empty or malformed palette", () => {
    expect(resolvePalette([], NO_SETTINGS)).toEqual({ light: {}, dark: {} });
    expect(resolvePalette(undefined, NO_SETTINGS)).toEqual({
      light: { primary: undefined, accent: undefined },
      dark: { primary: undefined, accent: undefined },
    });
  });
});
