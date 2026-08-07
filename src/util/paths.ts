import * as path from "node:path";

/**
 * Is `target` the directory `base` itself, or something inside it? Both sides
 * are resolved first, so a path does not pass for being spelled with the right
 * folder at the front: `docs/../../../.ssh/id_rsa` starts with `docs/` and
 * still leads out of the project.
 */
export function isInside(base: string, target: string): boolean {
  const from = path.resolve(base);
  const to = path.resolve(target);
  if (to === from) {
    return true;
  }
  const rel = path.relative(from, to);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
