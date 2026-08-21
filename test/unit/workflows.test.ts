// The CI workflows, checked here because GitHub only checks them once they are
// pushed — and a workflow it refuses is not skipped, it is a failed run on every
// push, with no log to read and nothing but “workflow file issue” to go on.
//
// This project shipped exactly that: the release workflow tested a secret in a
// step's `if`, which is one of the contexts GitHub does not expose there. The
// file had never run, because it is triggered by a tag, so the mistake first
// appeared as a red mark on the first public commit.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";

const DIR = path.resolve(__dirname, "../../.github/workflows");

interface Step {
  if?: unknown;
  uses?: unknown;
  name?: unknown;
}
interface Job {
  if?: unknown;
  steps?: Step[];
}
interface Workflow {
  on?: { push?: { branches?: unknown; tags?: unknown } };
  jobs?: Record<string, Job>;
}

function workflows(): Array<{ file: string; doc: Workflow }> {
  return fs
    .readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({
      file,
      doc: parse(fs.readFileSync(path.join(DIR, file), "utf8")) as Workflow,
    }));
}

/** Every `if:` in the file — on jobs and on steps alike. */
function conditions(doc: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(doc.jobs ?? {})) {
    if (typeof job.if === "string") {
      out.push(job.if);
    }
    for (const step of job.steps ?? []) {
      if (typeof step.if === "string") {
        out.push(step.if);
      }
    }
  }
  return out;
}

describe("the workflows are the ones GitHub will accept", () => {
  it("has workflows at all, and each one parses", () => {
    const files = workflows();
    expect(files.map((w) => w.file).sort()).toEqual(["ci.yml", "release.yml"]);
    for (const { file, doc } of files) {
      expect(doc.on, `${file} has no trigger`).toBeDefined();
      expect(Object.keys(doc.jobs ?? {}).length, `${file} has no jobs`).toBeGreaterThan(0);
    }
  });

  it("reads no secret from an `if`, which GitHub rejects the whole file for", () => {
    // The fix is always the same: put the secret in `env` at the job, and let
    // the condition read `env.NAME` — that context is available to `if`.
    const offenders = workflows().flatMap(({ file, doc }) =>
      conditions(doc)
        .filter((cond) => /\bsecrets\./.test(cond))
        .map((cond) => `${file}: if: ${cond}`),
    );
    expect(offenders, `Use env instead:\n${offenders.map((o) => `  ${o}`).join("\n")}`).toEqual([]);
  });

  it("releases from main, so a version that lands there is published", () => {
    // The release used to wait for a tag nobody pushed: the repository had no
    // releases and no .vsix to download. Bumping the version and merging is the
    // whole ceremony now — the tag is cut by the workflow.
    const release = workflows().find((w) => w.file === "release.yml")?.doc;
    expect(release?.on?.push?.branches).toEqual(["main"]);
    expect(release?.on?.push?.tags).toEqual(["v*"]); // a tag cut by hand still works
  });

  it("pins every action to a major version", () => {
    // An unpinned `uses:` follows the action's default branch, so a workflow
    // that passed today can fail tomorrow without a commit of ours.
    const unpinned = workflows().flatMap(({ file, doc }) =>
      Object.values(doc.jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .map((step) => step.uses)
        .filter((uses): uses is string => typeof uses === "string")
        .filter((uses) => !/@v\d/.test(uses))
        .map((uses) => `${file}: ${uses}`),
    );
    expect(unpinned, `Actions without a version: ${unpinned.join(", ")}`).toEqual([]);
  });
});
