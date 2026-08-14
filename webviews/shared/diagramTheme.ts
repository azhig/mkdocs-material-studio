// The colours the diagram engines draw with.
//
// Both engines ship palettes of their own, and both are neutral grey: on
// Material's slate (a blue-tinted near-black) a Mermaid node comes out at
// #1F2020 — a contrast of 1.01 against the page, a patch of a different hue
// rather than a block that belongs there. Material itself paints Mermaid from
// the site palette, so taking the colours off the page is also what brings the
// preview closer to the published site.
//
// The values are read from the page, not hard-coded: the palette comes from
// mkdocs.yml and changes with the scheme.

/** What a diagram needs from the page's stylesheet. */
export interface DiagramColors {
  /** The page itself — what a diagram is seen against. */
  background: string;
  /** The panel a code block sits on — the fill of a node. */
  panel: string;
  /** Body text. */
  text: string;
  /** Lines, arrows and borders: text, dimmed. */
  line: string;
  /** The palette's primary colour — the site's own. */
  primary: string;
  /** The palette's accent — what Material highlights with. */
  accent: string;
}

/** `rgb()` / `rgba()` as numbers; anything else — nothing. */
function parseRgb(color: string): [number, number, number] | undefined {
  const parts = (color.match(/[\d.]+/g) ?? []).map(Number);
  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : undefined;
}

/** The hue of a colour, in degrees. */
export function hueOf(color: string): number {
  const rgb = parseRgb(color);
  if (!rgb) {
    return 210; // nothing to take a hue from — Material's own blue-ish default
  }
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) {
    return 210; // grey has no hue of its own
  }
  const hue =
    max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (hue * 60 + 360) % 360;
}

/** `ratio` of `color` over `base`, as an opaque colour. */
export function mixColors(color: string, base: string, ratio: number): string {
  const [a, b] = [parseRgb(color), parseRgb(base)];
  if (!a || !b) {
    return base;
  }
  const mixed = a.map((v, i) => Math.round(v * ratio + b[i] * (1 - ratio)));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/**
 * The slices of a pie chart. Mermaid derives them from `primaryColor` when it
 * is not told otherwise — and since every base colour here is the same panel,
 * every slice would come out the same shade of grey. Twelve hues spread evenly
 * around the site's own, light enough to read on either scheme.
 */
export function pieColors(primary: string, dark: boolean): Record<string, string> {
  const base = hueOf(primary);
  const [saturation, lightness] = dark ? [55, 62] : [62, 52];
  const slices: Record<string, string> = {};
  for (let i = 0; i < 12; i++) {
    slices[`pie${i + 1}`] =
      `hsl(${Math.round((base + i * 30) % 360)}, ${saturation}%, ${lightness}%)`;
  }
  return slices;
}

/** Mermaid's configuration for `initialize`. */
export interface MermaidTheme {
  startOnLoad: false;
  theme: string;
  themeVariables?: Record<string, string>;
  fontFamily?: string;
}

/**
 * The engine's own theme when the page's colours are unknown (no Material
 * stylesheet — the unit tests, a webview whose CSS has not arrived yet).
 */
export function mermaidTheme(
  colors: DiagramColors | undefined,
  dark: boolean,
  fontFamily?: string,
): MermaidTheme {
  if (!colors) {
    return { startOnLoad: false, theme: dark ? "dark" : "default" };
  }
  const { background, panel, text, line, primary, accent } = colors;
  // A Gantt bar is labelled outside itself whenever it is too narrow for the
  // text, and Mermaid still picks the ink by the colour of the bar — a label
  // for a bright bar came out dark, sitting on the dark page next to it. So
  // every bar stays in the tone of the panel, tinted towards the palette, and
  // one ink reads both inside a bar and beside it.
  const activeTask = mixColors(primary, panel, 0.35);
  const criticalTask = mixColors(accent, panel, 0.35);
  // A pie slice is a saturated colour of its own — its label needs the opposite.
  const onSlice = dark ? background : text;
  return {
    startOnLoad: false,
    // “base” is the only theme Mermaid lets one repaint; the built-in ones
    // ignore themeVariables.
    theme: "base",
    fontFamily,
    themeVariables: {
      darkMode: String(dark), // decides the shades Mermaid derives on its own
      background,
      fontFamily: fontFamily ?? "inherit",

      primaryColor: panel,
      primaryTextColor: text,
      primaryBorderColor: line,
      secondaryColor: panel,
      secondaryTextColor: text,
      secondaryBorderColor: line,
      tertiaryColor: background,
      tertiaryTextColor: text,
      tertiaryBorderColor: line,
      mainBkg: panel,
      nodeBorder: line,
      nodeTextColor: text,
      titleColor: text,
      textColor: text,
      lineColor: line,
      // The label of an edge used to carry a grey plate of its own, drawn over
      // the line it belongs to.
      edgeLabelBackground: background,
      clusterBkg: background,
      clusterBorder: line,

      // A sequence diagram reads none of the above.
      actorBkg: panel,
      actorBorder: line,
      actorTextColor: text,
      actorLineColor: line,
      signalColor: text,
      signalTextColor: text,
      labelBoxBkgColor: panel,
      labelBoxBorderColor: line,
      labelTextColor: text,
      loopTextColor: text,
      noteBkgColor: panel,
      noteBorderColor: line,
      noteTextColor: text,
      activationBkgColor: panel,
      activationBorderColor: line,
      sequenceNumberColor: background,

      // Nor does a Gantt chart.
      sectionBkgColor: panel,
      sectionBkgColor2: background,
      altSectionBkgColor: background,
      gridColor: line,
      taskBkgColor: panel,
      taskBorderColor: line,
      taskTextColor: text,
      taskTextOutsideColor: text,
      taskTextLightColor: text,
      taskTextDarkColor: text,
      // What tells the tasks apart is the border, in the palette's own colours.
      activeTaskBkgColor: activeTask,
      activeTaskBorderColor: primary,
      doneTaskBkgColor: background,
      doneTaskBorderColor: line,
      critBkgColor: criticalTask,
      critBorderColor: accent,
      todayLineColor: accent,

      // A pie chart: the frame and the labels from the page, the slices from a
      // palette of their own (see pieColors).
      pieOuterStrokeColor: line,
      pieTitleTextColor: text,
      pieSectionTextColor: onSlice,
      pieLegendTextColor: text,
      pieStrokeColor: background,
      ...pieColors(primary, dark),
    },
  };
}

/**
 * The marker a variable is asked for with. `var(--x)` with no fallback does not
 * make the declaration invalid — it makes `color` inherit, so an undefined
 * variable would come back as the colour of the surrounding text and be taken
 * for a palette. Asked for as `var(--x, <marker>)`, an undefined variable
 * answers with the marker and nothing else can.
 */
const UNRESOLVED = "rgb(1, 2, 3)";

/** A colour the page actually resolved, or "" — the marker and anything else. */
export function resolvedColor(value: string): string {
  return /^rgba?\(/.test(value) && value !== UNRESOLVED ? value : "";
}

/**
 * Reads Material's colours off the page. Returns nothing when the stylesheet is
 * not there — every variable is asked for with a marker fallback, and a marker
 * coming back means the page has no Material palette to speak of.
 */
export function readDiagramColors(): DiagramColors | undefined {
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const read = (name: string): string => {
    probe.style.color = `var(${name}, ${UNRESOLVED})`;
    return resolvedColor(getComputedStyle(probe).color);
  };
  const colors: DiagramColors = {
    background: read("--md-default-bg-color"),
    panel: read("--md-code-bg-color"),
    text: read("--md-default-fg-color"),
    line: read("--md-default-fg-color--light"),
    primary: read("--md-primary-fg-color"),
    accent: read("--md-accent-fg-color"),
  };
  probe.remove();
  if (!colors.background || !colors.panel || !colors.text || !colors.line) {
    return undefined;
  }
  // A project may name no colours at all; the diagram still needs something to
  // highlight with, and the text colour is always there.
  colors.primary = colors.primary || colors.text;
  colors.accent = colors.accent || colors.primary;
  return colors;
}
