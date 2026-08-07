// Writes the screenshots for the Marketplace page into docs/images/.
//
// Same idea as record-demo.mjs, and for the same reason: the pictures come out
// of the dev harness, which runs the very bundle that ships in the VSIX, so the
// page shows the real editor rather than a mock-up. One headless Chrome, driven
// over the DevTools protocol; each scene loads a document, arranges the
// interface and is shot once the page has settled.
//
// Usage:  npm run shots
//         npm run shots -- --scene editing    — one scene only
//
// Requirements: macOS with Google Chrome.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "images");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HARNESS_PORT = 8933; // not 8931/8932: those may be busy with the harness or the recorder
const CDP_PORT = 9334;
// Wide enough for the site header, the page panel and the text at a readable
// size; the Marketplace scales the picture down to about 1000 px.
const WIDTH = 1440;
const HEIGHT = 900;

const args = process.argv.slice(2);
const only = args.includes("--scene") ? args[args.indexOf("--scene") + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page every scene is shot on: one document that shows the range. */
const DOC = [
  "# Getting started",
  "",
  "MkDocs Material Studio draws your documentation the way the published site does —",
  "and **Python is not required** to see it. (1)",
  "{ .annotate }",
  "",
  "1.  Everything on this page is rendered by a built-in engine. `mkdocs serve` stays",
  "    your own business, in the terminal.",
  "",
  '!!! tip "The page itself is the editor"',
  "",
  "    Click anywhere and type. Structural changes go through the source, so the",
  "    blocks you did not touch come back byte for byte.",
  "",
  '=== "Python"',
  "",
  '    ```python title="app.py" hl_lines="2"',
  "    def greet(name):",
  '        return f"Hello, {name}"',
  "    ```",
  "",
  '=== "Shell"',
  "",
  "    ```bash",
  "    pip install mkdocs-material",
  "    ```",
  "",
  "## How a page becomes a site",
  "",
  "```mermaid",
  "graph LR",
  "  A[Markdown] --> B[Preview]",
  "  B --> C[Published site]",
  "```",
  "",
  "| What                | Needs Python |",
  "| ------------------- | ------------ |",
  "| Preview and editing | no           |",
  "| Search, plugins     | yes          |",
  "",
].join("\n");

/**
 * The scenes. `setup` runs in the page and returns once the scene is arranged;
 * the shot follows one animation frame later.
 */
const SCENES = [
  {
    name: "editing",
    file: "visual-editor.png",
    setup: `(async () => {
      window.__harness.load(DOC);
      await wait(1800);
      document.body.classList.remove("vscode-dark");
    })()`,
  },
  {
    name: "block-menu",
    file: "block-menu.png",
    setup: `(async () => {
      window.__harness.load(DOC);
      await wait(1800);
      const doc = document.getElementById("doc");
      const block = doc.querySelector(".admonition");
      const r = block.getBoundingClientRect();
      block.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, clientX: r.left + 8, clientY: r.top + 8}));
      await wait(150);
      document.getElementById("vhandle").dispatchEvent(new MouseEvent("click", {bubbles: true}));
      await wait(250);
    })()`,
  },
  {
    name: "dark",
    file: "dark-theme.png",
    // Through the toolbar button, the way a reader switches it: the VS Code
    // class alone would leave Material on its light palette, and the shot would
    // show a dark chrome around a white page.
    setup: `(async () => {
      window.__harness.load(DOC);
      await wait(1800);
      document.body.classList.add("vscode-dark");
      document.getElementById("tbTheme").dispatchEvent(new MouseEvent("click", {bubbles: true}));
      await wait(900);
      if (document.body.getAttribute("data-md-color-scheme") !== "slate") {
        throw new Error("the page did not switch to the dark palette");
      }
    })()`,
  },
];

/** Waits for an HTTP endpoint to answer. */
async function waitFor(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return res;
      }
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error(`no answer from ${url}`);
}

/** A minimal DevTools protocol client over the WebSocket built into Node. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message));
      } else {
        resolve(msg.result);
      }
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function shoot(cdp, scene) {
  await cdp.send("Page.navigate", { url: `http://localhost:${HARNESS_PORT}/` });
  await sleep(700); // the bundle, the fonts and the first render
  const prelude = `const DOC = ${JSON.stringify(DOC)}; const wait = (ms) => new Promise((r) => setTimeout(r, ms));`;
  const { exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: `(async () => { ${prelude} await ${scene.setup}; })()`,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(`${scene.name}: ${exceptionDetails.exception?.description ?? "failed"}`);
  }
  await sleep(200);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, scene.file);
  await writeFile(file, Buffer.from(data, "base64"));
  return file;
}

const harness = spawn(process.execPath, [path.join(ROOT, "scripts", "harness", "server.mjs")], {
  env: { ...process.env, PORT: String(HARNESS_PORT) },
  stdio: "ignore",
});
const tmp = await mkdtemp(path.join(tmpdir(), "mkdocs-material-studio-shots-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  `--window-size=${WIDTH},${HEIGHT}`,
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${path.join(tmp, "profile")}`,
  "about:blank",
]);

let cdp;
try {
  await mkdir(OUT_DIR, { recursive: true });
  await waitFor(`http://localhost:${HARNESS_PORT}/scripts/harness/index.html`);
  const version = await (await waitFor(`http://localhost:${CDP_PORT}/json/version`)).json();
  cdp = await connect(version.webSocketDebuggerUrl);

  // The browser-level socket cannot screenshot: attach to the page target.
  const { targetInfos } = await cdp.send("Target.getTargets");
  const page = targetInfos.find((t) => t.type === "page");
  const list = await (await fetch(`http://localhost:${CDP_PORT}/json/list`)).json();
  const pageUrl = list.find((t) => t.id === page.targetId)?.webSocketDebuggerUrl;
  cdp.close();
  cdp = await connect(pageUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const scenes = only ? SCENES.filter((s) => s.name === only) : SCENES;
  if (scenes.length === 0) {
    throw new Error(`no scene named ${only}; try: ${SCENES.map((s) => s.name).join(", ")}`);
  }
  for (const scene of scenes) {
    const file = await shoot(cdp, scene);
    console.log(`  ${scene.name} → ${path.relative(ROOT, file)}`);
  }
} finally {
  cdp?.close();
  chrome.kill();
  harness.kill();
  // Chrome writes to its profile as it shuts down: deleting the directory out
  // from under it fails with ENOTEMPTY, so give it a moment and retry.
  await sleep(400);
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((err) =>
    console.warn(`could not remove ${tmp}: ${err.message}`),
  );
}
