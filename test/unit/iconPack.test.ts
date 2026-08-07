// Reading an icon out of the pack. The 14 342 icons ship as one file plus an
// index of offsets, so this is the only place that knows how to get one back —
// and getting it wrong means every icon on the page turns into nothing.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openIconPack } from "../../src/core/iconPack";

const HOME = '<svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4"/></svg>';
const REPO = '<svg viewBox="0 0 16 16"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0"/></svg>';

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "icon-pack-"));
  const parts = [HOME, CHECK, REPO].map((svg) => Buffer.from(svg, "utf8"));
  fs.writeFileSync(path.join(root, "icons.pack"), Buffer.concat(parts));
  fs.writeFileSync(
    path.join(root, "icons.index.json"),
    JSON.stringify({
      material: {
        home: [0, parts[0].length],
        "check-circle": [parts[0].length, parts[1].length],
      },
      octicons: { "repo-16": [parts[0].length + parts[1].length, parts[2].length] },
    }),
  );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("an icon out of the pack", () => {
  it("comes back byte for byte, from any set", () => {
    const pack = openIconPack(root);
    expect(pack.get("material-home")).toBe(HOME);
    expect(pack.get("material-check-circle")).toBe(CHECK);
    expect(pack.get("octicons-repo-16")).toBe(REPO);
    pack.dispose();
  });

  it("keeps the name with the dashes in it — `check-circle` is one icon", () => {
    const pack = openIconPack(root);
    // Splitting on the LAST dash would look for the set “material-check”.
    expect(pack.get("material-check-circle")).toBe(CHECK);
    pack.dispose();
  });

  it("answers nothing for an unknown icon, set or shape", () => {
    const pack = openIconPack(root);
    expect(pack.get("material-nosuchicon")).toBeUndefined();
    expect(pack.get("nosuchset-home")).toBeUndefined();
    expect(pack.get("noseparator")).toBeUndefined();
    pack.dispose();
  });

  it("reads a batch in one call, skipping what it does not have", () => {
    const pack = openIconPack(root);
    expect(pack.getMany(["material-home", "material-nope", "octicons-repo-16"])).toEqual({
      "material-home": HOME,
      "octicons-repo-16": REPO,
    });
    pack.dispose();
  });

  it("lists the names of every set — that is what the picker searches", () => {
    const pack = openIconPack(root);
    expect(pack.names()).toEqual({
      material: ["home", "check-circle"],
      octicons: ["repo-16"],
    });
    pack.dispose();
  });

  it("survives a missing pack instead of taking the render down with it", () => {
    const pack = openIconPack(path.join(root, "nowhere"));
    expect(pack.get("material-home")).toBeUndefined();
    expect(pack.names()).toEqual({});
    pack.dispose();
  });
});
