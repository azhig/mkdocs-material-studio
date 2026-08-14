# Diagrams and images

## How events travel

```mermaid
flowchart LR
    A[Collector] --> B{Valid?}
    B -- yes --> C[Window buffer]
    B -- no --> D[Rejects]
    C --> E[(Store)]
    E --> F[Report]
```

The picture is drawn by Mermaid inside the preview and follows the page scheme:
switch the VS Code theme and it is redrawn.

```mermaid
sequenceDiagram
    participant CLI
    participant Daemon
    participant Store
    CLI->>Daemon: report --since 24h
    Daemon->>Store: read windows
    Store-->>Daemon: 288 rows
    Daemon-->>CLI: rendered report
```

## A picture from the repository

![The parts of Aurora and what flows between them](../assets/architecture.svg)

A local file resolved against the page — the same as the site does.

<figure markdown>
  ![A smaller copy of the same picture](../assets/architecture.svg){ width="320" }
  <figcaption>A figure with a caption</figcaption>
</figure>

## One picture per color scheme

![Drawn for a pale background](../assets/scheme-light.svg#only-light){ width="320" }
![Drawn for a dark background](../assets/scheme-dark.svg#only-dark){ width="320" }

The anchor of the address decides which copy the page shows; switching the
scheme swaps them. The editor keeps both on the page, the hidden one faded, so
the pair can be edited from one place.

## Formulas

The percentile of a window is taken over the sorted durations:

$$
p_{95} = x_{\lceil 0.95\,n \rceil}
$$

Inline as well: the number of windows in a day is $n = 86400 / w$, where $w$ is
the window in seconds.

## A code block with line numbers

```python title="window.py" linenums="1" hl_lines="6 7"
def percentile(values: list[float], q: float) -> float:
    if not values:
        raise ValueError("empty window")
    ordered = sorted(values)
    index = math.ceil(q * len(ordered)) - 1
    # The index is clamped: q = 1.0 must not walk off the end.
    return ordered[min(index, len(ordered) - 1)]
```

Next: [annotations](advanced/annotations.md).
