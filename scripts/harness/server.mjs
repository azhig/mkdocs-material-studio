// Tiny static server for the editor harnesses (no dependencies).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8931);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

// The icons ship as one pack (see src/core/iconPack.ts); the harness stands in
// for the extension and serves them the same way it answers messages — by
// shortcode, never as 14 342 files.
const ICONS = join(ROOT, "assets", "icons");
let iconIndex;
async function iconPack() {
  iconIndex ??= JSON.parse(await readFile(join(ICONS, "icons.index.json"), "utf8"));
  return iconIndex;
}

async function iconSvgs(codes) {
  const index = await iconPack();
  const pack = await readFile(join(ICONS, "icons.pack"));
  const out = {};
  for (const code of codes) {
    const dash = code.indexOf("-");
    const entry = dash > 0 ? index[code.slice(0, dash)]?.[code.slice(dash + 1)] : undefined;
    if (entry) {
      out[code] = pack.subarray(entry[0], entry[0] + entry[1]).toString("utf8");
    }
  }
  return out;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/icons/names") {
      const index = await iconPack();
      const sets = Object.fromEntries(Object.entries(index).map(([k, v]) => [k, Object.keys(v)]));
      res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
      res.end(JSON.stringify(sets));
      return;
    }
    if (url.pathname === "/icons/svgs") {
      const codes = (url.searchParams.get("codes") ?? "").split(",").filter(Boolean);
      res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
      res.end(JSON.stringify(await iconSvgs(codes)));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
    if (path === "" || path === "/") {
      path = "scripts/harness/index.html";
    }
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      // The bundles are rebuilt on the fly — caching only gets in the way of checks.
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => {
  console.log(`harness: http://localhost:${PORT}/`);
});
