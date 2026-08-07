# Questions and answers

The things people ask twice. Every answer here is collapsed — a page of
questions is meant to be scanned, not read.

## Collecting

??? question "Why does the last line of the file disappear?"

    It does not: an unfinished line is held back until the next read. A file
    that is still being written to is the normal case, not an error.

??? question "Can the window be changed while running?"

    No. The windows already collected would stop being comparable to the new
    ones, so the length is picked up on a full restart only.

??? question "What happens to a malformed record?"

    With `strict = false` it is counted and skipped; the count shows up in the
    report. With `strict = true` the run stops and prints the offending line.

## Reports

??? question "Why is the report empty right after the start?"

    The first window is not closed yet. With the default `window = 5m` the
    first row appears five minutes in — or right away for a file that already
    holds older events.

??? question "Can the percentile be taken over the whole day?"

    Not from the stored windows: a percentile of percentiles is not a
    percentile. Read the raw file with `--raw` if you need the exact number.

## Storage

??? question "How fast does the store grow?"

    About 1 MB a day per million events. `retention` trims it on start; set it
    to `0` to keep everything.

??? question "Is it safe to run two collectors over one store?"

    No — the store is locked by the first one, and the second stops with
    `store_unavailable`. Point them at different files and merge the reports.

## Where to look next

| Question                       | Page                                              |
| ------------------------------ | ------------------------------------------------- |
| How do I install it?           | [Installation](../getting-started/installation.md) |
| What can be configured?        | [Configuration](../getting-started/configuration.md) |
| What does the daemon answer?   | [API](api.md)                                     |

A link to a section of this very page: [Storage](#storage). A link to a section
of another one: [the palette](../getting-started/configuration.md#palette).
