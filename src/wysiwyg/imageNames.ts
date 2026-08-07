// Naming a pasted or dropped image.
//
// Whatever comes off the clipboard becomes a file name in the author's project,
// so it has to survive the trip: a screenshot arrives with no name at all, a
// drag from a browser brings a name full of spaces and query strings, and a
// name made entirely of punctuation would sanitize down to nothing. None of
// this reaches the file system until the name is settled.

import * as path from "node:path";

const BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

/** File extension: from the MIME type, else from the original name, else png. */
export function imageExt(mime: string, name: string): string {
  if (BY_MIME[mime]) {
    return BY_MIME[mime];
  }
  const fromName = path.extname(name).replace(/^\./, "").toLowerCase();
  return fromName || "png";
}

/**
 * The name without its extension, reduced to what a file system takes
 * everywhere.
 *
 * Letters are letters in every script: `\w` is ASCII, so it turned `διάγραμμα.png`
 * into `image.png` and lost the author's own name for the picture — in an
 * extension that ships in Russian, Chinese and Japanese. What has to go is what
 * a path or a Markdown link cannot carry: separators, the characters Windows
 * refuses, spaces, and a leading or trailing dot (a hidden file on Unix, an
 * invalid name on Windows).
 *
 * A name that sanitizes down to nothing becomes “image” — an empty base would
 * make the file `.png`, hidden on Unix and nameless in the markdown.
 */
export function imageBaseName(name: string): string {
  return (
    path
      .basename(name, path.extname(name))
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "image"
  );
}

/** The candidates tried in turn: image.png, image-1.png, image-2.png, … */
export function imageCandidate(base: string, ext: string, index: number): string {
  return index === 0 ? `${base}.${ext}` : `${base}-${index}.${ext}`;
}
