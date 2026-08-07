# Developing MkDocs Material Studio

Documentation for those who work on the extension itself. The user guide is in [README.md](README.md).

## Requirements and running

```bash
npm install
npm run build      # build the extension + webview bundles into dist/
npm run watch      # rebuild on changes
npm run compile    # type checking (tsc --noEmit)
npm run test:unit  # unit tests (vitest)
npm run package    # production build of the bundles
```

`make` wraps the same scripts — `make help` lists them all. It has no logic of
its own, and `test/unit/makefile.test.ts` checks that it never falls behind
`package.json`, which it had already done once.

`F5` launches the Extension Development Host. Open an MkDocs project in it — for example, `samples/demo` — and invoke the preview or the visual editor.

Building the VSIX:

```bash
npm run package
npx @vscode/vsce@latest package --no-dependencies
```

## Material assets

`assets/material-css/`, `assets/icons/` and the fonts are extracted from the
`mkdocs-material` wheel on PyPI by `scripts/fetch-material-assets.mjs`, and the
result **is committed** — some 14,000 files, most of them the icon set the
picker searches. A clone is therefore around 11 MB.

That is deliberate. Vendoring them means a build needs neither the network nor a
Python package index, and the CSS in the repository is the CSS a given commit
was checked against — an upstream release cannot change what an old tag builds.
The script is only run when the pinned version moves:

```bash
node scripts/fetch-material-assets.mjs 9.7.7   # the version is pinned in the script
```

## Dev harnesses: testing the webviews without VS Code

Both webviews can be run in a regular browser — this is the main way to check the UI, because restarting the Extension Development Host on every edit is slow.

```bash
node scripts/harness/server.mjs   # http://localhost:8931
```

- `/` — the **visual editor** harness: the document lives in memory, the protocol is the same (`render` / `sync` / `synced` / `rejected`). At the bottom are the current text of the “file” and the edit log: you can immediately see whether the diff is minimal.
- `/scripts/harness/preview.html` — the **preview** harness: it emulates `PreviewPanelManager` (`render`, `scrollTo`, `siteChrome`, `chromeState`, `extraCss`).

Useful entry points in the browser console:

```js
window.__harness.load("# Heading\n\ntext"); // load a document
window.__harness.getText(); // the current contents of the “file”
window.__harness.extraCss(".md-typeset h1{color:red}");
```

**The harnesses emulate the base styles that VS Code injects into every webview** (`body`, `a`, `code`, `kbd`, `blockquote` via the `--vscode-*` variables) and the theme variables in both the light and the dark variant. This is not decoration: without them the harness lies. That is how a defect was missed where a blockquote got a black slab from `--vscode-textBlockQuote-background` — Material does not set a background for blockquotes, and the VS Code rule survived all the way to the screen. **If Material does not set a property, VS Code will.**

The VS Code theme in the harness is switched with a class on `<body>`:

```js
document.body.classList.toggle("vscode-dark");
```

The same harness, driven by a headless Chrome, produces both the recording in
the README (`npm run demo`) and the Marketplace screenshots (`npm run shots`) —
so what a reader sees on the page is the bundle that ships, not a drawing of it.

## Structure

```
src/
  core/         ProjectService, YAML parsing and editing,
                siteChrome (header and navigation), extraCss
  preview/      PreviewPanelManager, FallbackRenderer, markdown-it + our own pymdownx plugins
  wizards/      component registry, insertion panel, reverse parsing of blocks
  tree/         navigation tree with drag-and-drop
  configEditor/ model and panel of the mkdocs.yml visual editor
  wysiwyg/      CustomTextEditorProvider of the visual editor
webviews/       browser bundles: preview / wizard / config / visual / harness
  shared/       code shared by several webviews (codeNav, pasteSanitize, siteChrome)
  visual/       the visual editor, one module per area — see below
assets/         Material CSS and icons, KaTeX fonts, codicons, our own styles
test/unit/      unit tests (vitest, happy-dom for DOM modules)
test/mocks/     the stand-in for the `vscode` module
test/integration/ smoke tests that run inside a real VS Code
scripts/        harnesses and downloading of Material assets
```

### Inside the visual editor

`main.ts` is the wiring, and only that: the message protocol, the render and its
patches, the block index, decoration, the keyboard, and the `init*` calls that
hand every other module what it needs. It exports nothing — it is a leaf of the
dependency graph, which is why its size costs the rest of the code nothing. Each of those modules declares a `Host` interface —
the list of what it borrows from the editor around it — so a module's boundary
is something to read rather than to guess.

| Module                   | What lives there                                        |
| ------------------------ | ------------------------------------------------------- |
| `editorCore.ts`          | the document, the batches sent to the file, the history |
| `htmlToMd.ts`            | DOM → Markdown serialization                            |
| `syncModel.ts`           | which lines a change turns into                         |
| `blockHandle.ts`         | the “⋮⋮” handle, dragging a block, the block menu       |
| `blockInserts.ts`        | the insert forms (table, call-out, tabs, grid, …)       |
| `blockOps.ts`            | lists, headings, quotes, tabs and cards as text         |
| `codeBlockEdit.ts`       | editing a fenced code block in place                    |
| `paragraphStyle.ts`      | the style and list drop-downs                           |
| `inlineTools.ts`         | the bubble menu and inline formatting                   |
| `keyBindings.ts`         | shortcuts: overrides, uniqueness, badges                |
| `settingsUi.ts`          | the editor's own settings popup                         |
| `mediaLinks.ts`          | links, images, formulas, pasting a picture              |
| `annotations.ts`         | annotation markers, their list, the read-only tip       |
| `annotationSubEditor.ts` | the editor over one note — `#doc` becomes a copy        |
| `tables.ts`              | the table menu and walking the cells                    |
| `viewState.ts`           | width, table of contents, what survives a reload        |
| `selectionOps.ts`        | the selection, the lines under it, the caret            |
| `componentMenu.ts`       | the component palette, pinned buttons, the “/” menu     |
| `tabsGrids.ts`           | content tabs and card grids, managed in place           |

## Key rules

**Block operations go through the source, text input goes through the DOM.** Structural changes (block type, moving, inserting a component) are performed by editing the lines of the file and come back as a ready-made render. Text input and inline formatting live in `contenteditable`. `execCommand` is not suitable for block operations: the browser puts a list inside a paragraph, and such a block cannot be serialized.

**Only the modified block goes into the file.** `serializeTopBlock` is called for blocks from `dirty`, and the edit is sent as a precise range. Untouched blocks stay byte for byte — “opened and closed” must produce an empty `git diff`. This is verified by round-trip tests and is the main invariant of the project.

**Unknown constructs are not rewritten.** A block that the serializer does not understand is marked as an “island” and is edited only as text. It is better to give up visual editing than to spoil someone else's markup.

**Programmatic DOM mutations must not look like user edits.** Any change made from code is performed inside `mutedRemote(...)`, which synchronously calls `observer.takeRecords()` when it finishes — otherwise `MutationObserver` will deliver the records after the flag has been cleared, and the document “writes itself” with an avalanche of false edits.

**The extension does not depend on Python at all.** Everything is drawn by the built-in JS renderer; running `mkdocs serve` is the user's own business, done in the terminal. Nothing may be tied to Python — neither a process, nor an environment lookup, nor a setting.

**Language.** Everything in the repository is English: code, comments, log messages, documentation **and test fixtures**. The one exception is `assets/i18n/` and `package.nls*.json`, where another language is the content rather than the medium. User-visible strings additionally go through `t()` — see below.

The fixtures are not a detail. A test whose sample document is in one language and whose name is in another can only be half read, and a contributor who cannot read the fixture cannot tell a deliberate edge case from a typo. When a test needs non-Latin text on purpose — percent-encoded ids, slugs, file names — use Greek, Chinese, or Latin with diacritics; `imageNames.test.ts` does exactly that. `test/unit/repoLanguage.test.ts` enforces this for Cyrillic, which is the direction this project actually drifted in.

## Localization

The interface is translated into 8 languages (en, ru, de, es, fr, pt-br, zh-cn, ja). There are two separate mechanisms, and that is not an accident:

1. **The manifest** (command titles, setting descriptions) uses the standard NLS: `package.json` holds `%keys%`, the values live in `package.nls.json` (English) and `package.nls.<lang>.json`. VS Code picks the file by **its own** display language — the extension setting cannot influence it, that is a platform limitation.
2. **Everything else** (extension messages, webview interface) goes through our own module: `src/core/i18n.ts` on the host, `webviews/shared/i18n.ts` in webviews, bundles in `assets/i18n/<lang>.json`. Here the language comes from the `mkdocsStudio.language` setting (`auto` → `vscode.env.language`).

**The key is the English string itself**, not an identifier: the source stays readable without a dictionary, and a missing translation degrades to English rather than to `key.not.found`. English is therefore not stored as a file at all — `t()` returns the key.

**Where to import `t` from.** Modules that unit tests import must take it from the pure `src/core/i18nCore.ts`: `src/core/i18n.ts` imports `vscode`, and pulling that into a tested module breaks vitest with `Failed to load url vscode`. The same split as `mkdocsConfig`/`mkdocsConfigParse`.

**The bundle reaches a webview through the page shell** (`window.__i18n = {lang, strings}`), not through a message: the toolbar is part of the shell HTML, and a message would arrive after the first paint — the buttons would flash in English. For the same reason **changing the language rebuilds `panel.webview.html`** rather than posting an update.

**On the host, never call `t()` at module level.** The bundle is installed by `loadTranslations()` during activation, and module bodies run before that — imports are evaluated first. A `t()` in a constant, a lookup table or a default argument therefore reads an empty bundle and returns its English key, silently: nothing fails and nothing is logged, the string is simply never translated.

This is not hypothetical. Every label of the `mkdocs.yml` editor — field names, feature, plugin and extension toggles, palette schemes — lived in module-level tables, so the panel came out English while the frame around it was translated. The catalogues in `configEditor/configModel.ts` now hold plain English text (which is the key), and `t()` is applied in `buildConfigModel()` and `generalFields()`. That also means a language change redraws the panel without a reload, which the eager version could never do.

`test/unit/i18nTiming.test.ts` walks the AST of everything under `src/` and fails on any `t()` that would run at import time, naming the file and the line. Webviews are exempt and are not scanned: their bundle is in the page shell before the script tag, so a module body there already has the strings.

Adding a language: add the tag to `SUPPORTED_LANGUAGES` in `i18nCore.ts` and to the `enum` of `mkdocsStudio.language` in `package.json`, then add `assets/i18n/<lang>.json` and `package.nls.<lang>.json`.

## Tests

```bash
npm run test:unit           # the whole suite
npx vitest run test/unit/siteNav.test.ts
npm run test:coverage       # the same, with a coverage report in coverage/
npm run test:integration    # smoke tests inside a real VS Code
```

Pure logic is tested: Markdown rendering and round-trip, DOM → Markdown serialization, config parsing, navigation, keyboard shortcuts, paste sanitizing. Modules that use the DOM run in `happy-dom` (`// @vitest-environment happy-dom` at the top of the file).

Hence the rule: **logic that needs to be tested is extracted out of vscode-dependent modules**. The pairs `mkdocsConfig.ts` / `mkdocsConfigParse.ts`, `siteChrome.ts` / `siteNavBuild.ts`, `extraCss.ts` / `cssUrls.ts`, `visualEditorProvider.ts` / `editPlan.ts` are arranged the same way — file operations and the editor API in one module, pure rules in the other.

What is left behind — the classes that talk to the editor — is driven through a stand-in for the `vscode` module in `test/mocks/`, aliased by `vitest.config.mts`. It is not a convenience: a `WorkspaceEdit` applies every operation against the original text, `fs.stat` throws for a file that is not there, and `applyEdit` can report the change event before or after it returns (`__recorded.changeEvent`), because VS Code promises neither order. `test/mocks/host.ts` adds a webview panel that records what was posted and lets a test post back. Add to the stand-in rather than guess at it: a mock that is merely convenient proves nothing.

What the stand-in can never answer is whether the manifest and the code still
describe the same extension. `test/integration/` is run by `@vscode/test-cli`
inside a real VS Code opened on `samples/demo`, and it checks wiring rather than
behaviour: that the `workspaceContains` event fires and `dist/extension.js`
loads, that every command `package.json` declares is actually registered, and
that the visual editor, the preview, the settings panel and the component picker
each open. It is deliberately outside `npm run check` — it downloads a copy of
VS Code and takes tens of seconds — and runs as its own CI job under `xvfb-run`.
The bundles come from `node esbuild.mjs --tests`, which the packaged build never
passes.

Four tsconfig projects are checked, `test/` among them — vitest only transpiles,
so without it a test could assert against a field that no longer exists and
still pass. The tests are split across two of them on purpose:
`tsconfig.test.json` maps `vscode` to the stand-in, `tsconfig.integration.json`
leaves it as the real `@types/vscode`.

`nestingMatrix.test.ts` stands apart — a generated nesting matrix (720 combinations of containers and blocks up to 4 levels deep) with round-trip verification. It caught four defects that also reproduced at the top level.

### Coverage, and what it is honest about

`npm run test:coverage` measures everything that ships — `src/` and
`webviews/`, a file no test imports included, so it shows as 0% instead of
being absent from the report. The thresholds in `vitest.config.mts` are a
**floor** a pull request must not sink below, not a target; raise them when the
number moves up for real.

The uncovered part is not spread evenly, and that is the useful thing to know
about it: what remains is the four webview entry points (`main.ts` of visual,
preview, wizard, config) and the dialogs around them — code that exists to wire
a browser to a panel and cannot say anything true without one. The rules those
files apply have been moved out into modules that a test can drive, and those
are covered. **The number to watch is not the total but whether a new rule went
into a `main.ts` instead of into a module beside it.**

Everything that writes to the author's file is on the covered side, and that was
the ordering principle: the batches and history (`editorCore`), the component
templates (`blockInserts`), the fence and its info string (`codeBlockEdit`,
`codeFence`), image paths and links (`mediaLinks`), the annotation markers and
their list (`annotations`), tables, and the paths on the host. A dialog that
only draws is worth less to cover than a line of Markdown that reaches a
document somebody else wrote.

A test that passes proves nothing until it has been seen to fail. Every module
covered here was checked by breaking it on purpose — one behaviour at a time,
run, restore — and three tests that passed against broken source were rewritten
because of it. Do the same for a new test before trusting it.

Two things to know before writing one for a DOM module:

- **A module that keeps state in module-level variables needs a fresh import per
  test** — `vi.resetModules()` and `await import(...)` in `beforeEach`. There is
  one editor per webview, so those modules are entitled to their globals; the
  test is what has to adapt.
- **Set up the document through `mutedRemote`, the way a render does.** Assigning
  `innerHTML` directly is not equivalent: happy-dom fills an element that is
  already attached, so the mutation arrives with its target _inside_ a block and
  the core rightly calls that an edit. A browser builds the fragment first, and
  the difference will cost an hour to find.

## Verifying changes

The order worth following before considering the work finished:

1. `npm run compile` — types.
2. `npm run test:unit` — unit tests.
3. The harness in the browser — if a webview was changed: check it in the light and the dark theme, look at the edit log (the diff must stay minimal).
4. `npm run test:integration` — if the manifest, a command or a panel was touched.
5. `F5` — if a part that the harness does not cover was changed: file operations, commands, the tree.

CI does the same on every push, plus the one thing a Mac or a Linux box cannot
answer for itself: the unit suite also runs on **Windows and macOS**. Almost
everything this extension does is paths — `docs_dir`, `--8<--` includes,
`url(...)` in `extra_css`, links between pages — and a path is exactly where
Windows differs. Lint and formatting say the same thing everywhere, so they run
once, on Linux.

## Dependencies

The extension ships what it bundles, so an advisory against a runtime dependency
is an advisory against the extension. Plain `npm audit` — dev tooling included —
comes back clean, and should stay that way: the build and the test runners are
what execute on every push.

Three entries in `overrides` are there because a direct dependency pins a
transitive one below its fix. Each should go once the package above it moves
past the advisory on its own:

| Override               | Pinned by | Why                                                                  |
| ---------------------- | --------- | -------------------------------------------------------------------- |
| `dompurify`            | mermaid   | GHSA-55q2-fjhq-7xh7 — and mermaid renders whatever the document says |
| `serialize-javascript` | mocha     | RCE via `RegExp.flags`, plus a CPU-exhaustion DoS                    |
| `diff`                 | mocha     | DoS in `parsePatch` / `applyPatch`                                   |

npm's own `audit fix` suggests _downgrading_ mocha for the last two; it has no
newer mocha to offer, and the override is the honest way out.

## Limitations worth knowing about

- External `https://` links in `extra_css` are not loaded: the webview security policy forbids them. `theme.font` and `extra_javascript` are deliberately not applied.
- Page titles for navigation are read from no more than 500 files; the registry without `mkdocs.yml` is limited to 2000 pages.
- The `::: identifier` (mkdocstrings) block is shown as a placeholder card: its contents are assembled by a Python plugin, and there is no built-in equivalent.
