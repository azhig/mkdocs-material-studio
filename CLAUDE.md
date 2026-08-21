# Working in this repository

MkDocs Material Studio is a VS Code extension for MkDocs Material documentation:
a preview that matches the published site, a visual editor that edits the
rendered page, a project tree and a form-based editor for `mkdocs.yml`. The page
is rendered by a built-in Markdown engine — **Python is never required and must
not become required**.

Architecture, the reasoning behind it and the traps worth knowing are in
[DEVELOPMENT.md](DEVELOPMENT.md). This file is the short version: what to run,
and the rules the test suite enforces.

## Before finishing anything

```
npm run check
```

Types (four tsconfig projects), ESLint, Prettier and the unit tests. It must be
green before a change is done — no exceptions, no “the rest is unrelated”.

| Command                    | When                                                      |
| -------------------------- | --------------------------------------------------------- |
| `npm run test:unit`        | The fast loop while working                               |
| `npm run test:integration` | Smoke tests in a real VS Code — slow, not part of `check` |
| `npm run harness`          | The webview stand on port 8931, for anything visual       |
| `npm run vsix`             | Package; also catches manifest and `.vscodeignore` faults |

`make help` lists the same targets; a test keeps the Makefile and the npm
scripts in step.

## Rules the suite enforces

Each of these exists because the project actually broke that way. Breaking one
is a failing test with a message that names the file and the line.

- **English everywhere** except `assets/i18n/` and `package.nls*.json`. A
  fixture that needs non-Latin text uses Greek, Chinese or Latin with
  diacritics. (`repoLanguage.test.ts` — it reads untracked files too, so a new
  file is checked before it is committed.)
- **No `t()` at module level on the extension host.** Module bodies run at
  import, the bundle is installed during activation, so such a string is
  silently never translated. This shipped three times. The check follows calls:
  a builder that translates, invoked at module level, counts.
  (`i18nTiming.test.ts`)
- **No `secrets` in a workflow's `if`.** GitHub rejects the whole file and every
  push fails with no log. Put the secret in the job's `env` and test `env.NAME`.
  (`workflows.test.ts`)
- **The README's command and settings tables match `package.json`.**
  (`readme.test.ts`)

## Writing code here

- Comments say **why**, not what. A comment that restates the line below it is
  noise; a comment that records the reason a line is unusual is the point.
- Logic goes into a **pure module** with no `vscode` and no DOM, and the shell
  around it stays thin. That is what makes the interesting parts testable —
  `editPlan.ts`, `syncModel.ts`, `keysNotation.ts`, `docLinks.ts`.
- A webview module takes an explicit `Host` interface and an `initX(host)`.
- Paths in tests: build expected values with `path.resolve`, never as literal
  POSIX strings — CI runs on Windows.
- Never wait a fixed number of milliseconds in a test. Wait for a condition;
  assert an invariant by checking it repeatedly, not once.

## Writing tests here

A new test is not finished until it has been **mutation-checked**: break the
code it covers, confirm the test fails, restore. Several tests in this
repository looked fine and proved nothing until that step was taken.

Prefer a test that reads like a sentence about behaviour over one that mirrors
the implementation.

## The visual editor

The riskiest part of the codebase: it writes to the user's file. Only the
modified block is written, so opening and closing a document must not produce a
diff. The sync path (`editPlan.ts`, `syncEdits.ts`, `visualEditorProvider.ts`)
is covered — keep it that way.

happy-dom is not a browser: `getBoundingClientRect` and `offsetHeight` return 0,
`document.execCommand` is undefined, and there is no `caretRangeFromPoint`.
Anything that depends on layout or on the caret is verified in the harness, not
in a unit test.
