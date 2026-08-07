# Aurora

A sample project. It exists so the extension can be tried against something
that looks like real documentation: two palettes, custom styles, a site header
with a logo and tabs, a nav with sections — and pages that link to each other.

<div class="aurora-hero" markdown>

**Aurora** turns a stream of events into a picture you can read.
Start with [installation](getting-started/installation.md), then set the
[palette](getting-started/configuration.md#palette) to your taste.

</div>

## What to look at

- The **site header**: the rocket logo comes from `theme.icon.logo`, the tabs
  from the top level of `nav`, the repository button from `repo_url`.
- The **navigation panel**: sections collapse, the current page is highlighted.
- The **colours**: `deep purple` and `amber` from `theme.palette`, in both
  schemes — switch the VS Code theme and the page follows.
- The **custom styles**: the slab above, the underlined headings and the note
  under them all come from `docs/stylesheets/extra.css`.

## Where to go

| Page                                              | What is on it                         |
| ------------------------------------------------- | ------------------------------------- |
| [Installation](getting-started/installation.md)   | Admonitions, tabs, code blocks        |
| [Configuration](getting-started/configuration.md) | Tables, definition lists, keys        |
| [Writing](guide/writing.md)                       | Every text component in one place     |
| [Diagrams](guide/diagrams.md)                     | Mermaid, images, formulas             |
| [Annotations](guide/advanced/annotations.md)      | Annotations, footnotes, abbreviations |
| [API](reference/api)                              | A link written without the `.md`      |
| [Questions](reference/faq.md)                     | Collapsed blocks, anchors on a page   |

The links above are deliberately written in different ways — with the
extension all of them lead to the page: `page.md`, a path without the
extension, an address with an `#anchor`.

!!! tip "Start here"

    Open the preview (**MkDocs: Open Preview**) and click a link — the preview
    moves to that page, the way a site does. To edit, run
    **MkDocs: Open in Visual Editor**.

[The project site](https://example.com){ .md-button .md-button--primary }
[The repository](https://github.com/example/aurora){ .md-button }
