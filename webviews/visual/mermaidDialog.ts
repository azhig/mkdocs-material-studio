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
import { ensureMermaid } from "../shared/mermaid";
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

let mermaidDlgSeq = 0;

export function openMermaidDialog(
  source: string,
  okLabel: string,
  onSave: (code: string) => void,
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
  title.textContent = t("Mermaid diagram");
  const tmpl = document.createElement("select");
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = t("Insert a template…");
  tmpl.appendChild(ph);
  for (const tpl of MERMAID_TEMPLATES) {
    const o = document.createElement("option");
    o.value = tpl.id;
    o.textContent = tpl.label;
    tmpl.appendChild(o);
  }
  bar.append(title, tmpl);

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
    onSave(code);
  });
  tmpl.addEventListener("change", () => {
    const tpl = MERMAID_TEMPLATES.find((x) => x.id === tmpl.value);
    if (tpl) {
      ta.value = tpl.code;
      schedulePreview();
      ta.focus();
    }
  });
  ta.addEventListener("keydown", (e) => {
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
    const id = `vmdlg${++mermaidDlgSeq}`;
    try {
      await ensureMermaid();
      const scheme = document.body.getAttribute("data-md-color-scheme");
      window.__mermaid?.initialize({
        startOnLoad: false,
        theme: scheme === "slate" ? "dark" : "default",
      });
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
  openMermaidDialog(MERMAID_TEMPLATES[0].code, t("Insert"), (code) => {
    host.insertBlock("```mermaid\n" + code + "\n```", point);
  });
}
