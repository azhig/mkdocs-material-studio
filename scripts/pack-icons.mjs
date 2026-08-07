// Packs assets/icons/svg/**.svg into a single file plus an index of offsets.
//
// Why: the icon sets of mkdocs-material are 14 342 files. As separate files they
// cost 1.4 MB of ZIP entry overhead in the VSIX, make the extension slow to
// install (thousands of tiny files) and trip the packager's file-count warning.
// One pack is read by offset, so nothing is loaded that was not asked for.
//
// Run: node scripts/pack-icons.mjs [--from assets/icons/svg] [--out assets/icons]

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const from = path.resolve(argOf("--from", "assets/icons/svg"));
const out = path.resolve(argOf("--out", "assets/icons"));

/** The sets are the immediate directories: material, fontawesome, octicons, simple. */
function iconFiles(root) {
  const found = [];
  for (const set of fs.readdirSync(root, { withFileTypes: true })) {
    if (!set.isDirectory()) {
      continue;
    }
    const setDir = path.join(root, set.name);
    // fontawesome keeps its icons one level deeper (brands/, solid/, regular/);
    // mkdocs-material flattens that into `brands-github`, so we do the same.
    const walk = (dir, prefix) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, `${prefix}${entry.name}-`);
        } else if (entry.name.endsWith(".svg")) {
          found.push({ set: set.name, name: prefix + entry.name.slice(0, -4), file: full });
        }
      }
    };
    walk(setDir, "");
  }
  return found;
}

const icons = iconFiles(from).sort((a, b) =>
  a.set === b.set ? a.name.localeCompare(b.name) : a.set.localeCompare(b.set),
);

const chunks = [];
const index = {};
let offset = 0;
for (const icon of icons) {
  const svg = fs.readFileSync(icon.file);
  (index[icon.set] ??= {})[icon.name] = [offset, svg.length];
  chunks.push(svg);
  offset += svg.length;
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icons.pack"), Buffer.concat(chunks));
fs.writeFileSync(path.join(out, "icons.index.json"), JSON.stringify(index));

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
console.log(`packed ${icons.length} icons from ${Object.keys(index).length} sets`);
console.log(`  icons.pack       ${mb(offset)}`);
console.log(`  icons.index.json ${mb(fs.statSync(path.join(out, "icons.index.json")).size)}`);
