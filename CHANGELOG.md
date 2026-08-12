# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

- Restore `Ctrl/Cmd+V` paste in the diagram source field.
- Detect Mermaid or PlantUML from diagram source instead of asking for a language.

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
