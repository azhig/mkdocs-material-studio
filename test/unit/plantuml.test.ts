// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { initMermaid, renderPlantUml, renderPlantUmlSource } from "../../webviews/shared/mermaid";

declare const window: Window & {
  __plantuml?: {
    renderToString: (
      lines: string[],
      onSuccess: (svg: string) => void,
      onError: (message: string) => void,
    ) => void;
  };
};

describe("PlantUML diagrams", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    initMermaid({
      mermaidUri: "",
      plantumlUri: "plantuml.js",
      plantumlVizUri: "plantuml-viz.js",
    });
    window.__plantuml = {
      renderToString: (lines, onSuccess) =>
        onSuccess(`<svg data-source="${lines.join("|")}"></svg>`),
    };
  });

  it("renders source locally through the bundled engine", async () => {
    await expect(renderPlantUmlSource("@startuml\nA -> B\n@enduml")).resolves.toContain("A -> B");
  });

  it("renders SVG and retains the source for serialization", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<pre class="plantuml">@startuml\nA -&gt; B\n@enduml</pre>';
    document.body.appendChild(root);

    await renderPlantUml(root);

    const block = root.querySelector<HTMLElement>(".plantuml")!;
    expect(block.getAttribute("data-plantuml-src")).toContain("A -> B");
    expect(block.hasAttribute("data-processed")).toBe(true);
    expect(block.querySelector("svg")).not.toBeNull();
  });

  it("leaves the source visible when rendering fails", async () => {
    window.__plantuml = {
      renderToString: (_lines, _onSuccess, onError) => onError("bad syntax"),
    };
    const root = document.createElement("div");
    root.innerHTML = '<pre class="plantuml">@startuml\nA -&gt; B\n@enduml</pre>';
    document.body.appendChild(root);

    await renderPlantUml(root);

    expect(root.querySelector("svg")).toBeNull();
    expect(root.textContent).toContain("A -> B");
    expect(root.querySelector(".plantuml")?.getAttribute("data-render-error")).toBe("true");
  });
});
