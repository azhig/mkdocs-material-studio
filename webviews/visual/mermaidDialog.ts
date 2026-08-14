// The Mermaid dialog: insert from a template, edit with a live preview.
// Deliberately not a drawing canvas — a code field plus an instant render and
// the parser's message is enough to edit a diagram without breaking it.
//
// The editor hands in how to insert a block; everything else here is the dialog.

import { t } from "../shared/i18n";

declare const window: Window & {
  __mermaid?: {
    initialize: (o: unknown) => void;
    parse: (code: string) => Promise<unknown>;
    render: (id: string, code: string) => Promise<{ svg: string }>;
  };
};
import { ensureMermaid, mermaidConfig, renderPlantUmlSource } from "../shared/mermaid";
import { closePopup, firstErrorLine } from "./popups";

export interface MermaidDialogHost {
  /** Inserts a markdown block at the point captured before the dialog opened. */
  insertBlock: (markdown: string, at: unknown) => void;
  /** The insertion point, taken while the caret is still in the document. */
  insertPoint: () => unknown;
}

let host: MermaidDialogHost;

export function initMermaidDialog(next: MermaidDialogHost): void {
  host = next;
}

const MERMAID_TEMPLATES: Array<{ id: string; label: string; code: string }> = [
  {
    id: "flowchart",
    label: t("Flowchart"),
    code: `flowchart TD\n  A[${t("Start")}] --> B{${t("Condition")}}\n  B -->|${t("Yes")}| C[${t("Done")}]\n  B -->|${t("No")}| A`,
  },
  {
    id: "sequence",
    label: t("Sequence"),
    code: `sequenceDiagram\n  Alice->>Bob: ${t("Hi")}\n  Bob-->>Alice: ${t("Reply")}`,
  },
  {
    id: "class",
    label: t("Classes"),
    code: "classDiagram\n  class Animal\n  Animal : +int age\n  Animal : +run()",
  },
  {
    id: "state",
    label: t("States"),
    code: `stateDiagram-v2\n  [*] --> ${t("Active")}\n  ${t("Active")} --> [*]`,
  },
  {
    id: "er",
    label: t("Entities"),
    code: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains",
  },
  {
    id: "gantt",
    label: t("Gantt"),
    code: `gantt\n  title ${t("Plan")}\n  dateFormat YYYY-MM-DD\n  section ${t("Stage")}\n  ${t("Task")} :a1, 2024-01-01, 7d`,
  },
  {
    id: "pie",
    label: t("Pie"),
    code: `pie title ${t("Shares")}\n  "A" : 40\n  "B" : 60`,
  },
];

const PLANTUML_TEMPLATES: Array<{ id: string; label: string; code: string }> = [
  {
    id: "sequence",
    label: t("Sequence"),
    code: `@startuml\nAlice -> Bob: ${t("Hi")}\nBob --> Alice: ${t("Reply")}\n@enduml`,
  },
  {
    id: "class",
    label: t("Classes"),
    code: "@startuml\nclass Animal {\n  +int age\n  +run()\n}\n@enduml",
  },
  {
    id: "activity",
    label: t("Activity"),
    code: `@startuml\nstart\n:${t("Task")};\nif (${t("Condition")}?) then (${t("Yes")})\n  :${t("Done")};\nelse (${t("No")})\n  :${t("Task")};\nendif\nstop\n@enduml`,
  },
  {
    id: "state",
    label: t("States"),
    code: `@startuml\n[*] --> ${t("Active")}\n${t("Active")} --> [*]\n@enduml`,
  },
  {
    id: "component",
    label: t("Components"),
    code: "@startuml\n[Client] --> [API]\n[API] --> [Database]\n@enduml",
  },
];

export type DiagramLanguage = "mermaid" | "plantuml";

const MERMAID_HEADER =
  /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|sankey-beta|requirementDiagram|C4\w*)\b/im;

/** Detects the renderer from the source while retaining the known fence as an ambiguity fallback. */
export function detectDiagramLanguage(
  source: string,
  fallback: DiagramLanguage = "mermaid",
): DiagramLanguage {
  if (/^\s*@start\w*\b/im.test(source) || /^\s*@end\w*\b/im.test(source)) {
    return "plantuml";
  }
  if (MERMAID_HEADER.test(source)) {
    return "mermaid";
  }
  if (
    /^\s*(?:!include|!define|skinparam|left\s+to\s+right\s+direction|actor|participant|boundary|control|entity|database|component|package)\b/im.test(
      source,
    )
  ) {
    return "plantuml";
  }
  return fallback;
}

function templates(language: DiagramLanguage): Array<{ id: string; label: string; code: string }> {
  return language === "plantuml" ? PLANTUML_TEMPLATES : MERMAID_TEMPLATES;
}

/**
 * Rewrites the language of a fence's opening line when the dialog switched
 * renderers, in both info-string forms Material accepts — ```` ```plantuml ````
 * and ```` ```{ .plantuml title="…" } ````. Everything else on the line (the
 * title, `.copy`, the tildes) is the author's and stays untouched.
 */
export function withDiagramLanguage(openLine: string, language: DiagramLanguage): string {
  const braced = /^(\s*(?:`{3,}|~{3,})\s*\{\s*\.)[\w+-]+/;
  if (braced.test(openLine)) {
    return openLine.replace(braced, `$1${language}`);
  }
  return openLine.replace(/^(\s*(?:`{3,}|~{3,})\s*)[\w+-]*/, `$1${language}`);
}

let mermaidDlgSeq = 0;

export function openMermaidDialog(
  source: string,
  okLabel: string,
  onSave: (code: string, language: DiagramLanguage) => void,
  initialLanguage: DiagramLanguage = "mermaid",
): void {
  closePopup();
  const overlay = document.createElement("div");
  overlay.className = "vmodal";
  const box = document.createElement("div");
  box.className = "vmodal-box";
  overlay.appendChild(box);

  const bar = document.createElement("div");
  bar.className = "vmodal-bar";
  const title = document.createElement("span");
  title.className = "grow";
  title.textContent = t("Diagram");
  let language = detectDiagramLanguage(source, initialLanguage);
  const languageLabel = document.createElement("span");
  languageLabel.className = "vmodal-language";
  languageLabel.textContent = language === "plantuml" ? "PlantUML" : "Mermaid";
  const tmpl = document.createElement("select");
  const fillTemplates = (): void => {
    tmpl.replaceChildren();
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = t("Insert a template…");
    tmpl.appendChild(ph);
    for (const tpl of templates(language)) {
      const option = document.createElement("option");
      option.value = tpl.id;
      option.textContent = tpl.label;
      tmpl.appendChild(option);
    }
  };
  fillTemplates();
  bar.append(title, languageLabel, tmpl);

  const body = document.createElement("div");
  body.className = "vmodal-body";
  const ta = document.createElement("textarea");
  ta.value = source;
  ta.spellcheck = false;
  const preview = document.createElement("div");
  preview.className = "vmodal-preview";
  body.append(ta, preview);

  const foot = document.createElement("div");
  foot.className = "vmodal-foot";
  const err = document.createElement("span");
  err.className = "vmodal-err grow";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("Cancel");
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = okLabel;
  foot.append(err, cancel, ok);

  box.append(bar, body, foot);
  document.body.appendChild(overlay);
  ta.focus();

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  document.addEventListener("keydown", onKey, true);
  cancel.addEventListener("click", close);
  ok.addEventListener("click", () => {
    const code = ta.value.replace(/\n+$/, "");
    if (!code.trim()) {
      return;
    }
    close();
    onSave(code, detectDiagramLanguage(code, language));
  });
  tmpl.addEventListener("change", () => {
    const tpl = templates(language).find((x) => x.id === tmpl.value);
    if (tpl) {
      ta.value = tpl.code;
      schedulePreview();
      ta.focus();
    }
  });
  ta.addEventListener("keydown", (e) => {
    const pasteKey =
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      (e.code === "KeyV" || (e.code === "" && e.key.toLowerCase() === "v"));
    if (pasteKey) {
      // VS Code performs Paste after the key reaches its webview bridge.
      return;
    }
    // The editor hotkeys must not fire while the diagram code is being typed.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
    }
  });

  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const schedulePreview = (): void => {
    const nextLanguage = detectDiagramLanguage(ta.value, language);
    if (nextLanguage !== language) {
      language = nextLanguage;
      languageLabel.textContent = language === "plantuml" ? "PlantUML" : "Mermaid";
      fillTemplates();
    }
    if (previewTimer) {
      clearTimeout(previewTimer);
    }
    previewTimer = setTimeout(() => void renderDialogPreview(), 250);
  };
  ta.addEventListener("input", schedulePreview);

  async function renderDialogPreview(): Promise<void> {
    const code = ta.value.trim();
    if (!code) {
      preview.innerHTML = "";
      err.textContent = "";
      return;
    }
    if (language === "plantuml") {
      try {
        const svg = await renderPlantUmlSource(code);
        if (!overlay.isConnected) {
          return;
        }
        preview.innerHTML = svg;
        preview.classList.remove("stale");
        err.textContent = "";
      } catch (e) {
        preview.classList.add("stale");
        err.textContent = firstErrorLine(e);
      }
      return;
    }
    const id = `vmdlg${++mermaidDlgSeq}`;
    try {
      await ensureMermaid();
      window.__mermaid?.initialize(mermaidConfig());
      const { svg } = (await window.__mermaid?.render(id, code)) ?? { svg: "" };
      if (!overlay.isConnected) {
        return; // the dialog was closed while the render was in flight
      }
      preview.innerHTML = svg;
      preview.classList.remove("stale");
      err.textContent = "";
    } catch (e) {
      // The last good render stays, dimmed; the parser explains what broke.
      preview.classList.add("stale");
      err.textContent = firstErrorLine(e);
    } finally {
      // A failed render leaves mermaid's service element in <body> — sweep it.
      // The fresh SVG in the preview carries the same id — that one stays.
      document.getElementById(`d${id}`)?.remove();
      const orphan = document.getElementById(id);
      if (orphan && !preview.contains(orphan)) {
        orphan.remove();
      }
    }
  }
  void renderDialogPreview();
}

/** Inserting a diagram: the insert point is captured before the dialog steals focus. */
export function openMermaidInsert(): void {
  const point = host.insertPoint();
  openMermaidDialog(MERMAID_TEMPLATES[0].code, t("Insert"), (code, language) => {
    host.insertBlock(`\`\`\`${language}\n${code}\n\`\`\``, point);
  });
}
