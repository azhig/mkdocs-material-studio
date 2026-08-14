// Readability of a bar whose colors a project's stylesheet has a say in.
//
// The site header takes its background from --md-primary-fg-color and its ink
// from --md-primary-bg-color, and Material keeps that pair in step. A project's
// extra_css often does not: the usual recipe for a dark theme sets the header
// background alone, and the ink stays the one that came with the palette —
// black letters on a black bar. The built site never shows it, because there the
// theme paints `.md-header` itself; here the bar is our own markup, so the pair
// can come apart.

/** A color as the browser reports it: sRGB channels 0…255, alpha 0…1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Material's own ink for a light bar; `#fff` is the ink for a dark one. */
export const DARK_INK = "rgba(0, 0, 0, 0.87)";
export const LIGHT_INK = "#fff";

/**
 * Below this ratio the letters are not merely dim, they are gone. Above it the
 * choice belongs to whoever wrote the stylesheet — a header is deliberately
 * quiet more often than it is broken.
 */
const MIN_RATIO = 3;

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^rgba?\(([^)]*)\)$/i;

/**
 * `rgb()`, `rgba()` and hex, which is all a computed style ever reports. A named
 * color or a modern syntax (`color-mix`, `oklch`) returns null — we then leave
 * the bar alone rather than guess at it.
 */
export function parseCssColor(value: string): Rgb | null {
  const text = value.trim();
  if (text === "" || text === "transparent") {
    return text === "transparent" ? { r: 0, g: 0, b: 0, a: 0 } : null;
  }
  if (HEX.test(text)) {
    const hex = text.slice(1);
    const wide = hex.length > 4;
    const step = wide ? 2 : 1;
    const at = (i: number): number => {
      const part = hex.slice(i * step, i * step + step);
      const byte = parseInt(wide ? part : part + part, 16);
      return byte;
    };
    const alpha = hex.length === 4 || hex.length === 8 ? at(3) / 255 : 1;
    return { r: at(0), g: at(1), b: at(2), a: alpha };
  }
  const func = FUNC.exec(text);
  if (!func) {
    return null;
  }
  // Both spellings are in the wild: `rgb(1, 2, 3)` and `rgb(1 2 3 / 40%)`.
  const parts = func[1]
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter((p) => p !== "");
  if (parts.length < 3) {
    return null;
  }
  const channel = (p: string): number =>
    p.endsWith("%") ? (Number.parseFloat(p) / 100) * 255 : Number.parseFloat(p);
  const rgb = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
  if (rgb.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const alphaText = parts[3];
  const alpha =
    alphaText === undefined
      ? 1
      : alphaText.endsWith("%")
        ? Number.parseFloat(alphaText) / 100
        : Number.parseFloat(alphaText);
  return {
    r: rgb[0],
    g: rgb[1],
    b: rgb[2],
    a: Number.isFinite(alpha) ? alpha : 1,
  };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const c = Math.min(Math.max(v, 0), 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Translucent ink reaches the eye already mixed with what is behind it. */
function over(top: Rgb, bottom: Rgb): Rgb {
  const a = Math.min(Math.max(top.a, 0), 1);
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** WCAG contrast ratio: 1 for two equal colors, 21 for black on white. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const hi = Math.max(first, second);
  const lo = Math.min(first, second);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The ink to write with on `background`, or null when what is there already
 * reads — including the case of colors we cannot parse or a see-through bar,
 * where there is nothing to judge against.
 */
export function inkFor(background: string, ink: string): string | null {
  const bg = parseCssColor(background);
  const fg = parseCssColor(ink);
  if (!bg || !fg || bg.a < 0.5) {
    return null;
  }
  if (contrastRatio(over(fg, bg), bg) >= MIN_RATIO) {
    return null;
  }
  const dark = parseCssColor(DARK_INK) as Rgb;
  const light = parseCssColor(LIGHT_INK) as Rgb;
  return contrastRatio(over(light, bg), bg) >= contrastRatio(over(dark, bg), bg)
    ? LIGHT_INK
    : DARK_INK;
}
