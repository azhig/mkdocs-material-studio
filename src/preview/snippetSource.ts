// Where the text of a `--8<--` include comes from.
//
// The plugin that finds the line stays in mdPlugins/snippets.ts and knows no
// file system — it also runs in the dev harness, in a browser. Reading is the
// extension host's job, and this is the part of it that decides which files a
// page is allowed to name.

import * as path from "node:path";
import { isInside } from "../util/paths";

/**
 * The file a `--8<--` line names, taken from the first base directory that has
 * it. A path leading out of every base is not read at all: the name comes from
 * the page, a page is text somebody else wrote, and `../../../.ssh/id_rsa` is
 * not a snippet — pymdownx keeps its includes inside the base path for the same
 * reason. Reading itself is the caller's, so a test can hand this a set of
 * files instead of a disk.
 */
export function readSnippetFrom(
  bases: string[],
  relPath: string,
  read: (file: string) => string | undefined,
): string | undefined {
  for (const base of bases) {
    const file = path.resolve(base, relPath);
    if (!isInside(base, file)) {
      continue;
    }
    const content = read(file);
    if (content !== undefined) {
      return content;
    }
  }
  return undefined;
}
