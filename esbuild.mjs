import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
// Off by default: the integration bundles are for `vscode-test`, and the VSIX
// must never carry them.
const withTests = process.argv.includes("--tests");
const ROOT = import.meta.dirname;

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

/** Webview bundles (browser environment, IIFE). */
const webviewConfigs = [
  {
    entryPoints: ["webviews/preview/main.ts"],
    outfile: "dist/webview/preview.js",
  },
  {
    entryPoints: ["webviews/vendor/mermaid.ts"],
    outfile: "dist/webview/mermaid.js",
  },
  {
    entryPoints: ["node_modules/@plantuml/core/viz-global.js"],
    outfile: "dist/webview/plantuml-viz.js",
    // This UMD file contains a dead Node fallback (`require("url")`). Keeping it
    // as one browser script avoids resolving that branch during bundling.
    bundle: false,
  },
  {
    entryPoints: ["webviews/vendor/plantuml.ts"],
    outfile: "dist/webview/plantuml.js",
  },
  {
    entryPoints: ["webviews/vendor/katex.ts"],
    outfile: "dist/webview/katex.js",
  },
  {
    entryPoints: ["webviews/wizard/main.ts"],
    outfile: "dist/webview/wizard.js",
  },
  {
    entryPoints: ["webviews/config/main.ts"],
    outfile: "dist/webview/config.js",
  },
  {
    entryPoints: ["webviews/visual/main.ts"],
    outfile: "dist/webview/visual.js",
  },
  {
    // Dev harness (never shipped: dist/webview/harness.js is listed in .vscodeignore).
    entryPoints: ["webviews/harness/main.ts"],
    outfile: "dist/webview/harness.js",
  },
];

/**
 * Integration tests, one bundle per file: mocha runs inside the extension host
 * and loads plain CommonJS from disk, so TypeScript has to be gone by then.
 * @returns {Promise<import('esbuild').BuildOptions[]>}
 */
async function integrationTestConfigs() {
  const dir = path.join(ROOT, "test", "integration");
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".test.ts"));
  } catch {
    return [];
  }
  return files.map((file) => ({
    entryPoints: [path.join("test", "integration", file)],
    outfile: path.join("dist", "test", file.replace(/\.ts$/, ".js")),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    // `vscode` is handed to the test by the host; mocha's globals come from the
    // runner that loaded the file.
    external: ["vscode", "mocha"],
    sourcemap: true,
    logLevel: "info",
  }));
}

/** @returns {import('esbuild').BuildOptions} */
function webviewOptions(entry) {
  return {
    ...entry,
    bundle: entry.bundle ?? true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  };
}

async function copyVendorAssets() {
  // KaTeX CSS and fonts are needed at runtime inside the webview.
  const katexSrc = path.join(ROOT, "node_modules", "katex", "dist");
  const katexOut = path.join(ROOT, "assets", "vendor", "katex");
  await rm(katexOut, { recursive: true, force: true });
  await mkdir(katexOut, { recursive: true });
  await cp(path.join(katexSrc, "katex.min.css"), path.join(katexOut, "katex.min.css"));
  await cp(path.join(katexSrc, "fonts"), path.join(katexOut, "fonts"), { recursive: true });

  // Codicons (the VS Code icon font) for the webview panels.
  const codiconSrc = path.join(ROOT, "node_modules", "@vscode", "codicons", "dist");
  const codiconOut = path.join(ROOT, "assets", "vendor", "codicons");
  await rm(codiconOut, { recursive: true, force: true });
  await mkdir(codiconOut, { recursive: true });
  await cp(path.join(codiconSrc, "codicon.css"), path.join(codiconOut, "codicon.css"));
  await cp(path.join(codiconSrc, "codicon.ttf"), path.join(codiconOut, "codicon.ttf"));

  // The PlantUML JavaScript itself is bundled into dist; ship its MIT notice too.
  const plantumlOut = path.join(ROOT, "assets", "vendor", "plantuml");
  await rm(plantumlOut, { recursive: true, force: true });
  await mkdir(plantumlOut, { recursive: true });
  const plantumlLicense = await readFile(
    path.join(ROOT, "node_modules", "@plantuml", "core", "LICENSE"),
    "utf8",
  );
  await writeFile(path.join(plantumlOut, "LICENSE"), plantumlLicense.replace(/\r\n/g, "\n"));
}

/**
 * Icon index for the “Icons, Emojis” picker in the visual editor:
 * { material: ["account", …], fontawesome: [...], octicons: [...], simple: [...] }.
 * Icon shortcode = `${set}-${name}` (file `${set}/${name}.svg`).
 */
async function generateIconIndex() {
  const svgRoot = path.join(ROOT, "assets", "icons", "svg");
  let sets;
  try {
    sets = (await readdir(svgRoot, { withFileTypes: true })).filter((d) => d.isDirectory());
  } catch {
    return; // no icon assets — skip
  }
  const index = {};
  for (const set of sets) {
    const files = await readdir(path.join(svgRoot, set.name));
    index[set.name] = files
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -4))
      .sort();
  }
  await writeFile(path.join(ROOT, "assets", "icons", "index.json"), JSON.stringify(index));
  const total = Object.values(index).reduce((n, a) => n + a.length, 0);
  console.log(`[icons] index: ${total} icons in ${Object.keys(index).length} sets`);
}

async function main() {
  await copyVendorAssets();
  await generateIconIndex();
  const configs = [
    extensionConfig,
    ...webviewConfigs.map(webviewOptions),
    ...(withTests ? await integrationTestConfigs() : []),
  ];

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("[esbuild] watching…");
  } else {
    await Promise.all(configs.map((c) => esbuild.build(c)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
