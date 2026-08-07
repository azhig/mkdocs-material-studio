# Third-party components

MkDocs Material Studio is distributed under the MIT license and includes the
following third-party components — both as bundled assets and as runtime
dependencies. Their copyright and licenses remain with their holders.

## Bundled assets (shipped in the VSIX)

### Material for MkDocs

- Used for: the theme's CSS (`assets/material-css/`) and SVG icons (`assets/icons/`), extracted from the PyPI distribution (wheel) of version 9.7.7.
- Copyright: © 2016–2025 Martin Donath `<martin.donath@squidfunk.com>`.
- License: MIT. Full text in `assets/material-css/LICENSE`.
- Project: https://github.com/squidfunk/mkdocs-material

### KaTeX (fonts and CSS)

- Used for: rendering formulas (`assets/vendor/katex/`).
- Copyright: © 2013–2020 Khan Academy and contributors.
- License: MIT. The KaTeX fonts are under MIT/OFL.
- Project: https://github.com/KaTeX/KaTeX

### VS Code Codicons

- Used for: the icon font of the panel interface (`assets/vendor/codicons/`).
- Copyright: © Microsoft Corporation.
- License: CC-BY-4.0 (icons), MIT (accompanying code).
- Project: https://github.com/microsoft/vscode-codicons

## Runtime dependencies (bundled into the build)

| Package                                                                         | License      | Used for                                 |
| ------------------------------------------------------------------------------- | ------------ | ---------------------------------------- |
| markdown-it                                                                     | MIT          | Parsing and rendering Markdown           |
| markdown-it-anchor, -attrs, -deflist, -footnote, -mark, -sub, -sup, -task-lists | MIT          | Markdown plugins                         |
| highlight.js                                                                    | BSD-3-Clause | Syntax highlighting of code              |
| katex                                                                           | MIT          | Rendering formulas (server-side)         |
| mermaid                                                                         | MIT          | Diagrams (loaded on demand in a webview) |
| yaml                                                                            | ISC          | AST-level edits of `mkdocs.yml`          |

## Build tools (not part of the VSIX)

esbuild (MIT), TypeScript (Apache-2.0), Vitest (MIT), `@types/*` (MIT).

---

Full license texts are available in the corresponding packages under
`node_modules` and in the projects' repositories. This file must accompany any
distribution of the extension.
