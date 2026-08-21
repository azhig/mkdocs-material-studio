# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.3.0 — 2026-08-21

### The page is written to the file when you save it

The visual editor used to write every keystroke into the document, a few times a
second. With auto-save on, each of those writes was a save, and each save ran
whatever formatters the project has — whose edits came back as somebody else's
and redrew the page under the caret. Two releases went into keeping the caret
alive through that; this one removes the cause.

- **Typing changes the page, not the file.** The editor keeps the page you are
  working on and writes it to the file on `Cmd/Ctrl+S`, or with the new save
  button on the toolbar. The status line says _Unsaved changes_ until it lands,
  and the whole edit goes in as a single undo step.
- **Unsaved work outlives the tab.** Close the editor with something unwritten
  and it comes back when the page is opened again — unless the file itself has
  moved on since, which is a decision to make rather than one to make silently.
- **An edit from outside is adopted when there is nothing to lose** — the page
  picks it up block by block, with the caret untouched. When there IS unsaved
  work, nothing is redrawn: a bar offers to load the file or to keep your
  version, which the next save then writes over it.
- The component wizard, the block edit form and “Open as text” save the page
  first: they work on the file, and they should see the page you are looking at.

## 0.2.2 — 2026-08-21

### Typing while something else edits the file

- **An edit from outside no longer redraws the page.** 0.2.1 kept the caret
  through that redraw, but the redraw itself was the problem: the markup that
  arrives is the file as it stands on disk, so the words typed a moment ago —
  still on their way there — were wiped, and the caret was placed into text that
  no longer matched what the author had in front of them. The page is now
  patched block by block: the block the caret is in keeps its DOM, its text and
  its caret, and the rest of the page picks up the change.
- The caret is anchored only across a redraw caused from outside. When the
  editor asks for one itself — a Return opening a paragraph, a block being
  inserted — the caret belongs where that edit put it, and an anchor from before
  the edit dragged it back to the line it had left.

## 0.2.1 — 2026-08-21

### The caret while typing

- **The caret no longer jumps to the top of the page.** An edit the extension did
  not make — a file saved by a formatter, a change from another editor, or the
  document coming back unchanged — redrew every block of the page, and the browser
  answered that by leaving the selection at the start of the editor: the view
  jumped to the beginning and the next word was typed into the first paragraph of
  the file. The caret is now anchored to its line before the redraw and put back
  after it, with the page scrolled so that the line stays where the eye left it.
- A document that comes back identical is no longer redrawn at all — the page,
  the caret and anything typed but not yet written stay as they are.

## 0.2.0 — 2026-08-14

### Monorepo projects

- Follow `Title: '!include ./lib/mkdocs.yml'` (mkdocs-monorepo-plugin): the included
  config becomes a section whose pages come from its own `docs_dir`, its `site_name`
  is their URL prefix, and `extra_css` written as `lib/stylesheets/extra.css` is read
  from `lib/docs/stylesheets/`. Opening a page of a section shows the whole site
  around it. Entries that live in an included config are shown in the project tree
  but not edited from there — the panel says which config to open instead.

### Images

- The image form carries the Material attributes in full: width, **height** and
  alignment.
- **A light/dark image pair** (`![…](logo.png#only-dark)`, and the GitHub spelling)
  is displayed the way the site displays it — the copy for the other colour scheme
  is hidden in the preview and kept on the page, faded, in the visual editor, so
  both halves stay editable.
- A pasted or dropped picture appears at once. It used to land in the document
  invisible: the editor was given the path for the file, which a webview cannot
  load, and the empty frame outlived every edit until a full redraw.

### Colours

- Code is highlighted in Material's own palette in both schemes, and a project that
  recolours `--md-code-hl-*` in `extra_css` is now followed. The preview used to
  paint keywords red and numbers blue where the site had the opposite.
- With no `theme.palette` a project keeps Material's own colours instead of the
  cyan this extension used to impose — cyan links measured 2.3:1 on white.
- Links in the dark scheme are readable again (4.7:1 instead of 2.3:1).
- The site header picks a readable text colour when a custom stylesheet sets its
  background without setting the matching foreground.

### Diagrams and diagnostics

- **Mermaid is drawn in the colours of the site**, taken from the palette in
  `mkdocs.yml` — as Material itself draws it. The engine's own greys sat on the
  page as a patch of a different hue (a node at #1F2020 against slate's #1E2129),
  and the label of an edge carried a grey plate over the line it belonged to.
- **A PlantUML diagram follows the page scheme**: on a dark page it is drawn in
  dark mode instead of near-black ink on near-black background, and switching
  the theme redraws it. Its own palette is left alone — that is what the
  published site will draw — but the diagram now sits on the panel a code block
  sits on, instead of floating on the page in a tone of its own.
- **A PlantUML source with a mistake in it says so.** The engine reports one by
  drawing a picture about it — “PlantUML version …, Syntax Error?” — which was
  displayed as if it were the diagram the author wrote. It is now shown as an
  error: the source stays readable and the parser's words are on the block.
- A PlantUML diagram is drawn once and kept: a keystroke in the document used to
  redraw every diagram on the page from scratch.
- A diagram the engine refuses no longer looks like an ordinary code block — the
  block is marked and the engine's own message is in its tooltip.
- A runtime that fails to start now says so instead of leaving every diagram on
  the page waiting for it forever, and a lost script is retried rather than
  remembered as a failure for the lifetime of the panel.
- The diagram component offers each renderer only the diagrams it draws, and
  every type inserts its own: “Gantt” in PlantUML used to insert a sequence
  diagram, and “Pie” a diagram PlantUML cannot draw at all.
- ` ```puml ` and a fence with a title survive a round trip through the visual
  editor — the language was rewritten to the canonical name and the title dropped.
- Restore `Ctrl/Cmd+V` paste in the diagram source field.
- Detect Mermaid or PlantUML from diagram source instead of asking for a language.
- Say in the log why the icon pack did not open, instead of leaving shortcodes as text.

## 0.1.1 — 2026-08-12

- Add PlantUML fences, templates, local browser rendering, and editing through the existing diagram component.
- Use cyan as the default primary and accent colour for both light and dark schemes.

## 0.1.0 — first public release

MkDocs Material documentation inside VS Code: a preview that looks like the published
site, visual page editing, site navigation and a visual editor for `mkdocs.yml`.
**Python is not required** — pages are drawn by a built-in engine.

### Preview

- **One mode, no Python.** The page is rendered by a built-in markdown-it engine with
  the real Material CSS and updates as you type. The extension neither starts
  `mkdocs serve` nor manages a server: to read the built site — with search, plugins
  and `mkdocstrings` — run it in the terminal and open a browser.
- **The full [Material reference](https://squidfunk.github.io/mkdocs-material/reference/)**:
  admonitions, content tabs, code blocks with highlighting, line numbers and a copy
  button, data tables, card grids, Mermaid diagrams, formulas, footnotes, annotations,
  tooltips and abbreviations, Critic Markup, icons and emoji, task and definition
  lists, `md_in_html` figures, file includes (`--8<--`).
- **Links work.** A link to a page (`setup.md`, `setup/`, `../api`, an address copied
  from the built site) opens that page in the preview itself, a `#section` scrolls to
  the heading, other files go to VS Code and external addresses to the browser. In the
  visual editor the same happens on `Cmd/Ctrl+click`, and a page opens for editing.
- **“On this page”.** The **Contents** panel lists the headings of the page, jumps to
  one on click and highlights the section being read while you scroll.
- **Scroll synchronization** with the text editor in both directions.
- **Double-click an admonition or a code block** to open a form with its parameters;
  saving changes only that block. A single click belongs to reading — selecting
  text, following a link — so nothing opens under it.
- **Opens as a full tab**, like the visual editor. **MkDocs: Open Preview to the Side**
  (or `Alt` with the toolbar button) keeps the classic split view.

### Visual editor

- **Type directly in the rendered page.** Only the block you touched is written back
  to the file — untouched content is never re-serialized, so a hand-written document
  keeps its own style: list markers (`*`, `+`, `1)`), tilde fences, setext headings,
  the table alignment row.
- **Formatting**: paragraph styles and headings 1–6, bold, italic, underline
  (`^^text^^`), strikethrough, inline code, a colour highlight palette, links, quote,
  bulleted, numbered and task lists, clear formatting. The buttons live on the
  toolbar, in a bubble menu on the selection, or both — your choice.
- **The “+ Insert” palette** offers every Material component with its own icon, and
  each one opens a real form: the admonition type and collapsibility, the code
  language and title, the tabs of a content-tab set, the cards of a grid, the size
  grid of a table, a LaTeX field with a live KaTeX preview, a Mermaid dialog with a
  live diagram and templates, an image form with a file dialog and a thumbnail, a
  link field that suggests the pages of the project, an icon picker over 14,000
  glyphs, keyboard keys recorded from an actual key press.
- **Components are inserted at the level of the cursor** — inside an admonition they
  nest into it, inside a content tab into that tab, to any depth. The nesting matrix
  is verified by a generated test: 720 combinations of 8 containers and 18 nested
  elements at depths 2–4, each with a byte-for-byte round-trip.
- **Everything inline is edited by clicking it**: a formula, an image, an icon, a key
  combination, a footnote marker, an abbreviation, a link, a button — each opens its
  own form, with a “Delete” action where removing makes sense.
- **Blocks as objects.** The **“⋮⋮”** handle next to the active block opens one menu
  with everything: the type of the block and of every container around it, move,
  copy, cut, paste after, “Markdown source” and delete. Dragging the handle reorders
  blocks while preserving the nesting level.
- **Structural editing rewrites the Markdown, not the HTML** — lists, styles,
  indentation, tabs, cards, moves and deletions all edit the lines of the file, and
  the page is redrawn by the engine.
- **Pasting is sanitized**: headings, lists, tables, code with a language, links and
  images survive; foreign colours, fonts and service markup do not. Images pasted
  from the clipboard or dropped in are saved next to the document and inserted as a
  relative link.
- **Keyboard shortcuts** for formatting and for every insertable component, in the
  platform's notation, detected by physical key code (a Cyrillic layout works). Every
  one of them can be reassigned in the editor's settings.

### Site header and navigation

- **Header** reproduces the top bar of a Material site: the logo, `site_name` in the
  project colours, section tabs (`navigation.tabs`) and the repository button.
- **Navigation** shows the page tree from `nav` in `mkdocs.yml`, or — when `nav` is
  not set — a walk over `docs/` following the MkDocs rules. Sections collapse, the
  open page is highlighted, and adding a page or editing the config is picked up on
  the fly.
- **Without `mkdocs.yml`** the panel shows a **Markdown registry**: every `.md` file
  of the workspace folder, titled by its first `H1` and ordered by the directory's
  table of contents (`SUMMARY.md`, otherwise `README.md`/`index.md`). A page nothing
  links to is still listed.
- `mkdocs.yml` is searched for across the whole workspace, and the nearest config up
  the tree is chosen for a file — in a monorepo every page gets its own site.

### Appearance

- **The light/dark scheme follows the VS Code theme** — a dark editor next to a light
  page is blinding. A **theme button** in the preview and in the visual editor
  switches manually; the choice is remembered. Dark mode uses Material's **slate**
  palette, and Mermaid diagrams are redrawn for the new scheme.
- **The colours come from your `mkdocs.yml`**: `theme.palette` for both schemes, plus
  the `mkdocsStudio.palette.*` settings for whatever the project leaves out.
- **The background is yours to pick** (`mkdocsStudio.pageBackground`): the colour of
  the Material scheme, as on the published site, or the one of the VS Code theme —
  the page then blends into the editor instead of sitting in it as a separate window.
- **`extra_css` is applied in both modes**, together with the images and fonts its
  relative `url(...)` references point at. Save the file and the look updates —
  no need to reopen the tab.

### Project

- **A project tree** from `mkdocs.yml`: create, rename, delete and drag pages with
  surgical edits to `nav` — YAML comments are preserved.
- **A visual editor for `mkdocs.yml`**: General, Theme, Features, Plugins and
  Extensions, with Material colour swatches and toggles, writing back as targeted
  YAML patches. It opens from the gear in the site header of the visual editor,
  from the preview's toolbar, from the tree panel or from the command palette —
  and in a monorepo it opens the config the current page belongs to.

### What the extension will not do with a page

A page is text somebody else wrote — a documentation repository takes changes from
strangers — so a few things are deliberately refused:

- **A link leaves the editor only over `http`, `https` or `mailto`.** `file:` would
  start whatever application owns the file and `vscode:` would reach another
  extension's URI handler; neither is worth a click on a link in a page.
- **An include (`--8<--`) reads only inside the project.** A path that climbs out of
  the document's folder, `docs_dir` and the project root is not read at all — the
  same rule `pymdownx.snippets` applies to its own includes.
- **A trusted workspace is required.** The extension reads the project's
  configuration, its includes and its stylesheets; that is not something to do in a
  folder you have not vouched for. A virtual workspace is not supported either —
  page paths, includes and `extra_css` addresses are resolved as paths on disk.

### Languages

The interface speaks **English, English, Deutsch, Español, Français, Português
(Brasil), 简体中文** and **日本語**; `mkdocsStudio.language` chooses one, `auto` follows
VS Code. The change applies at once, without a window reload. Command names in the
command palette and setting descriptions in the settings UI are rendered by VS Code
itself, so those follow **its** display language.
