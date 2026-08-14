import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  DARK_INK,
  inkFor,
  LIGHT_INK,
  parseCssColor,
} from "../../webviews/shared/contrast";

describe("reading a color the way the browser reports it", () => {
  it("takes the comma form a computed style gives back", () => {
    expect(parseCssColor("rgb(22, 23, 29)")).toEqual({ r: 22, g: 23, b: 29, a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0.87)")).toEqual({ r: 0, g: 0, b: 0, a: 0.87 });
  });

  it("takes the space form a stylesheet may be written in", () => {
    expect(parseCssColor("rgb(255 255 255 / 50%)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
  });

  it("takes hex in every length, short and with alpha", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#16171d")).toEqual({ r: 22, g: 23, b: 29, a: 1 });
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(0.5, 2);
  });

  it("says nothing about a color it does not know, so the bar is left alone", () => {
    expect(parseCssColor("rebeccapurple")).toBeNull();
    expect(parseCssColor("color-mix(in srgb, #000, #fff)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("the contrast between two colors", () => {
  it("is 21 for black on white and 1 for a color on itself", () => {
    const black = parseCssColor("#000")!;
    const white = parseCssColor("#fff")!;
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(black, black)).toBeCloseTo(1, 5);
  });
});

describe("the ink for a header bar", () => {
  it("leaves the pair Material itself hands out alone", () => {
    // primary: black — a near-black bar written on in white.
    expect(inkFor("rgb(20, 21, 26)", "rgb(255, 255, 255)")).toBeNull();
    // primary: white — a white bar written on in near-black.
    expect(inkFor("rgb(255, 255, 255)", "rgba(0, 0, 0, 0.87)")).toBeNull();
  });

  it("rescues black letters left on a bar a stylesheet has painted dark", () => {
    // The reported defect: extra_css set --md-primary-fg-color alone, so the ink
    // stayed the one that came with `primary: white`.
    expect(inkFor("rgb(22, 23, 29)", "rgba(0, 0, 0, 0.87)")).toBe(LIGHT_INK);
  });

  it("rescues white letters left on a bar a stylesheet has painted light", () => {
    expect(inkFor("rgb(245, 245, 245)", "rgb(255, 255, 255)")).toBe(DARK_INK);
  });

  it("counts a translucent ink as what the eye actually gets", () => {
    // 12% black over white is invisible, even though pure black would read.
    expect(inkFor("rgb(255, 255, 255)", "rgba(0, 0, 0, 0.12)")).toBe(DARK_INK);
  });

  it("keeps out of a bar that is merely quiet rather than unreadable", () => {
    // Material's own translucent white on indigo: dim on purpose, still legible.
    expect(inkFor("rgb(64, 81, 181)", "rgba(255, 255, 255, 0.7)")).toBeNull();
  });

  it("has nothing to judge against when the bar is see-through", () => {
    expect(inkFor("rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.87)")).toBeNull();
  });

  it("leaves a color it cannot read alone instead of guessing", () => {
    expect(inkFor("var(--brand)", "rgba(0, 0, 0, 0.87)")).toBeNull();
  });
});
