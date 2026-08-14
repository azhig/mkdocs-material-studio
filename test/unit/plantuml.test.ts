// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import {
  initMermaid,
  reRenderDiagramTheme,
  renderPlantUml,
  renderPlantUmlSource,
} from "../../webviews/shared/mermaid";

type Engine = {
  renderToString: (
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: string) => void,
    options?: { dark?: boolean },
  ) => void;
};

declare const window: Window & { __plantuml?: Engine };

/**
 * Lets a condition settle without waiting a fixed time: the engine is driven by
 * promises only, so draining the microtask queue is the whole of “later”.
 */
async function drain(times = 50): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

const DIAGRAM = "@startuml\nA -> B\n@enduml";

describe("PlantUML diagrams", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("data-md-color-scheme");
    // Also clears the render cache — otherwise a diagram drawn by one test
    // would be handed out to the next one without touching the engine.
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
    await expect(renderPlantUmlSource(DIAGRAM)).resolves.toContain("A -> B");
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

    const block = root.querySelector<HTMLElement>(".plantuml")!;
    expect(root.querySelector("svg")).toBeNull();
    expect(root.textContent).toContain("A -> B");
    expect(block.getAttribute("data-render-error")).toBe("true");
    // Without the message the reader sees a code block and no reason for it.
    expect(block.getAttribute("title")).toBe("bad syntax");
  });

  it("treats the engine's error page as an error, not as a diagram", async () => {
    // PlantUML reports a source it cannot read by drawing a picture about it.
    const errorPage =
      "<svg><text>PlantUML version 1.2026.6</text><text>Syntax Error? (Assumed diagram type: sequence)</text></svg>";
    window.__plantuml = { renderToString: (_lines, onSuccess) => onSuccess(errorPage) };
    const root = document.createElement("div");
    root.innerHTML = '<pre class="plantuml">@startuml\nnot a diagram ][\n@enduml</pre>';
    document.body.appendChild(root);

    await renderPlantUml(root);

    const block = root.querySelector<HTMLElement>(".plantuml")!;
    expect(block.querySelector("svg")).toBeNull();
    expect(block.getAttribute("data-render-error")).toBe("true");
    expect(block.getAttribute("title")).toContain("Syntax Error?");
  });

  it("keeps a diagram that merely mentions the phrase", async () => {
    // Both marks are required — “Syntax Error?” can be a label in a real diagram.
    const svg = "<svg><text>Syntax Error? is a state here</text></svg>";
    window.__plantuml = { renderToString: (_lines, onSuccess) => onSuccess(svg) };

    await expect(renderPlantUmlSource("@startuml\n[*] --> A\n@enduml")).resolves.toContain("<svg>");
  });

  it("draws one diagram at a time — the engine has shared state", async () => {
    const waiting: Array<(svg: string) => void> = [];
    window.__plantuml = { renderToString: (_lines, onSuccess) => waiting.push(onSuccess) };

    const first = renderPlantUmlSource("@startuml\nA -> B\n@enduml");
    const second = renderPlantUmlSource("@startuml\nC -> D\n@enduml");

    await drain();
    expect(waiting).toHaveLength(1); // the second one may not start yet

    waiting[0]('<svg id="first"></svg>');
    await expect(first).resolves.toContain("first");

    await drain();
    expect(waiting).toHaveLength(2);
    waiting[1]('<svg id="second"></svg>');
    await expect(second).resolves.toContain("second");
  });

  it("keeps the queue running after a diagram fails", async () => {
    window.__plantuml = {
      renderToString: () => {
        throw new Error("engine crashed");
      },
    };
    await expect(renderPlantUmlSource(DIAGRAM)).rejects.toThrow("engine crashed");

    window.__plantuml = { renderToString: (_lines, onSuccess) => onSuccess('<svg id="after">') };
    await expect(renderPlantUmlSource("@startuml\nC -> D\n@enduml")).resolves.toContain("after");
  });

  it("settles instead of hanging when the runtime never set its global", async () => {
    // The scripts report loaded, the global is not there. The promise has to
    // settle: an unsettled one holds the queue, and every later diagram with it.
    const engine = window.__plantuml;
    let reads = 0;
    Object.defineProperty(window, "__plantuml", {
      configurable: true,
      get: () => (reads++ === 0 ? engine : undefined), // vanishes right after the load check
    });

    await expect(renderPlantUmlSource(DIAGRAM)).rejects.toThrow(/did not start/);

    Object.defineProperty(window, "__plantuml", {
      configurable: true,
      writable: true,
      value: engine,
    });
  });

  it("draws an unchanged diagram once, however often the page is re-rendered", async () => {
    let calls = 0;
    window.__plantuml = {
      renderToString: (lines, onSuccess) => {
        calls++;
        onSuccess(`<svg data-source="${lines.join("|")}"></svg>`);
      },
    };
    const page = (): HTMLElement => {
      const root = document.createElement("div");
      root.innerHTML = '<pre class="plantuml">@startuml\nA -&gt; B\n@enduml</pre>';
      document.body.replaceChildren(root);
      return root;
    };

    await renderPlantUml(page());
    await renderPlantUml(page()); // a keystroke in the document rebuilds the markup

    expect(calls).toBe(1);
  });

  it("asks the engine for the scheme the page is in", async () => {
    // The engine draws in near-black ink by default — on a dark page the lines
    // and the arrows of the diagram are all but invisible.
    const asked: Array<boolean | undefined> = [];
    window.__plantuml = {
      renderToString: (_lines, onSuccess, _onError, options) => {
        asked.push(options?.dark);
        onSuccess(`<svg data-dark="${String(options?.dark)}"></svg>`);
      },
    };

    await renderPlantUmlSource(DIAGRAM);
    document.body.setAttribute("data-md-color-scheme", "slate");
    const dark = await renderPlantUmlSource(DIAGRAM);

    expect(asked).toEqual([false, true]); // the cache must not hand out the light picture
    expect(dark).toContain('data-dark="true"');
  });

  it("redraws a diagram when the page changes scheme", async () => {
    window.__plantuml = {
      renderToString: (_lines, onSuccess, _onError, options) =>
        onSuccess(`<svg data-dark="${String(options?.dark)}"></svg>`),
    };
    const root = document.createElement("div");
    root.innerHTML = '<pre class="plantuml">@startuml\nA -&gt; B\n@enduml</pre>';
    document.body.appendChild(root);
    await renderPlantUml(root);

    document.body.setAttribute("data-md-color-scheme", "slate");
    await reRenderDiagramTheme(root);

    expect(root.querySelector("svg")?.getAttribute("data-dark")).toBe("true");
  });

  it("leaves diagrams as text when the runtime is not configured", async () => {
    initMermaid({ mermaidUri: "" });
    const root = document.createElement("div");
    root.innerHTML = '<pre class="plantuml">@startuml\nA -&gt; B\n@enduml</pre>';
    document.body.appendChild(root);

    await renderPlantUml(root);

    const block = root.querySelector<HTMLElement>(".plantuml")!;
    expect(block.hasAttribute("data-processed")).toBe(false);
    expect(block.hasAttribute("data-render-error")).toBe(false);
    expect(block.textContent).toContain("A -> B");
  });
});
