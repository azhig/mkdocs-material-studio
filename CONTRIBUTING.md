# Contributing

Thanks for taking the time. This document covers the practical side; the
architecture and the rules that are easy to break are in
[DEVELOPMENT.md](DEVELOPMENT.md) — please read it before a first change to the
editor.

## Getting started

```bash
npm install
npm run check     # types, lint, formatting, tests — everything CI will run
```

Press `F5` in VS Code to launch the Extension Development Host, and open
`samples/demo` in it.

For anything that lives in a webview there is a faster loop — the dev harnesses
run in an ordinary browser:

```bash
npm run harness   # http://localhost:8931
```

## Before opening a pull request

- `npm run check` passes.
- New behaviour is covered by a test. Pure logic is easy to test — that is why
  it is deliberately kept out of the vscode-dependent modules.
- If you touched the serializer (DOM → Markdown), verify the round trip:
  opening a document and closing it must not change the file. This is the main
  invariant of the project.
- New user-visible strings go through `t()` and are added to
  `assets/i18n/ru.json`. The other bundles may stay behind — a missing key falls
  back to English.
- The changelog entry is not mandatory in the PR; it is written at release time.

## Style

Prettier and ESLint decide the formatting — do not argue with them, run
`npm run format`.

Comments are worth writing where the code cannot explain itself: why this way
and not the obvious one, which trap is being avoided. There are many such places
in this project (`MutationObserver` and `takeRecords`, CSS specificity against
the styles VS Code injects, `execCommand` and block operations) — if you find a
new one, leave a comment for the next person.

Everything in the repository is in English: code, comments, log messages,
documentation.

## Reporting a bug

The most useful report contains a fragment of Markdown that reproduces it, the
VS Code version, and the extension log (**MkDocs: Show Log**). If the problem
is about how a page looks, a screenshot saves a round of questions.
