# Configuration

Every setting, where it lives, and what it does. Nothing here is a secret except the two files marked as such.

## The container

Set with environment variables, and two secret files.

| Name | Meaning | Default |
|---|---|---|
| `UPSTREAM_URL` | Where the AI Watch server is, seen from inside the container: `http://host` or `http://host:port`. Only `http`, a name or IP made of `A-Z a-z 0-9 . _ -`, and a port up to 65535. The name is looked up when needed, so the container starts before the server exists and answers 502 until then. | `http://ai-watch-server:8765` |
| `POLL_INTERVAL_MS` | The page's default update interval, 1000 to 60000. Written to `/config.json`. A user's own choice in Settings wins. | empty (the app uses 3000) |
| `RESOLVER` | The DNS server Nginx uses to find `UPSTREAM_URL`. An IP address. | the first in `/etc/resolv.conf` |
| `MONITOR_KEY_FILE` | The file with the server's monitor token. | `/run/secrets/monitor_key` |
| `HTPASSWD_FILE` | A file that turns on a login for the whole page. | `/run/secrets/htpasswd` (used only if the file exists) |

**The monitor token** is read from `MONITOR_KEY_FILE`, never from an environment variable. It must be on one line, at least 24 characters from `A-Z a-z 0-9 . _ ~ + / = -`. Anything else and the container **refuses to start** with a message (see `TROUBLESHOOTING.md`). It ends up only in a file the entrypoint writes under `/tmp/nginx/` (mode 600, readable by Nginx only), as an Nginx `map` value.

**The login file** holds lines like `user:hash`, where the hash is any format Nginx's `auth_basic_user_file` reads (the installer writes `$6$` salted SHA-512 made with BusyBox `cryptpw`). With it, the whole page asks for a name and password, except `/healthz`. Basic authentication is plain text over plain HTTP: see `DEPLOYMENT.md`.

Every value written into Nginx's configuration is first checked to be a single line (a newline could otherwise carry extra directives), and the configuration is tested with `nginx -t` before Nginx starts.

### What the image serves

| Path | Answer |
|---|---|
| `/healthz` | `200`, never cached, never behind the login. Used by the Docker health check. |
| `/config.json` | The runtime settings above. `no-store`. |
| `GET /health`, `GET /api/status`, `GET /api/sessions` | Proxied to the server with the secret key. The query string is dropped. `/api/*` data answers are cached for 1 to 2 seconds. |
| anything else under `/api/` | `404` |
| other methods on the three routes | `405` |
| hashed files (`main-XXXX.js`) | `public, max-age=31536000, immutable` |
| everything else | the app (`index.html`, `no-cache`) |

Security headers (a strict Content Security Policy, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a cross-origin opener policy, a restrictive permissions policy) are on every answer. The policy is in `docker/nginx/snippets/security-headers.conf`, and it is not to be widened to make something work.

## The deployment bundle

`.env` next to `compose.yaml` (created from `env.example` by the installer, never overwritten).

| Variable | Meaning | Default |
|---|---|---|
| `AI_WATCH_WEB_IMAGE` | The image: `ghcr.io/athegreat90/ai-watch-web:latest` or a pinned `:vX.Y.Z`. | `:latest` |
| `WEB_HOST_BIND` | The address the page listens on. `127.0.0.1` is this machine only. | `127.0.0.1` |
| `WEB_HOST_PORT` | The port. | `8080` |
| `UPSTREAM_URL` | As above. | `http://ai-watch-server:8765` |
| `POLL_INTERVAL_MS` | As above. | empty |
| `COMPOSE_FILE`, `COMPOSE_PATH_SEPARATOR` | Which optional files are on (`compose.server.yaml`, `compose.auth.yaml`). Set by the installer. | `compose.yaml` |
| `AI_WATCH_SERVER_IMAGE`, `MONITOR_HOST_BIND`, `MONITOR_HOST_PORT`, `PUID`, `PGID` | Only with `compose.server.yaml`: the server image, where it listens on this machine, and the user it runs as. | |

Files: `secrets/monitor_key` (the token, a Docker secret), `secrets/htpasswd` (the login), `server/config.local.json` (only with `--with-server`), `.deploy-history` (the images that ran before, for rollback). The installer's own settings are in `deploy/ai-watch-web-deploy/README.md`.

## Development

| Name | Meaning |
|---|---|
| `AIW_DEV_TOKEN` | The monitor token of a **local** AI Watch server, used by `proxy.conf.cjs` so `ng serve` can reach it. Never a production token. |
| `AIW_DEV_UPSTREAM` | Where that server is (default `http://127.0.0.1:8765`). |
| `AIW_TEST_IMAGE` | The image `npm run test:proxy` tests. |
| `AI_WATCH_WEB_IMAGE` | The image `npm run e2e` tests (built if missing). |
| `E2E_KEEP=1`, `E2E_NO_STACK=1` | Keep the end-to-end stack running afterwards, or do not start one. |
| `AIW_CONTRACT_URL`, `AIW_CONTRACT_TOKEN` | The throwaway server `npm run test:contract` writes to. |

## In the browser

Preferences are saved in this browser only, and none is secret.

| Where | Key | What |
|---|---|---|
| `localStorage` | `aiw.theme` | `amoled` (default), `dark`, `light` or `system`. |
| `localStorage` | `aiw.settings` | `{ pollIntervalMs, sound, notifications }`. The interval is one of 2, 3, 5, 10, 30, 60 s; the tone and desktop notifications are **off** by default and need a user action to turn on. |
| `localStorage` | `aiw.focus` | The focus timer: its phase (`idle`, `running`, `paused` or `done`), plus `endsAt` while it runs or `remainingMs` while it is paused. |
| `sessionStorage` | `aiw.acks` | The acknowledged alerts, up to 100, one per `(agent, session id, updated)`. Gone when the tab closes. |
| `sessionStorage` | `aiw.demo` | Demo mode is on for this tab. |

Settings has the same choices in a page: theme, update interval (with a button to apply it), a connection test, the tone, desktop notifications, and demo data. Turning demo mode on or off reloads the page. A new update interval applies after you press "Reload to apply", because the interval is read once when the app starts.
