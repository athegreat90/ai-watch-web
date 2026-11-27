# API contract

The AI Watch server contract as the web app depends on it, read from the server source at `a495671`. Paths: `internal/httpapi/handler.go` (H) and `internal/monitor/monitor.go` (M). The web app only uses the three read routes, through the Nginx proxy.

## Routes

| Method and path | Auth | Success | Used by the web app |
|---|---|---|---|
| `GET /health` | No | `200 {"ok":true}` | "Test connection" only |
| `GET /api/status` | Yes | Snapshot, at most 8 sessions (`StatusSessions`) | Yes |
| `GET /api/sessions` | Yes | Snapshot, at most 40 sessions (`MaxSessions`) | Yes, Sessions page |
| `POST /api/events`, `POST /api/event` | Yes | `200 {"ok":true}` | **No** |
| `POST /api/limits` | Yes | `200 {"ok":true}` | **No** |

There is no CORS handling, no rate limiting, no request logging and no persistence. State is in memory and cleared on restart.

### Routing quirks (H:45-115)

- Routing uses `r.RequestURI`, so the query string is part of the path. `GET /api/status?x` returns 404, and `GET /health?x=1` without a key returns 401.
- Auth is checked before the path. An unknown path with a wrong key returns 401, not 404.
- `PUT`, `DELETE`, `HEAD` and `OPTIONS` return `501` with a plain-text "Unsupported method" body, not JSON. A browser preflight therefore fails, which is one reason for the same-origin proxy.
- Responses carry `Cache-Control: no-store` and `Connection: close`. JSON is compact and ASCII-only (`\uXXXX`).

## Authentication

Header `X-Monitor-Key`, compared in constant time with the token from `config.local.json`. The token must have at least 24 characters. Missing or wrong key: `401 {"error":"unauthorized"}`. Only `GET /health` is public.

## Snapshot (GET /api/status and /api/sessions)

```
{
  "sessions": [
    {
      "session_id": str, "agent": str, "project": str, "status": str, "detail": str,
      "updated": float, "started": float, "since": float,   // Unix seconds, sub-second
      "duration": int,  "finished_long": bool, "waiting": int  // seconds
    }
  ],
  "limits": {
    "<agent>": {
      "five_hour": { "used_pct": float, "resets_at": float, "resets_in": int },
      "weekly":    { "used_pct": float, "resets_at": float, "resets_in": int }
    }
  },
  "active_count": int, "attention_count": int, "total_count": int
}
```

| Field | Meaning |
|---|---|
| `duration` | `int(end - started)`, never negative. `end` is now for `working` and `needs_attention`, otherwise `updated`. |
| `finished_long` | True when status is `done` and `duration >= 300`. Computed on the server. |
| `waiting` | `int(now - since)` for `needs_attention`, otherwise 0. |
| `resets_in` | `max(0, int(resets_at - now))`. |
| `active_count` | Number of `working` sessions only. |
| `attention_count` | Number of `needs_attention` sessions only. |
| `total_count` | All live sessions, not only the ones in the capped list. |

Empty state: `{"sessions":[],"limits":{},...}`. The server may print `1700000000.0` as `1700000000`, so compare numbers by value, not by text.

### Statuses and ordering

Statuses: `working`, `needs_attention`, `done`, `idle`, `notice`, `error`. The order in the response is `needs_attention`, `error`, `working`, `notice`, `done`, `idle`, then newest `updated` first, then first inserted (M:326-335). The web app keeps this order.

### Session identity

The key is the pair (agent truncated to 24 characters, `session_id` truncated to 80). The same `session_id` under two agents gives two sessions. The reference hooks send `session_id` as a 64-character SHA-256 hex string.

### Expiry (lazy, on every read)

| What | TTL | Measured from |
|---|---|---|
| `done`, `idle`, `notice`, `error` | 120 s | `updated` |
| `working`, `needs_attention` | 3600 s | `updated` |
| Limits | 900 s | Server receive time |

The store holds at most 40 sessions. A 41st evicts the one with the lowest `updated`.

## Usage limits

Posted with `POST /api/limits` (not used by the web app). The server accepts **Claude Code, Codex and Antigravity** (M:247). Both windows are required. `used_pct` is rounded to one decimal and `resets_at` is not checked against the clock. The latest post per agent replaces the previous one. Gemini CLI and Copilot can send events but not limits (400). `docs/API.md:39` in the server repository lists only two agents, which is stale.

## Errors

JSON errors are `{"error":"<msg>"}`.

| Code | Body | Cause |
|---|---|---|
| 400 | `invalid event` | Bad JSON, non-object body, or failed validation (writes only) |
| 401 | `unauthorized` | Missing or wrong key |
| 404 | `not found` | Unknown path, including any query string |
| 413 | `body must be 1-4096 bytes` | Bad `Content-Length` on a POST |
| 501 | plain text "Unsupported method" | Any method other than GET and POST |

## Transport limits

Body at most 4096 bytes. At most 16 open connections, and the rest wait in the kernel backlog. Read, write and idle timeouts 3 s. Keep-alive off. Port 8765. The server speaks plain HTTP, and TLS is expected to come from an external reverse proxy.

## Write semantics (for contract-test fixtures)

- Event `timestamp` is optional Unix seconds. It must lie within now minus 3600 s and now plus 60 s, otherwise 400. Fixtures therefore use times relative to now.
- An event with `timestamp <= stored.updated` for the same key returns 200 and is ignored.
- `started` resets on a new turn: the first insert, or `working` after a status that was neither `working` nor `needs_attention`. `since` resets on every status change.
- Field limits: `session_id` 80, `agent` 24, `status` 20, `project` 40 (default "Unknown project"), `detail` 66 characters.

## What the Nginx proxy exposes

Only `GET /health`, `GET /api/status` and `GET /api/sessions`. Everything else under `/api/` is 404. Query strings are removed before the request reaches the server. The proxy adds `X-Monitor-Key` from a secret and `X-AIW-Upstream-Status` on its responses. See `MEMORY.md` for the reasons.

## Not verified

The code was read, not run. The contract tests in phase 9 will run the checks against a real server image.
