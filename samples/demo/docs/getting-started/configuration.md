# Configuration

Everything lives in `aurora.toml` next to your data. Nothing here is required —
the defaults below are what Aurora uses when the file is missing.

## Options

| Option      | Type       | Default   | What it does                            |
| ----------- | ---------- | --------- | --------------------------------------- |
| `window`    | duration   | `5m`      | Length of one aggregation window        |
| `retention` | duration   | `30d`     | How long finished windows are kept      |
| `workers`   | integer    | `4`       | Parallel readers                        |
| `palette`   | string     | `aurora`  | Colour scheme of the generated report   |
| `strict`    | boolean    | `false`   | Stop on the first malformed record      |

`window`

: How much time one bucket covers. Accepts `30s`, `5m`, `1h`. Smaller windows
mean more rows and a noisier picture.

`retention`

: Finished windows older than this are deleted on start. Set it to `0` to keep
everything — the file grows about 1 MB a day per million events.

`strict`

: With `strict = false` a malformed record is counted and skipped. With
`strict = true` the run stops and the offending line is printed.

## Palette

The report follows the same palette as this site: `deep purple` for the primary
colour, `amber` for the accent.

```toml title="aurora.toml"
window = "5m"
retention = "30d"
workers = 8
palette = "aurora"      # aurora | mono | solarized
strict = true
```

!!! info "Where the file is looked for"

    In order: `--config`, then `$PWD/aurora.toml`, then
    `~/.config/aurora/config.toml`. The first one found wins; they are not
    merged.

## Keyboard

In the interactive report:

- ++ctrl+f++ — filter by substring
- ++ctrl+shift+p++ — the command palette
- ++esc++ — back to the whole picture

## Where the defaults come from

The built-in defaults are compiled in, so a broken `aurora.toml` never leaves
you without a working configuration ==the run simply ignores it and says so==.
Back to [installation](installation.md), or on to
[writing](../guide/writing.md).
