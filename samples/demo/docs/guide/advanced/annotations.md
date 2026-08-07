# Annotations and notes

Three ways to say something aside from the main text — each with its own place.

## Annotations

A number in a circle that opens a note in place:

The collector reads the file line by line (1) and keeps only the fields the
window needs (2).
{ .annotate }

1. A partial last line is held back until the next read — a log being written
   into is normal, not an error.
2. Everything else is dropped right away, so a large file does not become a
   large amount of memory.

They work inside a code block too:

```yaml
window: 5m # (1)!
workers: 8 # (2)!
```

1. Below `1m` the report becomes noise.
2. More than the number of cores gains nothing: the readers are I/O bound.

## Footnotes

The percentile is taken over the window, not over the whole day[^method], and
the empty windows are skipped[^empty].

[^method]:
    Otherwise a quiet night would pull the number down and a busy hour would
    never show up.

[^empty]: A window with no events has no percentile to speak of.

## Abbreviations

The HTML report is built once and served as a static file; the JSON one is
meant for a CI job.

Abbreviations come from `includes/abbreviations.md` — one definition, every
occurrence on the page.

## Tooltips

A [link with a tooltip](https://example.com "Opens the project site") shows it
on hover, without leaving the page.

Back to [diagrams](../diagrams.md) or [home](../../index.md).
