# Security Policy

## Supported versions

The latest published version is the one that gets fixes.

## Reporting a vulnerability

Please report privately rather than in a public issue: open a
[security advisory](https://github.com/azhig/mkdocs-material-studio/security/advisories/new)
on GitHub. A first reply usually takes a few days.

Useful in a report: what an attacker can achieve, the steps to reproduce, and
the version of the extension.

## What is worth reporting

The extension edits files in the open workspace and renders Markdown inside a
webview, so the interesting areas are:

- **Data loss.** Editing that corrupts a file beyond the block being changed, or
  a write outside the workspace folder.
- **Escaping the webview.** Markdown or a project stylesheet (`extra_css`) that
  manages to execute code or read files it should not reach. The Content
  Security Policy forbids external scripts and stylesheets — a way around it is
  a vulnerability.
- **The `mkdocs serve` process.** Arguments or paths from a project file
  (`mkdocs.yml`) that end up in the command line.

## What is not a vulnerability

- Rendering a page that a project's own `extra_css` makes ugly: styles from the
  workspace are applied on purpose.
- A `mkdocs serve` server reachable on localhost: that is how the mode works,
  and the port is chosen by the same MkDocs the user runs by hand.
