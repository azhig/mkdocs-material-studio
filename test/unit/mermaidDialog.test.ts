// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectDiagramLanguage,
  initMermaidDialog,
  openMermaidDialog,
} from "../../webviews/visual/mermaidDialog";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("diagram language detection", () => {
  it("recognizes standard PlantUML markers", () => {
    expect(detectDiagramLanguage("@startuml\nAlice -> Bob\n@enduml")).toBe("plantuml");
  });

  it("recognizes Mermaid headers", () => {
    expect(detectDiagramLanguage("flowchart TD\n  A --> B", "plantuml")).toBe("mermaid");
    expect(detectDiagramLanguage("sequenceDiagram\n  A->>B: Hi", "plantuml")).toBe("mermaid");
  });

  it("uses the fence language when the source is ambiguous", () => {
    expect(detectDiagramLanguage("Alice -> Bob", "plantuml")).toBe("plantuml");
  });
});

describe("diagram source field", () => {
  it("lets Ctrl+V reach the VS Code webview paste bridge", () => {
    initMermaidDialog({ insertBlock: vi.fn(), insertPoint: () => null });
    openMermaidDialog("", "Insert", vi.fn());
    const textarea = document.querySelector("textarea")!;
    let reachedWindow = false;
    window.addEventListener("keydown", () => (reachedWindow = true), { once: true });

    const event = new KeyboardEvent("keydown", {
      key: "v",
      code: "KeyV",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(reachedWindow).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it("shows the detected language without a language selector", () => {
    initMermaidDialog({ insertBlock: vi.fn(), insertPoint: () => null });
    openMermaidDialog("@startuml\nA -> B\n@enduml", "Insert", vi.fn());

    expect(document.querySelector(".vmodal-language")?.textContent).toBe("PlantUML");
    expect(document.querySelectorAll(".vmodal-bar select")).toHaveLength(1);
  });
});
