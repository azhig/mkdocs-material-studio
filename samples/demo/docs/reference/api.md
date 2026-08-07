# API

The HTTP surface of the daemon. Everything answers JSON; errors carry a
`problem` object with `code` and `detail`.

## `GET /windows`

Returns the finished windows.

| Parameter | Type     | Default | Meaning                             |
| --------- | -------- | ------- | ----------------------------------- |
| `since`   | duration | `24h`   | How far back to look                |
| `limit`   | integer  | `288`   | Maximum number of rows              |
| `format`  | string   | `json`  | `json` or `csv`                     |

```bash
curl -s "localhost:8422/windows?since=6h&limit=10" | jq '.[0]'
```

```json title="One row"
{
  "start": "2026-08-04T09:00:00Z",
  "count": 1042,
  "p50": 0.12,
  "p95": 0.31
}
```

## `POST /reload`

Re-reads `aurora.toml` without dropping the collected windows.

!!! warning "`window` is not re-read"

    Changing the window length would make the stored rows incomparable, so it
    is only picked up on a full restart.

## `GET /health`

`200 OK` and an empty body while the collector is keeping up; `503` with a
`problem` when the read lags more than one window behind.

## Errors

| Code               | HTTP | When                                 |
| ------------------ | ---- | ------------------------------------ |
| `window_pending`   | 409  | The window asked for is not closed   |
| `bad_duration`     | 400  | `since` is not a duration            |
| `store_unavailable`| 503  | The store is locked by another run   |

Back to [the guide](../guide/writing.md).
