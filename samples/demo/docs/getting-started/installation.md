# Installation

Aurora runs anywhere Python 3.11 does. Pick the way that fits your setup — the
result is the same binary and the same configuration file.

=== "pip"

    ```bash
    pip install aurora
    aurora --version
    ```

=== "Homebrew"

    ```bash
    brew install example/tap/aurora
    aurora --version
    ```

=== "Docker"

    ```bash
    docker run --rm -v "$PWD:/work" example/aurora:1.4 --version
    ```

!!! note "Which version"

    The examples pin `1.4`. On the `main` branch the configuration format may
    change without notice — see the [changelog](https://example.com/changelog).

## First run

```python title="collect.py" linenums="1" hl_lines="4 5"
from aurora import Stream

stream = Stream("events.jsonl")
for window in stream.windows(minutes=5):
    print(window.count, window.p95)
```

The output is one line per five-minute window: the number of events and the
95th percentile of their duration.

??? example "What the output looks like"

    ```text
    1042  0.31
    1187  0.29
     998  0.44
    ```

## Checking the setup

- [x] Python 3.11 or newer
- [x] `aurora --version` prints a version
- [ ] `AURORA_TOKEN` is in the environment
- [ ] The daemon answers on `:8422`

!!! warning "The token is read once"

    Aurora reads `AURORA_TOKEN` at start. Change the variable — restart the
    process, otherwise the old value stays in memory.

Next: [configuration](configuration.md), and in particular the
[palette](configuration.md#palette).
