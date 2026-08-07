// The info string of a fenced code block: ```` ```python title="app.py" ```` and
// the brace form pymdownx uses for its own parameters.
//
// Reading one and writing it back are the same operation seen from two sides,
// and both the code-block editor and the insert dialog need them — so they live
// apart from either, as functions over strings.

import { t } from "../shared/i18n";

export const COMMENT_SYNTAX: Record<string, [string, string]> = {
  py: ["# ", ""],
  python: ["# ", ""],
  yaml: ["# ", ""],
  yml: ["# ", ""],
  sh: ["# ", ""],
  bash: ["# ", ""],
  ruby: ["# ", ""],
  rb: ["# ", ""],
  toml: ["# ", ""],
  js: ["// ", ""],
  ts: ["// ", ""],
  jsx: ["// ", ""],
  tsx: ["// ", ""],
  java: ["// ", ""],
  c: ["// ", ""],
  cpp: ["// ", ""],
  cs: ["// ", ""],
  go: ["// ", ""],
  rust: ["// ", ""],
  rs: ["// ", ""],
  php: ["// ", ""],
  swift: ["// ", ""],
  css: ["/* ", " */"],
  scss: ["/* ", " */"],
  html: ["<!-- ", " -->"],
  xml: ["<!-- ", " -->"],
  md: ["<!-- ", " -->"],
  sql: ["-- ", ""],
  lua: ["-- ", ""],
  haskell: ["-- ", ""],
};

// Languages for the drop-down list (any other one can also be typed by hand).
export const LANGUAGES: string[] = [
  "bash",
  "shell",
  "console",
  "powershell",
  "batch",
  "python",
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "vue",
  "svelte",
  "json",
  "json5",
  "jsonc",
  "yaml",
  "toml",
  "ini",
  "properties",
  "env",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "markdown",
  "diff",
  "http",
  "sql",
  "graphql",
  "protobuf",
  "xml",
  "regex",
  "go",
  "rust",
  "zig",
  "c",
  "cpp",
  "csharp",
  "objectivec",
  "swift",
  "java",
  "kotlin",
  "scala",
  "groovy",
  "clojure",
  "dart",
  "php",
  "ruby",
  "perl",
  "lua",
  "r",
  "julia",
  "matlab",
  "elixir",
  "erlang",
  "haskell",
  "ocaml",
  "fsharp",
  "nim",
  "solidity",
  "dockerfile",
  "makefile",
  "cmake",
  "gradle",
  "terraform",
  "hcl",
  "nginx",
  "apache",
  "vim",
  "tex",
  "latex",
  "text",
];

export interface FenceParts {
  lang: string;
  title: string;
  linenums: boolean;
  hl: Set<number>;
  body: string[];
  extra: string[]; // other pymdownx classes (.copy/.select/…) in brace form
  attrs: string[]; // other key="val" pairs (except title/hl_lines/linenums)
}

export function parseFence(lines: string[]): FenceParts {
  const first = lines[0] ?? "```";
  // Both fence characters. A `~~~` fence is how an author writes a block that
  // itself contains backticks, and stripping only backticks left the whole
  // opener in the language: editing such a block through the menu rebuilt it as
  // `~~~` + `~~~python …` — six tildes and a broken block.
  const info = first.replace(/^\s*(?:`+|~+)\s*/, "").trim();
  const braced = /^\{(.*)\}$/.exec(info);
  const inner = braced ? braced[1].trim() : info;
  const extra: string[] = [];
  let lang: string;
  if (braced) {
    const classes = Array.from(inner.matchAll(/(?:^|\s)\.([\w+-]+)/g)).map((m) => m[1]);
    lang = classes[0] ?? "";
    extra.push(...classes.slice(1));
  } else {
    lang = inner.split(/\s+/)[0] ?? "";
  }
  const title = /title="([^"]*)"/.exec(inner)?.[1] ?? "";
  const linenums = /(?:^|\s)linenums="?\d/.test(inner);
  const hl = new Set<number>();
  const hlSpec = /hl_lines="([^"]*)"/.exec(inner)?.[1] ?? "";
  for (const part of hlSpec.split(/\s+/)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) hl.add(i);
    } else if (/^\d+$/.test(part)) {
      hl.add(Number(part));
    }
  }
  // Other key="val" attributes (preserved when editing through the menu).
  const attrs: string[] = [];
  for (const m of inner.matchAll(/([\w-]+)="([^"]*)"/g)) {
    if (m[1] !== "title" && m[1] !== "hl_lines" && m[1] !== "linenums") {
      attrs.push(`${m[1]}="${m[2]}"`);
    }
  }
  const body = lines.slice(1, Math.max(1, lines.length - 1));
  return { lang, title, linenums, hl, body, extra, attrs };
}

/** Builds the info string from the parsed parts, preserving the extra pymdownx parameters. */
export function buildFenceInfo(p: FenceParts): string {
  const bits: string[] = [];
  const braced = p.extra.length > 0 || p.attrs.length > 0;
  bits.push(braced ? (p.lang ? "." + p.lang : "") : p.lang);
  if (braced) {
    bits.push(...p.extra.map((c) => "." + c));
  }
  if (p.title) {
    bits.push(`title="${p.title.replace(/"/g, "'")}"`);
  }
  if (p.linenums) {
    bits.push('linenums="1"');
  }
  const spec = hlSpec(p.hl);
  if (spec) {
    bits.push(`hl_lines="${spec}"`);
  }
  if (braced) {
    bits.push(...p.attrs);
  }
  const joined = bits.filter(Boolean).join(" ");
  return braced ? `{ ${joined} }` : joined;
}

/** Collapses a set of numbers into an hl_lines spec: [2,3,4,7] → "2-4 7". */
export function hlSpec(hl: Set<number>): string {
  const nums = [...hl].sort((a, b) => a - b);
  if (nums.length === 0) return "";
  const parts: string[] = [];
  let s = nums[0];
  let p = nums[0];
  for (const n of nums.slice(1)) {
    if (n === p + 1) {
      p = n;
      continue;
    }
    parts.push(s === p ? `${s}` : `${s}-${p}`);
    s = p = n;
  }
  parts.push(s === p ? `${s}` : `${s}-${p}`);
  return parts.join(" ");
}

/** A sensible default title for a language (edited inline). */
export function defaultTitleFor(lang: string): string {
  const map: Record<string, string> = {
    python: "app.py",
    py: "app.py",
    javascript: "app.js",
    js: "app.js",
    typescript: "app.ts",
    ts: "app.ts",
    bash: "run.sh",
    sh: "run.sh",
    shell: "run.sh",
    yaml: "config.yml",
    yml: "config.yml",
    json: "data.json",
    html: "index.html",
    css: "styles.css",
    go: "main.go",
    rust: "main.rs",
    java: "Main.java",
    sql: "query.sql",
    dockerfile: "Dockerfile",
    toml: "config.toml",
  };
  return map[lang.toLowerCase()] ?? (lang ? `${lang}` : t("Title"));
}
