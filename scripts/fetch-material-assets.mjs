// Downloads the mkdocs-material wheel from PyPI and extracts CSS/fonts/icons into assets/.
// The result is committed to the repository; the script is only needed when bumping the version.
//
// Usage: node scripts/fetch-material-assets.mjs [version]

import { mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFile = promisify(execFileCb);
const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(ROOT, "assets");
const TMP = path.join(ROOT, ".asset-tmp");

const pinnedVersion = process.argv[2] || "9.7.7";

async function main() {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  const meta = await fetchJson(`https://pypi.org/pypi/mkdocs-material/${pinnedVersion}/json`);
  const wheel = meta.urls.find((u) => u.packagetype === "bdist_wheel");
  if (!wheel) {
    throw new Error("wheel not found on PyPI");
  }
  console.log(`Downloading ${wheel.filename}…`);
  const whlPath = path.join(TMP, wheel.filename);
  await download(wheel.url, whlPath);

  console.log("Extracting…");
  const unpacked = path.join(TMP, "unpacked");
  await mkdir(unpacked, { recursive: true });
  await execFile("unzip", ["-q", "-o", whlPath, "-d", unpacked]);

  const stylesDir = path.join(unpacked, "material", "templates", "assets", "stylesheets");
  const cssOut = path.join(ASSETS, "material-css");
  await mkdir(cssOut, { recursive: true });

  const files = await readdir(stylesDir);
  for (const f of files) {
    if (!f.endsWith(".css")) {
      continue;
    }
    // main.<hash>.min.css → main.css, palette.<hash>.min.css → palette.css
    const base = f.split(".")[0];
    const target = path.join(cssOut, `${base}.css`);
    let css = await readFile(path.join(stylesDir, f), "utf8");
    // Font references in the CSS point to Google Fonts at runtime — we leave them as
    // they are; the fallback layer hooks up system fonts on our own side.
    await writeFile(target, css);
    console.log(`  ${f} → material-css/${base}.css (${Math.round(css.length / 1024)} KB)`);
  }

  // Copy the license metadata.
  const distInfo = (await readdir(unpacked)).find((d) => d.endsWith(".dist-info"));
  if (distInfo) {
    try {
      const lic = await readFile(
        path.join(unpacked, distInfo, "licenses", "LICENSE"),
        "utf8",
      ).catch(() => readFile(path.join(unpacked, distInfo, "LICENSE"), "utf8"));
      await writeFile(path.join(cssOut, "LICENSE"), lic);
      console.log("  LICENSE copied");
    } catch {
      console.warn("  LICENSE not found in the wheel");
    }
  }

  // Extract the icons (material/templates/.icons) — index + SVG.
  const iconsSrc = path.join(unpacked, "material", "templates", ".icons");
  await extractIcons(iconsSrc, path.join(ASSETS, "icons"));

  await writeFile(path.join(cssOut, "VERSION"), pinnedVersion + "\n");
  await rm(TMP, { recursive: true, force: true });
  console.log(`Done. mkdocs-material ${pinnedVersion}.`);
}

async function extractIcons(srcDir, outDir) {
  await mkdir(path.join(outDir, "svg"), { recursive: true });
  const index = [];
  const sets = await readdir(srcDir).catch(() => []);
  for (const set of sets) {
    const setDir = path.join(srcDir, set);
    await walkSvgs(setDir, setDir, set, index, outDir);
  }
  await writeFile(path.join(outDir, "index.json"), JSON.stringify(index));
  console.log(`  icons extracted: ${index.length}`);
}

async function walkSvgs(dir, base, set, index, outDir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkSvgs(full, base, set, index, outDir);
    } else if (e.name.endsWith(".svg")) {
      const rel = path
        .relative(base, full)
        .replace(/\.svg$/, "")
        .split(path.sep)
        .join("-");
      const shortcode = `${set}-${rel}`;
      index.push(shortcode);
      const targetDir = path.join(outDir, "svg", set);
      await mkdir(targetDir, { recursive: true });
      const svg = await readFile(full, "utf8");
      await writeFile(path.join(targetDir, `${rel}.svg`), svg);
    }
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
