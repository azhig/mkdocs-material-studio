// Rebuilds assets/icon.png (the Marketplace icon) from assets/icon.svg.
//
// The PNG is committed to the repository: publishing must not depend on the
// machine having an SVG rasterizer. Run this only after editing the SVG.
//
// macOS only — it uses the system tools (qlmanage + sips) so that the repo does
// not carry a heavyweight image dependency for a file that changes once a year.
// On other systems convert the SVG by any means and keep the 128×128 PNG.
//
// TRANSPARENCY. qlmanage draws on a white sheet and throws the alpha channel
// away — the rounded tile came out with white corners, the brightest thing in
// the extensions list of a dark theme. So the icon is rendered TWICE, over white
// and over black, and the alpha is recovered from the difference: a pixel that
// stayed the same is opaque, one that followed the backdrop is transparent, and
// everything in between (the anti-aliased edge of the rounding) gets its exact
// fraction. The formula is the compositing one solved backwards:
//   over white: Cw = C·a + 1·(1−a)      over black: Cb = C·a
//   ⇒ a = 1 − (Cw − Cb),  C = Cb / a

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { deflateSync, inflateSync } from "node:zlib";
import * as path from "node:path";

const execFile = promisify(execFileCb);
const ROOT = path.resolve(import.meta.dirname, "..");
const SVG = path.join(ROOT, "assets", "icon.svg");
const PNG = path.join(ROOT, "assets", "icon.png");
const SIZE = 128;

if (process.platform !== "darwin") {
  console.error(
    "This script relies on macOS tools (qlmanage, sips).\n" +
      "Convert assets/icon.svg to a 128×128 assets/icon.png with any rasterizer instead.",
  );
  process.exit(1);
}

// --- A minimal PNG codec: only what these two files need. ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads a PNG into flat RGBA bytes. Supports the colour types sips produces. */
function decodePng(buf) {
  let pos = 8;
  let header;
  const idat = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === "IDAT") {
      idat.push(body);
    }
    pos += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  if (!channels || header.depth !== 8 || header.interlace !== 0) {
    throw new Error(
      `unsupported PNG: colour type ${header.colorType}, depth ${header.depth}, interlace ${header.interlace}`,
    );
  }
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    const line = Buffer.from(raw.subarray(at, at + stride));
    at += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) {
        line[i] = (line[i] + a) & 0xff;
      } else if (filter === 2) {
        line[i] = (line[i] + b) & 0xff;
      } else if (filter === 3) {
        line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (channels >= 3) {
        out[dst] = line[src];
        out[dst + 1] = line[src + 1];
        out[dst + 2] = line[src + 2];
        out[dst + 3] = channels === 4 ? line[src + 3] : 255;
      } else {
        out[dst] = out[dst + 1] = out[dst + 2] = line[src];
        out[dst + 3] = channels === 2 ? line[src + 1] : 255;
      }
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

/** Writes flat RGBA bytes as a PNG. Filter 0 everywhere — the image is tiny. */
function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Rendering ---

const source = await readFile(SVG, "utf8");

/** The same SVG with an opaque backdrop slipped under the artwork. */
function withBackdrop(color) {
  return source.replace(
    /(<svg\b[^>]*>)/,
    `$1\n  <rect width="100%" height="100%" fill="${color}"/>`,
  );
}

const tmp = await mkdtemp(path.join(tmpdir(), "mkdocs-material-studio-icon-"));
try {
  const layers = {};
  for (const [name, color] of [
    ["white", "#ffffff"],
    ["black", "#000000"],
  ]) {
    const svgPath = path.join(tmp, `${name}.svg`);
    await writeFile(svgPath, withBackdrop(color));
    // Render at 512 and downscale: the small size comes out noticeably smoother.
    await execFile("qlmanage", ["-t", "-s", "512", "-o", tmp, svgPath]);
    const rendered = path.join(tmp, `${name}.svg.png`);
    const scaled = path.join(tmp, `${name}.png`);
    await execFile("sips", ["-z", String(SIZE), String(SIZE), rendered, "--out", scaled]);
    layers[name] = decodePng(await readFile(scaled));
  }

  const { width, height } = layers.white;
  const onWhite = layers.white.pixels;
  const onBlack = layers.black.pixels;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    // One alpha for the pixel: the channels agree, so the average is steadier
    // than any single one of them against rounding.
    let alpha = 0;
    for (let c = 0; c < 3; c++) {
      alpha += 255 - (onWhite[o + c] - onBlack[o + c]);
    }
    alpha = Math.max(0, Math.min(255, Math.round(alpha / 3)));
    out[o + 3] = alpha;
    for (let c = 0; c < 3; c++) {
      // Un-multiply: on black the colour arrives already scaled by the alpha.
      out[o + c] =
        alpha === 0 ? 0 : Math.max(0, Math.min(255, Math.round((onBlack[o + c] * 255) / alpha)));
    }
  }

  await writeFile(PNG, encodePng(width, height, out));
  console.log(`assets/icon.png rebuilt (${width}×${height}, transparent background)`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
