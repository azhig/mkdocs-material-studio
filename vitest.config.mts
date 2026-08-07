import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      // The extension host talks to VS Code through this module, and there is no
      // VS Code here. The stand-in implements the slice that is actually used —
      // enough to drive a provider end to end and read back the text it wrote.
      // Exact match: @vscode/* packages must resolve normally.
      {
        find: /^vscode$/,
        replacement: fileURLToPath(new URL("./test/mocks/vscode.ts", import.meta.url)),
      },
    ],
  },
  test: {
    // Anchored to the repository's own tests: agent worktrees under .claude/
    // carry full copies of the tree, and the default glob would run every test
    // twice.
    include: ["test/**/*.test.ts"],
    // test/integration needs a real editor around it — `npm run test:integration`
    // builds those and hands them to mocha inside VS Code.
    exclude: [...configDefaults.exclude, "test/integration/**"],
    coverage: {
      provider: "v8",
      // Everything that ships, measured whether a test imports it or not: a file
      // no test has ever touched must show as 0%, not be absent from the report.
      all: true,
      include: ["src/**/*.ts", "webviews/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        // Type declarations for markdown-it plugins that ship without them.
        "src/types/**",
        // One-line re-exports that only exist to give esbuild a bundling seam.
        "webviews/vendor/**",
        // The dev harness runs in a browser and never reaches the VSIX.
        "webviews/harness/**",
      ],
      reporter: ["text-summary", "html", "lcov"],
      // A floor, not a target: it exists so a pull request cannot quietly take
      // coverage down, and it sits a couple of points under the current number
      // so ordinary refactoring does not trip it. Raise it when the number moves
      // up for real. Most of what is still uncovered is the four webview entry
      // points and the dialogs around them — the parts a browser has to drive.
      thresholds: {
        lines: 48,
        functions: 45,
        branches: 45,
        statements: 48,
      },
    },
  },
});
