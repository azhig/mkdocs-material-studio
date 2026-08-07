# MkDocs Material Studio

[![CI](https://github.com/azhig/mkdocs-material-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/azhig/mkdocs-material-studio/actions/workflows/ci.yml)
[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/azhig.mkdocs-material-studio?label=marketplace)](https://marketplace.visualstudio.com/items?itemName=azhig.mkdocs-material-studio)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A VS Code extension for working with **MkDocs Material** documentation: a preview that looks like the published site, visual page editing, site navigation and a visual editor for `mkdocs.yml` — all right inside the editor. **Python is not required**: the page is rendered by a built-in engine.

![The visual editor on the sample site: typing in the rendered page, inserting components, an annotation and a diagram, switching a tab of the site and the dark theme](assets/demo.gif)

> Built from scratch, without third-party extension code. Material styles and icons are taken from the official `mkdocs-material` package (MIT license, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Installation

Search for **MkDocs Material Studio** in the Extensions view (`Cmd/Ctrl+Shift+X`), or run this in the command palette:

```
ext install azhig.mkdocs-material-studio
```

Every release also attaches a `.vsix` to the [releases page](https://github.com/azhig/mkdocs-material-studio/releases) — install it with `code --install-extension <file>.vsix`.

After installing, run **Developer: Reload Window** — otherwise VS Code will not pick up the extension settings.

## Quick start

1. Open the folder with your documentation. A project is detected by `mkdocs.yml` (or `mkdocs.yaml`) — the file may also live in a nested directory. The extension works without it too: see [Regular project without MkDocs](#regular-project-without-mkdocs).
2. Open any `.md` file and click the **book icon** in the top-right corner of the editor — the preview opens as a full tab. Hold `Alt` while clicking to put it side by side with the text instead.
3. To edit the page visually, open the command palette (`Cmd/Ctrl+Shift+P`) → **MkDocs: Open in Visual Editor**.

## Preview

It is opened with the **MkDocs: Open Preview** command and follows the active Markdown file. The preview takes a full tab, like the visual editor; **MkDocs: Open Preview to the Side** (or `Alt` + the toolbar button) keeps the classic split view — text on one side, the rendered page on the other.

The page is drawn by a built-in engine with real Material styles, without Python. The whole [Material reference](https://squidfunk.github.io/mkdocs-material/reference/) is supported: admonitions, content tabs, code blocks with highlighting and line numbers, tables, Mermaid diagrams, formulas, footnotes, annotations, card grids, icons and emoji, task lists and definition lists. It updates as you type.

> The extension does not run `mkdocs serve` and does not manage a server. To see the built site — with search, plugins and `mkdocstrings` — run `mkdocs serve` in the terminal and open it in a browser: that is the browser's job, not the editor's.

What else the preview can do:

- **Double-clicking an admonition or a code block** opens a form with its parameters; saving changes only that block. A single click is left to reading: selecting text, following a link.
- **Links lead where they do on the site**: a click on `setup.md`, `setup/` or `../api` opens that page in the preview itself, a `#section` scrolls to the heading, an image or a PDF opens in VS Code, and an external address in the browser. In the visual editor the same happens on `Cmd/Ctrl+click` — a plain click there belongs to the caret.
- **A copy button** on every code block — just like on the Material site.
- **The “Contents” button** opens the “On this page” panel on the right: the headings of the current page, with the section you are reading highlighted as you scroll.
- **Scrolling is synchronized** with the editor in both directions.
- **Styling is taken from your `mkdocs.yml`**: the brand colors of `theme.palette` and the custom styles of `extra_css` together with their images and fonts. Save `extra.css` and the look updates — there is no need to reopen the tab.
- **The light or dark scheme follows the VS Code theme**, not `theme.palette.scheme`: a dark editor next to a light page is blinding. A theme change is applied immediately.

## Site header and page list

Two buttons — **“Header”** and **“Navigation”** (in the visual editor these are icons on the toolbar):

- **Header** shows the top bar of the site: the logo, the name, section tabs (when `navigation.tabs` is enabled) and the repository link.
- **Navigation** opens the list of pages from `nav` in `mkdocs.yml` on the left. If `nav` is not set, the list is built from the files in `docs/` — the way MkDocs itself does it.

Clicking a page opens it right in the preview — you keep reading instead of jumping into the source; to edit, click the block you want. In the visual editor a click opens the page for editing. Sections collapse, and the current page is highlighted. The buttons are shared between the preview and the visual editor, and their state is remembered.

### Regular project without MkDocs

If there is no `mkdocs.yml`, the “Navigation” button shows a **Markdown registry**: every `.md` file in the workspace folder, excluding `node_modules`, `dist`, `site`, `vendor` and other service directories. Titles are taken from the first `H1` heading, and the order comes from the directory's table of contents: `SUMMARY.md`, otherwise `README.md`/`index.md`. The table-of-contents file comes first, followed by the pages in the order they are mentioned in it, and the rest in alphabetical order. Not a single file is lost, even if nothing links to it.

## Visual editor

**MkDocs: Open in Visual Editor** — editing directly in the rendered page. The regular text editor is not replaced: the visual one opens only when you ask for it.

![The visual editor: a call-out, content tabs with a highlighted Python block, an annotation, a Mermaid diagram and a table — all editable in place, with the site header and the page list around them](docs/images/visual-editor.png)

**Text and formatting**

- Click anywhere and start typing — edits are saved to the file automatically, and the status is visible on the toolbar.
- Formatting toolbar: paragraph styles and headings, **bold**, _italic_, underline, strikethrough, `inline code`, ==highlight with a color choice==, links, clear formatting, lists (bulleted, numbered, task).
- **Pasting from a browser or an office editor is sanitized**: headings, lists, tables and code survive, while foreign colors, fonts and service glyphs do not.
- **Undo and redo** (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`) work both for text and for block operations.

Every block has a handle to its left: it opens the actions of the block and of every container around it, and dragging it moves the block among its own neighbours.

![The block menu of a call-out: its type as a palette of the eleven Material kinds, collapsed and expanded, and the actions of the block itself under an expander](docs/images/block-menu.png)

**Blocks**

- The **“+ Insert”** button opens the palette of Material components with icons: admonitions, content tabs, code blocks, card grids, diagrams, buttons, annotations, footnotes, tooltips, formulas, icons and emoji, keyboard keys and file includes. The most frequent ones are placed on the toolbar as separate buttons — the set is configured with the gear button.
- A component is inserted **at the level of the cursor**: if you are inside an admonition, the block is nested into it; inside a content tab, into that tab.
- To the left of the active block a **“⋮⋮”** handle appears — a menu with every action: admonition type and collapsibility, list type, code block parameters, moving, copying, “Markdown source” and deletion.
- **Dragging by the handle** changes the order of blocks; a line shows the insertion point, and `Esc` cancels.
- **A code block is edited in place** — with live highlighting, line numbers and line highlighting; the language and the title are set in the handle menu.
- **Tables**: `Tab`/`Shift+Tab` move between cells, `Enter` moves down; a floating menu adds rows and columns and changes alignment.
- **Everything inline is edited by clicking it**: a formula, an image, an icon, a key combination, a footnote marker, an abbreviation, a link, a button — a click opens the form of that element, with a “Delete” button where removing makes sense.
- **Formulas**: a LaTeX field with a live preview and the parser's message; a switch inserts the formula inline or as a separate block.
- **Images**: the path (with a “Choose file…” dialog), the description, the width and the alignment — the `{ align=left width="300" }` attributes of the reference; a thumbnail shows what you picked.
- **Links**: the address field suggests the headings of the current page and the pages of the project, as a path relative to the page you are editing.
- **Footnotes**: “Footnotes” asks for the text and drops an auto-numbered marker at the cursor; clicking a marker (or an item of the rendered list) opens the definition for editing, and “Delete” removes the markers together with the definition.
- **Tooltips**: pick a text and fill the tooltip — with a link it becomes a link tooltip, without one an abbreviation whose every occurrence gets the tooltip. Clicking an underlined abbreviation edits or deletes its definition.
- **Diagrams**: “Diagrams” and double-clicking a Mermaid block open a dialog with templates (flowchart, sequence, classes, states, entities, Gantt, pie), a live preview and the parser's error message.
- **Double-clicking** a formula or a `::: identifier` block opens the source editor in place.

**View**

Buttons on the right side of the toolbar: page width (a column or full width), the “On this page” table of contents with the current section highlighted, light/dark theme, the site header, the page list. Your choice is remembered.

> **Your file is safe.** Only the modified block is written to the file — everything else stays byte for byte as it was, so “opened and closed” does not create changes in git. Raw HTML, inline footnotes (`^[…]`) and `::: identifier` auto-documentation blocks are marked “as text only” and are not distorted by visual editing.

## Project tree

The **MkDocs** panel in the explorer shows the site navigation and a “not in navigation” section — the files in `docs/` that are not included in `nav`.

Creating pages and sections, renaming, deleting and drag-and-drop are available. All changes are applied to `mkdocs.yml` surgically: comments and formatting are preserved.

## MkDocs settings without editing YAML

Tabs _General / Theme / Features / Plugins / Extensions_: fields, swatches of the real palette colors, toggles for theme features, plugins and Markdown extensions. Every change modifies a single line in `mkdocs.yml`; the rest of the file is left untouched.

Three ways in, whichever is nearer to hand:

- **The gear in the site header** of the visual editor — the name, the tabs and the repository link in that strip all come out of `mkdocs.yml`, so the button to change them is right there.
- **The gear on the preview's toolbar**, next to the header and navigation buttons.
- **The gear on the MkDocs tree panel**, or the command palette: **MkDocs: MkDocs Settings (Visual Editor)**.

In a monorepo the one that opens is the config the current page belongs to — the nearest `mkdocs.yml` up the tree, not the first one in the workspace.

## Inserting components in the text editor

**MkDocs: Insert Material Component** — the same component palette, but for the regular Markdown editor: you fill in a form and the ready-made markup is inserted at the cursor position. For icons, a search over 14,000+ Material, FontAwesome, Simple Icons and Octicons glyphs is available.

## Commands

| Command                                 | What it does                                               |
| --------------------------------------- | ---------------------------------------------------------- |
| MkDocs: Open Preview                    | The preview panel for the current file                     |
| MkDocs: Open in Visual Editor           | Editing the page in the visual editor                      |
| MkDocs: Open as Text (Markdown)         | Back to the regular editor                                 |
| MkDocs: Insert Material Component       | The component palette for the text editor                  |
| MkDocs: MkDocs Settings (Visual Editor) | The `mkdocs.yml` editor                                    |
| MkDocs: Show Log                        | The extension log — start here if something is not working |

## Visual editor keyboard shortcuts

| Action                             | Shortcut                                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bold / italic / underline          | `Cmd/Ctrl+B` · `+I` · `+U`                                                                                                                                                                                        |
| Strikethrough / inline code        | `Cmd/Ctrl+Shift+S` · `+Shift+M`                                                                                                                                                                                   |
| Link / clear formatting            | `Cmd/Ctrl+K` · `+Shift+\`                                                                                                                                                                                         |
| Undo / redo                        | `Cmd/Ctrl+Z` · `Shift+Cmd/Ctrl+Z`                                                                                                                                                                                 |
| Insert component                   | `Cmd/Ctrl+Alt+` letter: `T` table, `P` image, `C` code, `A` admonition, `Shift+T` content tabs, `G` grid, `M` diagram, `E` icons, `B` button, `N` annotation, `F` footnote, `K` tooltip, `Q` formula, `D` divider |
| Quick insert in an empty paragraph | `/`                                                                                                                                                                                                               |

Any shortcut can be reassigned: the gear on the toolbar → **Keyboard shortcuts**.

## Dark theme

The page follows the VS Code theme, and the toolbar button overrides it until you switch back. The colours of both schemes come from `theme.palette` in your `mkdocs.yml`.

![The same page in the dark scheme: Material's slate palette with the project's own primary and accent colours](docs/images/dark-theme.png)

## Interface language

English by default. The `mkdocsStudio.language` setting switches the interface to **English, Deutsch, Español, Français, Português (Brasil), 简体中文** or **日本語**; `auto` follows the display language of VS Code. The change applies immediately — no window reload is needed.

One caveat: command names in the command palette and setting descriptions in the settings UI are translated by VS Code itself, so they follow **its** display language rather than this setting. Everything inside the panels — toolbars, menus, messages — follows `mkdocsStudio.language`.

## Settings

| Setting                           | Purpose                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `mkdocsStudio.language`           | Interface language: `auto` (follows VS Code) or one of the 8 supported languages           |
| `mkdocsStudio.followActiveEditor` | The preview follows the active editor                                                      |
| `mkdocsStudio.scrollSync`         | Scroll synchronization with the text editor                                                |
| `mkdocsStudio.showSiteHeader`     | Show the site header                                                                       |
| `mkdocsStudio.showSiteNav`        | Show the page list on the left                                                             |
| `mkdocsStudio.palette.*`          | Primary/accent colours of the light and dark schemes; `theme.palette` in `mkdocs.yml` wins |
| `mkdocsStudio.pageBackground`     | Page background: `material` (as on the site) or `editor` (the VS Code theme)               |
| `mkdocsStudio.imagePasteFolder`   | Where to save images pasted from the clipboard (`assets` by default)                       |
| `mkdocsStudio.inlineFormatting`   | Where to show formatting: `selection` / `toolbar` / `both`                                 |
| `mkdocsStudio.toolbarButtons`     | The components pinned as buttons on the toolbar                                            |
| `mkdocsStudio.keybindings`        | Keyboard shortcut overrides                                                                |

## If something does not work

**A page of `mkdocstrings` (`::: identifier`) shows a card instead of the reference.** The content of such a block is assembled by a Python plugin when the site is built — the built-in engine does not have it. Run `mkdocs serve` in the terminal and read that page in a browser.

**Project colors and styles are not visible.** Check where `mkdocs.yml` is located: it is searched for across the whole workspace, but the `node_modules`, `site`, `dist`, `build`, `vendor` and `.venv` directories are excluded from the search. In a monorepo, the nearest config up the tree is used for a page.

**Toolbar buttons do not respond, or settings are not saved.** Run **Developer: Reload Window** after updating the extension.

**Nothing happens in a restricted window.** The extension reads the project's `mkdocs.yml`, the files its pages include and its stylesheets, so it asks for a workspace you trust. Use **Workspaces: Manage Workspace Trust** to grant it. For the same reason a link in a page opens externally only when it is `http`, `https` or `mailto`, and an include (`--8<--`) is read only from inside the project.

**Something was rendered incorrectly.** Open **MkDocs: Show Log** — it shows which config was read and what failed to load.

## Contributing

Bug reports and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it explains how to run the project and what to check before a pull request; the architecture and the traps worth knowing are in [DEVELOPMENT.md](DEVELOPMENT.md).

Found a security problem? Please report it privately — see [SECURITY.md](SECURITY.md). Interaction in the repository follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](LICENSE). Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Material styles and icons come from the [mkdocs-material](https://github.com/squidfunk/mkdocs-material) package (MIT). This extension is not affiliated with the MkDocs or MkDocs Material projects.
