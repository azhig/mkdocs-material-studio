// Smoke tests on a real VS Code.
//
// Everything else under test/ runs against the stand-in in test/mocks/, which
// knows nothing about the manifest, the bundle or the editor's own registries.
// This runner is the only place where all three are put together.

import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  // Built by `node esbuild.mjs --tests`: mocha loads plain CommonJS, not TypeScript.
  files: "dist/test/**/*.test.js",
  // A real MkDocs project, so `workspaceContains:mkdocs.yml` fires exactly the
  // way it does for a user opening their docs folder.
  workspaceFolder: "samples/demo",
  version: "stable",
  mocha: {
    ui: "bdd",
    // Starting a window, activating and opening webviews is slow on a cold CI
    // runner; the default 2 s would fail on the machine rather than on the code.
    timeout: 30_000,
  },
});
