// Reading the icon pack.
//
// The icon sets of mkdocs-material are 14 342 files; shipped as such they cost
// 1.4 MB of ZIP overhead in the VSIX and make the extension slow to install. The
// build packs them into one file (scripts/pack-icons.mjs) plus an index of
// offsets, and this reads a single icon out of it without loading the rest.
//
// The index is small enough to keep in memory (0.4 MB); the pack is not, so it
// stays on disk behind an open descriptor and is read by offset.

import * as fs from "node:fs";
import * as path from "node:path";

/** set → icon name → [offset, byte length] in the pack. */
type PackIndex = Record<string, Record<string, [number, number]>>;

export interface IconPack {
  /** The names of every icon, by set — what the picker lists and searches. */
  names(): Record<string, string[]>;
  /** The SVG of `material-home`, or undefined when there is no such icon. */
  get(shortcode: string): string | undefined;
  /** The same for a batch — one file read per icon, one message per screen. */
  getMany(shortcodes: readonly string[]): Record<string, string>;
  /**
   * What went wrong opening the pack, when something did. Without it a broken
   * install looks exactly like a page with no icons on it: every shortcode is
   * simply left as text, and nothing anywhere says why.
   */
  problem?: string;
  /** Closes the descriptor; the pack is unusable afterwards. */
  dispose(): void;
}

/**
 * Opens the pack in `root` (the directory holding icons.pack and
 * icons.index.json). A missing or unreadable pack is not fatal: every lookup
 * then answers undefined and the render falls back to the emoji shortcodes,
 * exactly as it does for an unknown icon name.
 */
export function openIconPack(root: string): IconPack {
  const problems: string[] = [];
  let index: PackIndex = {};
  try {
    index = JSON.parse(fs.readFileSync(path.join(root, "icons.index.json"), "utf8")) as PackIndex;
  } catch (err) {
    problems.push(`icons.index.json — ${String(err)}`);
  }
  let fd: number | undefined;
  try {
    fd = fs.openSync(path.join(root, "icons.pack"), "r");
  } catch (err) {
    problems.push(`icons.pack — ${String(err)}`);
  }
  // Icons repeat across a page (a call-out title, a nav entry), so the last few
  // hundred stay in memory. The cap keeps a long editing session bounded.
  const cache = new Map<string, string>();

  const read = (shortcode: string): string | undefined => {
    const hit = cache.get(shortcode);
    if (hit !== undefined) {
      return hit;
    }
    const dash = shortcode.indexOf("-");
    if (fd === undefined || dash < 0) {
      return undefined;
    }
    const entry = index[shortcode.slice(0, dash)]?.[shortcode.slice(dash + 1)];
    if (!entry) {
      return undefined;
    }
    const [offset, length] = entry;
    const buffer = Buffer.allocUnsafe(length);
    try {
      fs.readSync(fd, buffer, 0, length, offset);
    } catch {
      return undefined;
    }
    const svg = buffer.toString("utf8");
    if (cache.size > 2000) {
      cache.clear();
    }
    cache.set(shortcode, svg);
    return svg;
  };

  return {
    names: () =>
      Object.fromEntries(Object.entries(index).map(([set, icons]) => [set, Object.keys(icons)])),
    get: read,
    getMany: (shortcodes) => {
      const out: Record<string, string> = {};
      for (const code of shortcodes) {
        const svg = read(code);
        if (svg !== undefined) {
          out[code] = svg;
        }
      }
      return out;
    },
    problem: problems.length > 0 ? problems.join("; ") : undefined,
    dispose: () => {
      if (fd !== undefined) {
        fs.closeSync(fd);
        fd = undefined;
      }
      cache.clear();
    },
  };
}
