# Architecture

How AI Watch Web is put together, and why. Everything here is checked against the code. The decisions and their reasons are in `MEMORY.md`.

## The three parts

```
browser ──HTTP──▶ Nginx container ──HTTP, adds X-Monitor-Key──▶ AI Watch server
 (Angular app)    (serves the app,                               (existing, unchanged)
                   proxies 3 GET routes)
```

- **The app** is an Angular single page app. It is static files. It never sees the server token.
- **The Nginx container** serves those files, answers `/healthz` and `/config.json` itself, and proxies exactly `GET /health`, `GET /api/status` and `GET /api/sessions` to the AI Watch server. It adds the secret `X-Monitor-Key`, drops anything the browser sent that could matter (`Authorization`, `Cookie`, forwarding headers, its own key), drops the query string, and answers 404 for every other path under `/api/` and 405 for every other method on the three routes.
- **The AI Watch server** is the existing server of `ai-watch-server`. This project never changes it. The browser is read-only: it cannot post an event or a limit.

Because the browser talks only to its own origin, there is no CORS, and the token lives only in a Docker secret and in a generated Nginx file under `/tmp` (`docs/SECURITY.md`).

## The app

`src/app` has four layers. A layer only depends on the ones above it in this list.

| Folder | What is in it | Rule |
|---|---|---|
| `core/` | Services and pure logic: the API client, polling, connection state, alerts, celebration, focus, meeting, idle, kiosk helpers, settings, theme, notifications, demo data, the clock. | No component code. Most of the unit tests live here (coverage 94.5 % of lines). |
| `shared/` | Presentational components: status badge, session row, connection banner, NEEDS YOU overlay, celebration banner, idle robot. | The status badge, session row and connection banner take inputs only. The NEEDS YOU overlay, the celebration banner and the idle robot read their own service. |
| `layout/` | The shell: header, navigation, connection chip, timer and meeting badges, the demo banner, dimming. | One component. |
| `features/` | The pages: `dashboard`, `sessions` (list and detail), `limits`, `focus`, `settings`, `kiosk`. | Lazy routes. A page reads state and passes data down. |

Standalone components, Signals for state, RxJS only for polling, HTTP, timers and events, `OnPush` everywhere, strict TypeScript, no NgRx. Bootstrap 5 is used as SCSS only, with no Bootstrap JavaScript.

### Routes

`/` goes to `/dashboard`. `/dashboard`, `/sessions`, `/sessions/:agent/:sessionId`, `/limits`, `/focus`, `/settings` live inside the shell. `/kiosk` is outside it (no navigation). Anything else goes to `/`. Nginx falls back to `index.html` for every path that is not a file, so a deep link works.

## Data flow

1. **`StatusApi`** (`core/api`) does one `GET /api/status` (or `/api/sessions` for the Sessions page) and parses the body with hand-written type guards. An unknown status becomes `idle`. A body that does not look right is an `UnexpectedResponseError`, not a crash.
2. **`poll()`** (`core/polling`) is the loop. It has one request in flight at a time and waits the interval (3 s by default) **after the answer arrives**, so a slow server is never asked twice at once. A request times out at 4 s. After failures the wait doubles from the interval (3, 6, 12, 24 s) up to 30 s, with ±20 % jitter, and one success resets it. The Refresh button skips the wait but never overlaps a request in flight. It **pauses while the tab is hidden**.
3. **`snapshotState()`** (`core/connection-state`) turns the loop into a `ConnectionStatus`: `connecting`, `live`, `stale` (no answer for three intervals, last data kept), `offline`, `token-rejected`, `login-required`, `config-error`, or `demo`. The error kind comes from the HTTP status and the header `X-AIW-Upstream-Status` that the proxy adds: a 401 **with** `X-AIW-Upstream-Status: 401` means the server refused the proxy's token, a 401 without it means the page's own login.
4. **`ConnectionState`** is the one shared `/api/status` poll. Screens read `views()` (sessions already moved on by local time) and the snapshot. The only other poll is `SessionsFeed`, which polls `/api/sessions` while the Sessions pages are open, at **twice the interval** (6 s by default), so those pages make 30 requests a minute and not 40.
5. The page-level services (`AttentionService`, `Celebration`, `IdleService`, `MeetingMode`, `FocusTimer`) read that state and decide what to show.

### Time

The server sends `duration`, `waiting` and `resets_in` as whole seconds at the moment of the answer. Between answers the app moves them forward itself, from the moment each answer arrived, using a **monotonic clock** (`Clock.monotonic()` and a one-second `Clock.tick`) and not the browser's wall clock, so a clock change or a suspended laptop does not make a counter jump. Only `working` and `needs_attention` sessions tick; a finished session's duration is fixed. Anything that must survive a reload (the focus timer) uses `Clock.wallNow()` and is saved. Timers are timestamps, never a count of interval ticks.

## What it reproduces from the firmware

`docs/FUNCTIONAL-PARITY.md` maps every firmware behaviour to its place in this app, and says what is new here. In short:

- **NEEDS YOU alert** (`core/attention`): a modal dialog for sessions waiting on you. Dismissing only hides it and it comes back every 120 s (`ALERT_REPEAT_MS`). Acknowledging stops it for that exact `(agent, session id, updated)` and is remembered in `sessionStorage` (the last 100). The server has no acknowledge endpoint, so nothing is sent.
- **Celebration** (`core/celebration`): a 4 s banner when a session goes from `working` to `done` between two polls and the server marked it `finished_long` (5 minutes or more). Quiet in meeting mode, and not fired for something that was already done when the page opened.
- **Meeting mode** (`core/meeting`): on when the user turned it on or the focus timer runs. It quiets the alert and the celebration and dims the page by lowering content opacity.
- **Idle robot** (`core/idle`): after 15 minutes without a touch, a key, a pointer move, a change in the sessions or the connection, or a session that needs you. It moves to one of four corners every 30 s. The tap that wakes it does not press what is under it.
- **Focus timer** (`core/focus`): 25 minutes, Start/Pause/Resume/Reset, timestamp based, saved in `localStorage`.
- **Usage limits** (`core/limits`): 5-hour and weekly windows per agent, `warn` from 70 %, `critical` from 90 %, a window shows "due" once its reset time passes, and an agent that has not reported shows "no data" (nothing is invented).
- **New in this app, not in the firmware:** the Sessions page and its detail, a multi-session dashboard, demo mode, the optional tone and desktop notification, and themes.

## Themes

`ThemeService` (`core/theme`) holds the choice (`amoled`, `dark`, `light`, `system`) in `localStorage` under `aiw.theme`. **AMOLED is the default**, with a `#000` ground, regardless of what the system prefers. `system` follows the system and is never AMOLED. All colours are CSS custom properties (`--aiw-*`) in one block per theme (`src/styles/_themes.scss`); Bootstrap's own variables are overridden from them. `index.html` ships `data-theme="amoled"`, and an external script, `public/theme-init.js`, applies the saved choice **before the first paint** (the CSP forbids inline scripts). There are no shadows, gradients or blur: depth is a hairline border and a one-step lighter surface.

## Runtime configuration

The container writes `/config.json` at start (`{}` or `{"pollIntervalMs": N}`), and the app reads it before it starts polling (an app initializer), so the default update interval can be set without rebuilding. A user's own choice in Settings wins. Nothing secret is ever in it.

## Why this shape

- **One image, same origin:** it removes CORS and keeps the token out of the browser. The price is that the image is the trust boundary, which is why its rules are tested against real containers (`docs/TESTING.md`).
- **Polling, not a stream:** the server has no push channel and is small (16 connections, 3 s timeouts, no keep-alive). A 3 s poll with a 1–2 s Nginx cache means twelve browsers cost the server at most two requests in that window.
- **Local ticking:** it keeps the screen alive between answers without asking more often.
- **No state library:** the state is one shared snapshot and a handful of small services, so Signals are enough.
