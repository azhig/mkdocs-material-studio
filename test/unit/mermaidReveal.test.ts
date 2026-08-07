// @vitest-environment happy-dom
//
// A diagram must not be drawn where it cannot be measured. Mermaid lays text
// out through the live DOM; inside display:none — an unopened tab, a collapsed
// call-out — every measure comes back empty, mermaid draws its “Syntax error in
// text” bomb, and data-processed pins the wreck even after the container opens.
// This is exactly what a user saw: a diagram inserted into the third tab of a
// document bombed on the next open of the file.

import { beforeEach, describe, expect, it } from "vitest";
import { initMermaid, renderMermaid, watchMermaidReveal } from "../../webviews/shared/mermaid";

declare const window: Window & {
  __mermaid?: { initialize: (o: unknown) => void; run: (o?: unknown) => Promise<void> };
};

/** What the stub was asked to draw, call by call. */
let drawn: HTMLElement[][];

beforeEach(() => {
  document.body.innerHTML = "";
  drawn = [];
  window.__mermaid = {
    initialize: () => {},
    run: (o) => {
      const nodes = (o as { nodes: HTMLElement[] }).nodes;
      drawn.push([...nodes]);
      // The real mermaid marks what it drew; the guard against redrawing
      // depends on it.
      for (const n of nodes) {
        n.setAttribute("data-processed", "true");
      }
      return Promise.resolve();
    },
  };
  initMermaid({ mermaidUri: "stub.js" });
});

/** A tab-like layout: one diagram on screen, one inside a hidden panel. */
function twoTabs(): { root: HTMLElement; visible: HTMLElement; hidden: HTMLElement } {
  const root = document.createElement("div");
  root.innerHTML = [
    '<div class="tabbed-block"><pre class="mermaid">flowchart TD</pre></div>',
    '<div class="tabbed-block" style="display:none"><pre class="mermaid">flowchart LR</pre></div>',
  ].join("");
  document.body.appendChild(root);
  const [visible, hidden] = Array.from(root.querySelectorAll<HTMLElement>(".mermaid"));
  return { root, visible, hidden };
}

describe("what gets drawn", () => {
  it("draws the diagram on screen and leaves the hidden one for later", async () => {
    const { root, visible, hidden } = twoTabs();
    await renderMermaid(root);
    expect(drawn).toEqual([[visible]]);
    // Undrawn and unmarked — still eligible once its tab opens.
    expect(hidden.hasAttribute("data-processed")).toBe(false);
    expect(hidden.textContent).toBe("flowchart LR");
  });

  it("leaves a diagram inside a collapsed call-out for later", async () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<details><summary>t</summary><pre class="mermaid">flowchart TD</pre></details>';
    document.body.appendChild(root);
    await renderMermaid(root);
    expect(drawn).toEqual([]);
  });

  it("never draws the same diagram twice", async () => {
    const { root, visible } = twoTabs();
    await renderMermaid(root);
    await renderMermaid(root);
    expect(drawn).toEqual([[visible]]);
  });
});

describe("the reveal", () => {
  it("draws the deferred diagram when its tab is switched to", async () => {
    const { root, hidden } = twoTabs();
    watchMermaidReveal(root);
    await renderMermaid(root);
    // The tab opens: Material flips a radio (change bubbles) and the panel shows.
    (hidden.closest(".tabbed-block") as HTMLElement).style.display = "";
    const radio = document.createElement("input");
    radio.type = "radio";
    root.appendChild(radio);
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(drawn.flat()).toContain(hidden);
  });

  it("draws the deferred diagram when its call-out unfolds", async () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<details><summary>t</summary><pre class="mermaid">flowchart TD</pre></details>';
    document.body.appendChild(root);
    const details = root.querySelector("details") as HTMLDetailsElement;
    const pre = root.querySelector<HTMLElement>(".mermaid") as HTMLElement;
    watchMermaidReveal(root);
    await renderMermaid(root);
    expect(drawn).toEqual([]);
    details.open = true;
    // toggle does not bubble — the watcher has to catch it in the capture phase.
    details.dispatchEvent(new Event("toggle", { bubbles: false }));
    await Promise.resolve();
    expect(drawn.flat()).toContain(pre);
  });
});
