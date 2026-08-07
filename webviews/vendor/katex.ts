// A separate KaTeX bundle, loaded by the visual editor on demand — only the
// formula popup needs it (page formulas are rendered on the host side).
import katex from "katex";
(window as unknown as { __katex: unknown }).__katex = katex;
