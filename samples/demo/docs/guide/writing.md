# Writing

One page holding the text components Material provides — a place to see at a
glance whether the preview draws them the way the site does.

## Admonitions

!!! note

    A note without a title of its own.

!!! tip "With a title"

    Any Markdown fits inside: a list, a table, a code block.

    ```bash
    aurora report --since 24h
    ```

??? question "Collapsed, opens on click"

    Written with `???` instead of `!!!`.

???+ danger "Collapsed, but open to start with"

    `???+` opens the block on load.

## Content tabs

=== "Linux"

    ```bash
    systemctl --user restart aurora
    ```

=== "macOS"

    ```bash
    launchctl kickstart -k gui/$UID/com.example.aurora
    ```

=== "Windows"

    ```powershell
    Restart-Service Aurora
    ```

## Text

Ordinary emphasis: *italic*, **bold**, ***both at once***.
Material adds ==a highlight==, ^^an underline^^, ~~a strikethrough~~,
H~2~O and 10^-4^, `inline code` and `#!python sorted(events, key=len)` with
highlighting of its own.

Critic markup: {--removed--}, {++added++}, {~~one~>another~~},
{==marked==} and {>>a comment<<}.

Smart symbols come for free: (c) (tm) 1/2 --> =/= .

## Lists

1. Ordered
2. Second item
    1. Nested
    2. And another
3. Third

- Unordered
- With a nested list
    - Deeper
        - Deeper still

- [x] A task that is done
- [ ] One that is not

Term
: A definition list item — the term above, the explanation here.

Another term
: With two paragraphs.

    The second one is indented under the same definition.

## Tables

| Left | Centre | Right |
| :--- | :----: | ----: |
| one  |  two   | three |
| four |  five  |   six |

## Quote

> The best documentation is the one you do not have to read.
>
> — a project that never shipped

## A card grid

<div class="grid cards" markdown>

- :material-clock-fast: **Five minutes**

    ---

    From install to the first report — no database, no daemon.

    [Installation](../getting-started/installation.md)

- :material-palette: **Your colours**

    ---

    The report follows the palette of the site.

    [Configuration](../getting-started/configuration.md#palette)

</div>

## Icons and emoji

:material-rocket-launch: :fontawesome-brands-github: :octicons-heart-fill-24:
:smile: :rocket:

## Keys

++cmd+shift+p++ opens the command palette, ++ctrl+alt+del++ needs no
introduction.
