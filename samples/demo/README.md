# The sample project

A small MkDocs Material site — “Aurora” — for checking the extension against
something that behaves like real documentation. No Python needed: open a page
and the extension draws it.

```bash
code samples/demo
```

Then open `docs/index.md` and run **MkDocs: Open Preview** (or **MkDocs: Open in
Visual Editor**). Everything below is read out of `mkdocs.yml`.

## What to check

**The colours come from the project.** `theme.palette` holds two entries with a
toggle — `deep purple` / `amber` in both the light and the dark scheme. The
preview does not follow the media query: it takes the VS Code theme and the
colours of the matching scheme. Switch the theme and watch the page follow.

**The custom styles are applied.** `docs/stylesheets/extra.css` is deliberately
loud, so its absence is obvious:

- a lettered `AURORA` caption above every `##` heading, and a rule under it;
- the slab on the front page, with a background image referenced from the CSS
  by a relative `url()` — it checks that those get rewritten too;
- a zebra in the tables and an accent bar on the quotes.

Edit `extra.css` and save — the page updates without reopening the tab.

**The header and the navigation are built from the file.** The rocket logo is
`theme.icon.logo`, the tabs are the top level of `nav` (because
`navigation.tabs` is on), the button on the right is `repo_url`. The nav has
sections, a nested section and an external link; the current page is
highlighted, and clicking another one opens it.

**Links lead where MkDocs says they do.** The front page links to the same set
of pages in different ways on purpose: `page.md`, a path with no extension
(`reference/api`), an address with an `#anchor`. In the preview a click follows
the link; in the visual editor it is `Cmd/Ctrl+click`.

**The components render.** [Writing](docs/guide/writing.md) has the text
components in one place, [Diagrams](docs/guide/diagrams.md) has Mermaid, local
images and formulas, [Annotations](docs/guide/advanced/annotations.md) has
annotations, footnotes and abbreviations, and
[Questions](docs/reference/faq.md) is a page of collapsed blocks with links to
its own sections.

## Running the site itself

Optional, and the only thing here that needs Python:

```bash
pip install mkdocs-material
mkdocs serve -f samples/demo/mkdocs.yml
```

The extension neither starts nor manages that server — a built site with
search and plugins is the reader's business, not the editor's.
