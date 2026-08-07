// Flat ESLint config. Deliberately small: the rules that actually catch bugs in
// this project are already enforced by tsc (strict, noUnusedLocals,
// noImplicitReturns), so ESLint only adds what the type checker cannot see.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // .claude/ holds tooling state (agent worktrees with their own dist/ builds).
    ignores: [
      "dist/**",
      "node_modules/**",
      "assets/**",
      "samples/**",
      "*.vsix",
      ".claude/**",
      // The VS Code copy the integration tests run in.
      ".vscode-test/**",
      // Generated coverage reports.
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // An unused variable is usually a leftover; the `_` prefix marks the
      // deliberate ones (an unused parameter required by a signature).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Webview code talks to the extension through `unknown` messages and casts
      // them at the boundary; forbidding `any` outright would only add noise.
      "@typescript-eslint/no-explicit-any": "warn",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
      // `\x00` is our sentinel inside the DOM → Markdown serializer (it marks a
      // hard break and an empty paragraph so they survive the round trip). The
      // control character in those regexes is intentional.
      "no-control-regex": "off",
    },
  },
  {
    // Browser scripts of the dev harness: they run in the page, not in Node.
    files: ["scripts/harness/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        location: "readonly",
        console: "readonly",
        getComputedStyle: "readonly",
        URLSearchParams: "readonly",
        MouseEvent: "readonly",
        Event: "readonly",
        NodeFilter: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    // Node scripts: build, harness server, asset download, test runner config.
    files: ["*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        // The icon build decodes and encodes the PNG by hand — it needs Buffer.
        Buffer: "readonly",
        // The demo recorder talks to Chrome over its debugging socket.
        WebSocket: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Tests may keep fixtures that look unused and use loose typing.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
