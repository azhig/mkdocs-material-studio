/**
 * Registry of Material components for visual insertion. Each component describes
 * a form (its fields) and a Markdown generator. Generators return a VS Code
 * snippet string (with tab stops $1, $0) that is inserted at the cursor position.
 *
 * IMPORTANT: this module must stay free of the `vscode` import — the unit tests
 * load it directly, outside the extension host — so it takes `t` from the pure
 * `../core/i18nCore` rather than from `../core/i18n`, which does import
 * `vscode`. That is the same split as mkdocsConfig/mkdocsConfigParse.
 */

import { t } from "../core/i18nCore";

export type FieldType = "text" | "textarea" | "select" | "checkbox" | "number" | "icon";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  options?: FieldOption[];
  default?: string | number | boolean;
  placeholder?: string;
  help?: string;
}

export type FieldValues = Record<string, string | number | boolean>;

export interface ComponentDef {
  id: string;
  label: string;
  category: string;
  icon: string; // codicon name, without $()
  description?: string;
  fields: FieldDef[];
  generate: (v: FieldValues) => string;
}

/** Serializable description (without the generate function) for the webview. */
export interface ComponentMeta {
  id: string;
  label: string;
  category: string;
  icon: string;
  description?: string;
  fields: FieldDef[];
}

/*
 * PITFALL: never call `t` at module level. Module bodies run while the extension
 * is being loaded, before the host reads the language bundle, so the result
 * would be frozen in English. Every call below sits inside buildComponents() or
 * inside a generator — both run later, on demand, which is also what lets a
 * language change redraw the palette without a reload.
 */

const ADMONITION_TYPES: FieldOption[] = [
  "note",
  "abstract",
  "info",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
].map((type) => ({ value: type, label: type }));

function str(v: string | number | boolean | undefined): string {
  return v === undefined ? "" : String(v);
}

function buildComponents(): ComponentDef[] {
  return [
    {
      id: "admonition",
      label: t("Callout block"),
      category: t("Blocks"),
      icon: "info",
      description: t("Admonition / callout"),
      fields: [
        {
          name: "type",
          label: t("Type"),
          type: "select",
          options: ADMONITION_TYPES,
          default: "note",
        },
        { name: "title", label: t("Title (optional)"), type: "text", placeholder: t("Note") },
        {
          name: "collapsible",
          label: t("Collapsible"),
          type: "select",
          default: "no",
          options: [
            { value: "no", label: t("No") },
            { value: "collapsed", label: t("Yes, collapsed") },
            { value: "expanded", label: t("Yes, expanded") },
          ],
        },
        { name: "content", label: t("Content"), type: "textarea", placeholder: t("Block text") },
      ],
      generate: (v) => {
        const marker =
          v.collapsible === "collapsed" ? "???" : v.collapsible === "expanded" ? "???+" : "!!!";
        const title = str(v.title);
        const head = title ? `${marker} ${v.type} "${title}"` : `${marker} ${v.type}`;
        const body = indent(str(v.content) || "$0");
        return `${head}\n${body}\n`;
      },
    },
    {
      id: "tabs",
      label: t("Tabs"),
      category: t("Blocks"),
      icon: "browser",
      description: t("Content tabs"),
      fields: [{ name: "count", label: t("Number of tabs"), type: "number", default: 2 }],
      generate: (v) => {
        const count = Math.max(2, Number(v.count) || 2);
        let out = "";
        for (let i = 1; i <= count; i++) {
          const tab = i === 1 ? "$0" : "";
          out += `=== "${t("Tab")} ${i}"\n    ${i === 1 ? tab : t("Content")}\n\n`;
        }
        return out.trimEnd() + "\n";
      },
    },
    {
      id: "code",
      label: t("Code block"),
      category: t("Blocks"),
      icon: "code",
      fields: [
        {
          name: "language",
          label: t("Language"),
          type: "text",
          default: "python",
          placeholder: "python",
        },
        { name: "title", label: t("File title"), type: "text", placeholder: "app.py" },
        { name: "linenums", label: t("Line numbers"), type: "checkbox", default: false },
        { name: "hl_lines", label: t("Highlight lines"), type: "text", placeholder: "2 3-5" },
        { name: "content", label: t("Code"), type: "textarea" },
      ],
      generate: (v) => {
        const opts: string[] = [];
        if (v.title) {
          opts.push(`title="${str(v.title)}"`);
        }
        if (v.linenums) {
          opts.push('linenums="1"');
        }
        if (v.hl_lines) {
          opts.push(`hl_lines="${str(v.hl_lines)}"`);
        }
        const info = [str(v.language), ...opts].filter(Boolean).join(" ");
        const body = str(v.content) || "$0";
        return `\`\`\`${info}\n${body}\n\`\`\`\n`;
      },
    },
    {
      id: "grid-cards",
      label: t("Card grid"),
      category: t("Blocks"),
      icon: "layout",
      description: t("Grid cards"),
      fields: [{ name: "count", label: t("Number of cards"), type: "number", default: 2 }],
      generate: (v) => {
        const count = Math.max(1, Number(v.count) || 2);
        let items = "";
        for (let i = 1; i <= count; i++) {
          items += `-   :material-star:{ .lg .middle } __${t("Title")} ${i}__\n\n    ---\n\n    ${t("Card description")} ${i}.\n\n`;
        }
        return `<div class="grid cards" markdown>\n\n${items}</div>\n`;
      },
    },
    {
      id: "button",
      label: t("Button"),
      category: t("Inline"),
      icon: "primitive-square",
      fields: [
        { name: "label", label: t("Text"), type: "text", default: t("Learn more") },
        { name: "url", label: t("Link"), type: "text", default: "#", placeholder: "https://…" },
        { name: "primary", label: t("Primary (accent)"), type: "checkbox", default: false },
      ],
      generate: (v) => {
        const cls = v.primary ? ".md-button .md-button--primary" : ".md-button";
        return `[${str(v.label)}](${str(v.url)}){ ${cls} }`;
      },
    },
    {
      id: "table",
      label: t("Table"),
      category: t("Blocks"),
      icon: "table",
      fields: [
        { name: "cols", label: t("Columns"), type: "number", default: 3 },
        { name: "rows", label: t("Rows"), type: "number", default: 2 },
      ],
      generate: (v) => {
        const cols = Math.max(1, Number(v.cols) || 3);
        const rows = Math.max(1, Number(v.rows) || 2);
        const header =
          "| " +
          range(cols)
            .map((i) => `${t("Heading")} ${i + 1}`)
            .join(" | ") +
          " |";
        const sep =
          "| " +
          range(cols)
            .map(() => "---")
            .join(" | ") +
          " |";
        const body = range(rows)
          .map(
            () =>
              "| " +
              range(cols)
                .map(() => "   ")
                .join(" | ") +
              " |",
          )
          .join("\n");
        return `${header}\n${sep}\n${body}\n`;
      },
    },
    {
      id: "image",
      label: t("Image"),
      category: t("Inline"),
      icon: "device-camera",
      fields: [
        { name: "path", label: t("Path/URL"), type: "text", placeholder: "images/pic.png" },
        { name: "alt", label: t("Alt text"), type: "text", placeholder: t("Description") },
        {
          name: "align",
          label: t("Alignment"),
          type: "select",
          default: "none",
          options: [
            { value: "none", label: t("Normal") },
            { value: "left", label: t("Left") },
            { value: "right", label: t("Right") },
          ],
        },
        { name: "width", label: t("Width (e.g. 300)"), type: "text", placeholder: "" },
      ],
      generate: (v) => {
        const attrs: string[] = [];
        if (v.align && v.align !== "none") {
          attrs.push(`align=${str(v.align)}`);
        }
        if (v.width) {
          attrs.push(`width="${str(v.width)}"`);
        }
        const suffix = attrs.length ? `{ ${attrs.join(" ")} }` : "";
        return `![${str(v.alt)}](${str(v.path) || "$1"})${suffix}\n`;
      },
    },
    {
      id: "mermaid",
      label: t("Mermaid diagram"),
      category: t("Blocks"),
      icon: "type-hierarchy",
      fields: [
        {
          name: "kind",
          label: t("Type"),
          type: "select",
          default: "flowchart",
          options: [
            { value: "flowchart", label: t("Flowchart") },
            { value: "sequence", label: t("Sequence") },
            { value: "class", label: t("Classes") },
            { value: "state", label: t("States") },
            { value: "gantt", label: t("Gantt") },
            { value: "pie", label: t("Pie") },
          ],
        },
      ],
      generate: (v) => `\`\`\`mermaid\n${mermaidTemplate(str(v.kind))}\n\`\`\`\n`,
    },
    {
      id: "math",
      label: t("Formula"),
      category: t("Inline"),
      icon: "symbol-operator",
      fields: [
        {
          name: "mode",
          label: t("Mode"),
          type: "select",
          default: "inline",
          options: [
            { value: "inline", label: t("In line") },
            { value: "block", label: t("Block") },
          ],
        },
        { name: "latex", label: t("LaTeX"), type: "text", placeholder: "a^2 + b^2 = c^2" },
      ],
      generate: (v) => {
        const latex = str(v.latex) || "$1";
        return v.mode === "block" ? `$$\n${latex}\n$$\n` : `$${latex}$`;
      },
    },
    {
      id: "keys",
      label: t("Keys"),
      category: t("Inline"),
      icon: "keyboard",
      fields: [
        {
          name: "keys",
          label: t("Keys separated by +"),
          type: "text",
          placeholder: "ctrl+alt+del",
        },
      ],
      generate: (v) => `++${str(v.keys) || "ctrl+c"}++`,
    },
    {
      id: "footnote",
      label: t("Footnote"),
      category: t("Inline"),
      icon: "note",
      fields: [
        { name: "id", label: t("Identifier"), type: "text", default: "1" },
        { name: "text", label: t("Footnote text"), type: "text", placeholder: t("Explanation") },
      ],
      generate: (v) => {
        const id = str(v.id) || "1";
        return `[^${id}]\n\n[^${id}]: ${str(v.text) || "$0"}\n`;
      },
    },
    {
      id: "tasklist",
      label: t("Task list"),
      category: t("Blocks"),
      icon: "checklist",
      fields: [{ name: "count", label: t("Items"), type: "number", default: 3 }],
      generate: (v) => {
        const count = Math.max(1, Number(v.count) || 3);
        return (
          range(count)
            .map((i) => `- [ ] ${t("Task")} ${i + 1}`)
            .join("\n") + "\n"
        );
      },
    },
    {
      id: "deflist",
      label: t("Definition list"),
      category: t("Blocks"),
      icon: "list-tree",
      fields: [],
      generate: () => `${t("Term")}\n:   ${t("Definition")} $0\n`,
    },
    {
      id: "abbr",
      label: t("Abbreviation"),
      category: t("Inline"),
      icon: "symbol-text",
      fields: [
        { name: "abbr", label: t("Abbreviation"), type: "text", placeholder: "HTML" },
        {
          name: "full",
          label: t("Expansion"),
          type: "text",
          placeholder: "HyperText Markup Language",
        },
      ],
      generate: (v) => `*[${str(v.abbr)}]: ${str(v.full)}\n`,
    },
    {
      id: "snippet",
      label: t("File include"),
      category: t("Blocks"),
      icon: "file-symlink-file",
      fields: [
        { name: "path", label: t("File path"), type: "text", placeholder: "includes/abbr.md" },
      ],
      generate: (v) => `--8<-- "${str(v.path)}"\n`,
    },
    {
      id: "icon",
      label: t("Icon / emoji"),
      category: t("Inline"),
      icon: "symbol-color",
      description: t("Material icon picker"),
      fields: [{ name: "shortcode", label: t("Icon"), type: "icon" }],
      generate: (v) => `:${str(v.shortcode) || "material-star"}:`,
    },
  ];
}

/**
 * Registry built once, at module load — that is, with untranslated labels. Which
 * is fine: the only language-sensitive thing reached through it is `generate`,
 * and that calls `t` while producing the snippet. Labels shown in the UI come
 * from componentMetas(), which rebuilds the list on every call and therefore
 * always matches the current display language.
 */
/** Every component, rebuilt so the labels follow the language in use now. */
export function components(): ComponentDef[] {
  return buildComponents();
}

export function componentMetas(): ComponentMeta[] {
  return buildComponents().map(({ generate: _generate, ...meta }) => meta);
}

export function getComponent(id: string): ComponentDef | undefined {
  return buildComponents().find((c) => c.id === id);
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => (l ? `    ${l}` : l))
    .join("\n");
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function mermaidTemplate(kind: string): string {
  switch (kind) {
    case "sequence":
      return `sequenceDiagram\n  Alice->>Bob: ${t("Hi")}\n  Bob-->>Alice: ${t("Reply")}`;
    case "class":
      return "classDiagram\n  class Animal\n  Animal : +int age\n  Animal : +run()";
    case "state": {
      // The same label on both sides, otherwise the diagram gets two states.
      const active = t("Active");
      return `stateDiagram-v2\n  [*] --> ${active}\n  ${active} --> [*]`;
    }
    case "gantt":
      return `gantt\n  title ${t("Plan")}\n  section ${t("Stage")}\n  ${t("Task")} :a1, 2024-01-01, 7d`;
    case "pie":
      return `pie title ${t("Shares")}\n  "A" : 40\n  "B" : 60`;
    default:
      return `flowchart TD\n  A[${t("Start")}] --> B{${t("Condition")}}\n  B -->|${t("Yes")}| C[${t("Done")}]\n  B -->|${t("No")}| A`;
  }
}
