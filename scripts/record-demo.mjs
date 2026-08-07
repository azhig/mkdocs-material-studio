// Records assets/demo.gif — the walk-through of the visual editor shown in README.
//
// The frames come from the dev harness (scripts/harness/index.html), which runs
// the very bundle that ships in the VSIX, so the recording shows the real editor
// rather than a mock-up. scripts/harness/demo.js replays the scenario up to a
// given step and marks the body with data-demo-ready when the step is drawn;
// this script drives one Chrome over the DevTools protocol, waits for that mark
// and grabs a screenshot per step, then hands the lot to ffmpeg.
//
// Chrome's own --screenshot is not used on purpose: the page keeps timers alive
// (the editor re-renders, mermaid warms up), --virtual-time-budget therefore
// never expires and the browser hangs instead of shooting.
//
// Usage:  npm run demo                          — the whole recording
//         npm run demo -- --frame 12            — one frame into assets/
//         npm run demo -- --keep                — keep the raw frames
//
// Requirements: macOS with Google Chrome, and ffmpeg on PATH.

import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

const execFile = promisify(execFileCb);
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "assets", "demo.gif");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HARNESS_PORT = 8932; // not 8931: the harness may already be open for hand testing
const CDP_PORT = 9333;
const WIDTH = 1180;
const HEIGHT = 720;
/**
 * Frames per second of the result. The scenario is written for a calm pace:
 * every frame is a step someone has to read before the next one replaces it.
 */
const FPS = 4;
/** Width of the GIF; the height follows the aspect ratio. */
const GIF_WIDTH = 940;

const args = process.argv.slice(2);
const only = args.includes("--frame") ? Number(args[args.indexOf("--frame") + 1]) : null;
const keep = args.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const listeners = new Map();
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
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) {
        fn(msg.params);
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
    on(method, fn) {
      if (!listeners.has(method)) {
        listeners.set(method, []);
      }
      listeners.get(method).push(fn);
    },
    close() {
      ws.close();
    },
  };
}

/** Reads a property off the page. */
async function evaluate(cdp, expression) {
  const { result } = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  return result.value;
}

/** Loads one step of the scenario and screenshots it once the page says it is drawn. */
async function shoot(cdp, frame, dir) {
  await cdp.send("Page.navigate", {
    url: `http://localhost:${HARNESS_PORT}/scripts/harness/index.html?frame=${frame}`,
  });
  for (let i = 0; i < 200; i++) {
    const ready = await evaluate(cdp, `document.body.getAttribute("data-demo-ready")`).catch(
      () => null,
    );
    if (ready === String(frame)) {
      break;
    }
    await sleep(50);
  }
  // A beat for the last layout and the fonts.
  await sleep(120);
  const failure = await evaluate(cdp, `document.body.getAttribute("data-demo-error")`).catch(
    () => null,
  );
  if (failure) {
    console.warn(`\n  frame ${frame}: ${failure}`);
  }
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(dir, `f${String(frame).padStart(3, "0")}.png`);
  await writeFile(file, Buffer.from(data, "base64"));
  return file;
}

const harness = spawn(process.execPath, [path.join(ROOT, "scripts", "harness", "server.mjs")], {
  env: { ...process.env, PORT: String(HARNESS_PORT) },
  stdio: "ignore",
});
const tmp = await mkdtemp(path.join(tmpdir(), "mkdocs-material-studio-demo-"));
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

  // Frame 0 also tells us how long the scenario is.
  await shoot(cdp, 0, tmp);
  const total = (await evaluate(cdp, `Number(document.body.dataset.demoFrames || 0)`)) || 46;
  const frames = only === null ? Array.from({ length: total }, (_, i) => i) : [only];
  console.log(`recording ${frames.length} frame(s) at ${WIDTH}×${HEIGHT}`);

  for (const frame of frames) {
    if (frame === 0 && only === null) {
      continue; // already taken
    }
    await shoot(cdp, frame, tmp);
    process.stdout.write(`\r  frame ${frame + 1}/${frames.length}`);
  }
  process.stdout.write("\n");

  if (only !== null) {
    const preview = path.join(ROOT, "assets", `demo-frame-${only}.png`);
    await execFile("cp", [path.join(tmp, `f${String(only).padStart(3, "0")}.png`), preview]);
    console.log(`single frame written to ${path.relative(ROOT, preview)}`);
  } else {
    // Two passes: a palette built from the whole clip, then the dithered result.
    // A GIF holds 256 colours, and a shared palette is what keeps the flat UI
    // surfaces from banding.
    const palette = path.join(tmp, "palette.png");
    const input = path.join(tmp, "f%03d.png");
    const scale = `scale=${GIF_WIDTH}:-1:flags=lanczos`;
    await execFile("ffmpeg", [
      "-y", "-framerate", String(FPS), "-i", input,
      "-vf", `${scale},palettegen=max_colors=192:stats_mode=diff`,
      palette,
    ]); // prettier-ignore
    await mkdir(path.dirname(OUT), { recursive: true });
    await execFile("ffmpeg", [
      "-y", "-framerate", String(FPS), "-i", input, "-i", palette,
      "-lavfi", `${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      "-loop", "0", OUT,
    ]); // prettier-ignore
    console.log(`assets/demo.gif written from ${total} frames`);
  }
} finally {
  cdp?.close();
  chrome.kill();
  harness.kill();
  if (keep) {
    console.log(`frames kept in ${tmp}`);
  } else {
    // Chrome writes to its profile as it shuts down: deleting the directory out
    // from under it fails with ENOTEMPTY, so give it a moment and retry.
    await sleep(400);
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch((err) =>
      console.warn(`could not remove ${tmp}: ${err.message}`),
    );
  }
}
