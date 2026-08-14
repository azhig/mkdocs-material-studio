// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  hueOf,
  mermaidTheme,
  mixColors,
  readDiagramColors,
  resolvedColor,
  type DiagramColors,
} from "../../webviews/shared/diagramTheme";

const MATERIAL: DiagramColors = {
  background: "rgb(30, 33, 41)",
  panel: "rgb(39, 42, 53)",
  text: "rgba(226, 228, 233, 0.82)",
  line: "rgba(226, 228, 233, 0.56)",
  primary: "rgb(126, 86, 194)",
  accent: "rgb(255, 170, 0)",
};

describe("diagram colours", () => {
  it("paints mermaid with the page's own colours", () => {
    const theme = mermaidTheme(MATERIAL, true);

    // Only “base” accepts themeVariables — the built-in themes ignore them.
    expect(theme.theme).toBe("base");
    expect(theme.themeVariables?.primaryColor).toBe(MATERIAL.panel);
    expect(theme.themeVariables?.lineColor).toBe(MATERIAL.line);
    expect(theme.themeVariables?.darkMode).toBe("true");
  });

  it("gives the label of an edge the page's background, not a plate of its own", () => {
    const theme = mermaidTheme(MATERIAL, true);
    expect(theme.themeVariables?.edgeLabelBackground).toBe(MATERIAL.background);
  });

  it("covers the diagrams that read none of the base variables", () => {
    const vars = mermaidTheme(MATERIAL, false).themeVariables!;
    // A sequence diagram, a Gantt chart and a pie chart each have palettes of
    // their own: left out, they stay in Mermaid's default colours while the
    // rest of the page follows Material.
    expect(vars.actorBkg).toBe(MATERIAL.panel);
    expect(vars.taskBkgColor).toBe(MATERIAL.panel);
    expect(vars.pieSectionTextColor).toBe(MATERIAL.text);
  });

  it("falls back to the engine's own theme when the page has no palette", () => {
    expect(mermaidTheme(undefined, true).theme).toBe("dark");
    expect(mermaidTheme(undefined, false).theme).toBe("default");
    expect(mermaidTheme(undefined, true).themeVariables).toBeUndefined();
  });

  it("keeps the slices of a pie chart apart", () => {
    // Every base colour here is the same panel, and Mermaid derives the slices
    // from it: left alone, a pie chart comes out as one grey circle.
    const vars = mermaidTheme(MATERIAL, true).themeVariables!;
    const slices = Object.entries(vars)
      .filter(([name]) => /^pie\d+$/.test(name))
      .map(([, value]) => value);

    expect(slices).toHaveLength(12);
    expect(new Set(slices).size).toBe(12);
    // Spread around the site's own colour, so they still look like this site.
    expect(slices[0]).toContain(`hsl(${Math.round(hueOf(MATERIAL.primary))}`);
  });

  it("keeps every Gantt label readable, inside its bar and beside it", () => {
    // A narrow bar is labelled outside itself, and Mermaid still picks the ink
    // by the colour of the bar: a bright bar got a dark label, drawn on the
    // dark page next to it. Every bar keeps the tone of the panel instead, so
    // one ink does for both places.
    const vars = mermaidTheme(MATERIAL, true).themeVariables!;
    expect(vars.taskTextLightColor).toBe(MATERIAL.text);
    expect(vars.taskTextDarkColor).toBe(MATERIAL.text);
    expect(vars.taskTextOutsideColor).toBe(MATERIAL.text);
    // The state of a task is told by its border, not by a fill that fights the text.
    expect(vars.activeTaskBorderColor).toBe(MATERIAL.primary);
    expect(vars.activeTaskBkgColor).not.toBe(MATERIAL.primary);
    expect(vars.critBorderColor).toBe(MATERIAL.accent);
    expect(vars.critBkgColor).not.toBe(MATERIAL.accent);
  });

  it("tints a bar towards the palette without leaving the panel's tone", () => {
    // 35% of the accent over the panel: visibly the accent, still a dark
    // surface on a dark page.
    expect(mixColors("rgb(255, 170, 0)", "rgb(39, 42, 53)", 0.35)).toBe("rgb(115, 87, 34)");
    expect(mixColors("rgb(255, 255, 255)", "rgb(0, 0, 0)", 0)).toBe("rgb(0, 0, 0)");
    expect(mixColors("not a colour", "rgb(39, 42, 53)", 0.5)).toBe("rgb(39, 42, 53)");
  });

  it("tells a resolved colour from a variable that is not defined", () => {
    // The page is asked for `var(--x, rgb(1, 2, 3))`: an undefined variable
    // answers with that marker, and a real palette never can.
    expect(resolvedColor("rgb(30, 33, 41)")).toBe("rgb(30, 33, 41)");
    expect(resolvedColor("rgba(226, 228, 233, 0.82)")).toBe("rgba(226, 228, 233, 0.82)");
    expect(resolvedColor("rgb(1, 2, 3)")).toBe("");
    expect(resolvedColor("")).toBe("");
  });

  it("reports no colours when the Material stylesheet is not on the page", () => {
    // The probe asks for each variable with a marker fallback, so an absent
    // stylesheet is told apart from a palette that happens to be grey.
    expect(readDiagramColors()).toBeUndefined();
    expect(document.body.children).toHaveLength(0); // the probe cleans up after itself
  });
});
