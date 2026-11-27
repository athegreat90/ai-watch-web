# CLAUDE.md

Instructions for coding agents working on AI Watch Web. Read `MEMORY.md` first for decisions and their reasons, and `README.md` for the full description. All 13 phases are done (parity docs, the Angular scaffold, the API client with polling and connection state, the dashboard, Sessions and Limits pages, the alert and celebration, the focus timer, meeting mode, the idle robot, the kiosk, Settings, themes and demo mode, and the Nginx image). Nothing is a placeholder any more, but CI, the security scans and releases are still to come. Everything else is planned: do not describe unbuilt things as existing.

## Hard rules

- **Never expose the server token.** `X-Monitor-Key` must not appear in the Angular code, environment files, bundle, `/config.json`, browser storage, logs, test output or documentation. It exists only in the Docker secret and the rendered Nginx config under `/tmp`.
- **Never change the AI Watch server or firmware.** They are the source of truth. If their behaviour looks wrong, record it in `docs/FUNCTIONAL-PARITY.md` or `MEMORY.md`.
- **Read-only API.** The app uses only `GET /health`, `GET /api/status` and `GET /api/sessions`. Never add a call to `/api/events`, `/api/event` or `/api/limits`, and never add an acknowledgment call to the server (none exists).
- **Never fabricate data.** Real data is never replaced by demo data. Missing limits show "no data".
- **Do not invent firmware or API behaviour.** Verify it in the source, and mark proposals as proposals.

## Stack and versions

- Angular, TypeScript, RxJS, Bootstrap 5 (SCSS only, no Bootstrap JavaScript, no ng-bootstrap), inline SVG icons, Vitest, Playwright, Nginx unprivileged.
- Take TypeScript and RxJS ranges from Angular's peer dependencies. Do not use npm "latest" blindly.
- No NgRx and no new dependency for a few lines of code. A new dependency needs a reason in the pull request.

## Code conventions

- Standalone components, Angular control flow, Signals for state, RxJS only for polling and HTTP, OnPush change detection, lazy feature routes, strict TypeScript, typed API models, hand-written type guards for responses.
- Layout: `src/app/core`, `shared`, `layout`, `features/{dashboard,sessions,limits,focus,settings,kiosk}`.
- Session identity is (agent, `session_id`). Never re-sort sessions: the server order is the contract.
- `src/app/core/api/parse.ts` must keep no runtime imports (only `import type`). The contract test loads it directly with Node's type stripping.
- `StatusPoller` reads the poll interval once, so the runtime config must be loaded first (the app initializer does this).
- Never point the contract test or the dev proxy at a production server.
- Anything under `docker/` must keep `npm run test:entrypoint` and `npm run test:proxy` green. The proxy tests need Docker and a built image (`AIW_TEST_IMAGE`), and they check what the server actually receives, so a config change is not done until they pass on a rebuilt image.
- The monitor token only goes into the Docker secret and `/tmp/nginx/runtime.conf`. Never into an `ENV`, an `ARG`, a build layer, the bundle, `config.json`, a log or a process argument. Every value the entrypoint writes into Nginx config must be validated as one line first (`grep` checks line by line, so a newline can hide extra text).
- In shell, `$(printf '\n')` is an empty string (command substitution trims trailing newlines). Use a literal newline.
- Nginx drops inherited `add_header` lines in any location that has its own. Security headers are included from `snippets/security-headers.conf` in every location for that reason.
- The data-route cache lives 1 to 2 seconds (Nginx counts whole seconds). A test that needs a fresh answer waits 2.3 s.
- On Windows Git Bash, `docker exec ... /dev/null` turns the path into `nul`. Use `MSYS_NO_PATHCONV=1`. In a container, never `grep -r /var`: `/var/log/nginx` links to a pipe and the search hangs.
- Screens read `views` (sessions already moved on by local time), not `snapshot.sessions`, so running times keep counting. Only `working` and `needs_attention` sessions tick.
- A screen that polls gets its state from `snapshotState(injectPoll(...))`. Do not write a second polling loop.
- Presentational components (`shared/`) take inputs and have no injected state. Pages read the state and pass data down.
- Test-only helpers live in `src/app/testing/` and are excluded from the app build.
- Acknowledging an alert never calls the server (it has no such endpoint). An acknowledgement belongs to (agent, id, `updated`).
- Anything that should stay quiet in a meeting reads `MeetingMode.active()`. It is true when the user turned it on or the focus timer runs. The idle robot is deliberately not affected.
- Times that must survive a reload (the focus timer) use `Clock.wallNow()` and are saved. Times that only need to count between responses use `Clock.monotonic()` and `Clock.tick`.
- A document-level listener that must stop a touch (the idle wake-up) needs `{ passive: false }`. `touchstart` and `wheel` on the document are passive by default and ignore `preventDefault()`.
- Demo mode never touches real data: `StatusPoller` and `SessionsFeed` take example data from `DemoSource` only while `SettingsStore.demo()` is on, the status then reads `demo`, and switching reloads the page. A server that is down is shown as down, never replaced by example data.
- Preferences live in `SettingsStore` (non-secret, `localStorage`; demo in `sessionStorage`). The theme is in `ThemeService` under `aiw.theme`, the same key `public/theme-init.js` reads.
- Colours: use the `--aiw-*` tokens only. Text must keep 4.5:1 in all three themes and while dimmed. Do not use Bootstrap's own grey or yellow for text on a theme background. After any colour change, run axe in a real browser (see `MEMORY.md`, phase 7), because jsdom cannot measure contrast.
- Do not name a component class `.row` or another Bootstrap class: Bootstrap's `.row > *` rules reach into it.
- The kiosk must not scroll at 800x480 and 1024x600, so keep its row count capped and its controls at least 48 px tall.
- Unit tests cannot see CSS. After changing styles, look at the page in a browser. Example: in Sass, `#{$n}%` turns into `4 %` with a space, which the browser silently drops. Write `$n * 1%` instead.
- `duration`, `waiting` and `resets_in` tick locally from fetch time on a monotonic clock, not from the browser wall clock.
- Timers use timestamps, never a counter of interval ticks.
- Clean up every subscription and timer. Pause polling and animations when the tab is hidden.
- Code, comments, UI text, tests and docs are in English.

## Theme rules (AMOLED is the default)

- The page ground is exactly `#000`. Colours come from CSS custom properties in one token block per theme.
- No shadows, gradients, blur or backdrop filters. Elevation is a hairline border and a one-step lighter surface.
- Text is `#e4e7ea`, not pure white. Muted text keeps a 4.5:1 contrast on black.
- Respect `prefers-reduced-motion`. Meeting mode dims by lowering content opacity, not by trying to control hardware brightness.
- `index.html` ships with `data-theme="amoled"`. The saved choice is applied by an external script, never an inline one.

## Nginx and container rules

- Proxy exactly the three GET routes with exact-match locations. Everything else under `/api/` is 404. Strip query strings. Override any client `X-Monitor-Key`.
- Validate the token (`[A-Za-z0-9._~+/=-]{24,}`) before rendering it into config. Refuse to start otherwise.
- Keep the CSP from `README.md`. Scripts are never inline. Do not widen it to make something work, fix the cause.
- Run as non-root with a read-only root filesystem. Only `/tmp` is writable.
- Pin base images by digest and GitHub Actions by full commit SHA. `security/refresh_base.py` moves the two image pins, and `security/check_version.py` fails when they drift from `.nvmrc`.
- The runtime stage removes the Nginx modules this site does not load and runs `apk upgrade`. Do not add a feature that needs one of those modules (geoip, image filter, njs, xslt), HTTP/2, HTTP/3, TLS or SSI without rereading `docs/SECURITY.md`: the open Nginx findings are not exploitable only because none of those is enabled.
- `npm run security:repo` and `npm run security:image amd64|arm64` need Docker and the network. `npm run test:security` does not. A new script under `security/` gets a test in `security/test_security.py`, and its pattern checks get a mutation run (a test that passes with the rule broken proves nothing).
- Trivy knows the AWS documentation example keys and ignores them on purpose, so a planted `AKIAIOSFODNN7EXAMPLE` proves nothing. Use a random token with a real format to test the secret scan.
- On Windows, `python3` can be a Store stub that does nothing, so the scripts pick the first of `python3` and `python` that really runs.
- Prove Nginx behaviour with tests (query stripping, the `X-AIW-Upstream-Status` header, microcache). Do not rely on the documentation alone.

## Testing

- Behaviour-first tests through public interfaces. Do not write tests only to raise coverage. Target at least 85 % on `core/`.
- Time-dependent logic (2-minute alert repeat, 15-minute idle, 25-minute focus, backoff) uses fake timers or the Playwright clock.
- End-to-end rules (`e2e/`):
  - Every test starts from an empty server and a fresh web container (the fixture restarts both). The web image caches data routes for 1 to 2 s, so without the restart a test sees the previous test's data.
  - The `problems` fixture fails any test that logs a console error, a script error or a CSP violation. A test that causes one on purpose clears it (`problems.length = 0`) and says why.
  - The idle robot with a fake clock: a change of connection state counts as activity, so settle the page on "Offline" (abort `/api/status`) before jumping 15 minutes. Do not use `runFor` with real requests: the 4 s request timeout runs out before the reply arrives.
  - Run axe with `page.evaluate(axeSource)`, never `addScriptTag`: the CSP forbids inline scripts. Wait for the meeting dimming transition to end before measuring.
  - A test that edits another test's code with a regex must be re-read afterwards. A replacement once deleted an assertion and the test passed with nothing checked.
- Contract tests run against a pinned server image with relative timestamps (the server accepts now minus 3600 s to now plus 60 s).
- Commands:
  - `npm ci`
  - `npm run lint`, `npm run typecheck`, `npm run format:check`
  - `npm run test:ci` (unit tests with coverage)
  - `npm run build`
  - `npm run test:contract` (needs `AIW_CONTRACT_TOKEN` and a throwaway server, because it writes data)
  - `npm run e2e:install` once, then `npm run e2e` (builds `ai-watch-web:test` if missing, starts the pinned server and the image with `compose.test.yaml`, and tears them down; `E2E_KEEP=1` keeps them, `AI_WATCH_WEB_IMAGE` picks the image). It needs Docker.

## Security and release rules

- Never skip or bypass a failed or unavailable SonarQube Quality Gate or a fixable HIGH or CRITICAL Trivy finding. The only exceptions are the entries of `security/accepted-risks.json`: each needs a dated owner decision, expires, and is checked by `check_nginx_features.py`. Do not add or extend one without the owner.
- Never overwrite an existing version tag or its image. `latest` only moves to a newer stable version. Prereleases never touch it.
- Release only commits that passed CI. Docs-only, test-only and CI-only changes do not release.
- Workflows (`.github/workflows/`): pin every action to a full commit SHA with its version in a comment, keep `permissions: contents: read` at the top, never use `pull_request_target`, never give a secret or `id-token` to a job that runs for a pull request, and keep `persist-credentials: false` on every checkout. `security/test_workflows.py` enforces these, and actionlint (the pinned image in `ci.yml`) checks syntax and shell. After any workflow change run both.
- `queue: max` under `concurrency` is valid on GitHub even though the pinned actionlint rejects it. Do not remove it to silence the linter: the release queue depends on it.
- `release/push-image.sh` is the part of a release that cannot be tried on a real release. Any change to it, `automatic.py` or `assets.sh` must pass `python -m unittest discover -s release` and `bash release/test_push_image.sh` (needs Docker; it starts a throwaway registry and builder). Mutate the script's rules after changing it: a refusal that comes from a later check hides a missing early one.
- Shell and Python scripts must have LF line endings (`.gitattributes` enforces it). A CRLF breaks them on Linux. When copying a script from a sibling repository on Windows, look for carriage returns before you trust it (for example `grep -c "$(printf '\r')" script.sh`).
- The deployment bundle (`deploy/ai-watch-web-deploy/`): `install.sh` and `install.ps1` must behave the same, with the same messages (the tests grep them). Any change to one needs the other, then `npm run test:deploy` (Docker) and, on Windows, `npm run test:deploy:windows`. Both tests start real containers.
  - The server token goes only into `secrets/monitor_key`. Never into `.env`, an environment variable, a log, the output or a command line. A login password goes to `docker` and `curl` through standard input (`-K -`), never as an argument.
  - Nothing is overwritten without a word: an existing `.env`, secret, `server/config.local.json` or `secrets/htpasswd` is kept, and a different token is refused. Check every input in the preflight block **before** the first write, so a refused run leaves nothing behind.
  - The bundle template is `env.example` and not `.env.example`: the permission settings of this project deny writing `.env*` files. Do not work around that.
  - Git Bash on Windows: `curl` and `python` are native Windows programs, so a `/tmp/...` path only works while path conversion is on. Do not export `MSYS_NO_PATHCONV=1` globally, set it only on a `docker` command that passes a container path, and read curl headers from standard output (`-D -`) instead of a temp file.
  - PowerShell: `"$files:x"` is a drive-qualified variable, write `"${files}:x"`. Under `$ErrorActionPreference = 'Stop'`, Windows PowerShell 5.1 turns the stderr of a native command into an exception. Piping a string appends a newline, so a password hash goes through a `Process` with standard input written exactly. `Get-FileHash` can be missing in a session started from another shell: use .NET.
  - `docker compose up` recreates a container only when its image or configuration changed. `--update` with nothing new to pull leaves it alone; `--force` recreates.
- Benchmarks (`benchmarks/`, `npm run bench:load|page|soak`) are measurements, not gates: they need Docker and the image `ai-watch-web:bench` (`docker build -f docker/Dockerfile --build-arg VERSION=bench -t ai-watch-web:bench .`), and results go to the git-ignored `benchmarks/results/`. The numbers that are published live in `docs/PERFORMANCE.md` with the date and the machine. Do not run two at once, and do not run anything heavy during a soak: it measures CPU and memory. A soak sample reads the JavaScript heap **after** forcing a garbage collection, otherwise it measures the collector's timing.
- `docs/` pages state facts checked against the code. When a document says what the code does, check it by reading or running it (a document once named an RxJS operator the code does not use). Keep the claim list in `docs/TESTING.md` ("Known gaps") honest.
- **Scripted edits of text that contains `$`:** JavaScript's `String.replace(from, "text")` expands `` $` ``, `$'`, `$&` and `$1` in the new text, so a shell snippet such as `"$6$"` or `grep -c $'\r'` silently copies half the file into itself (it corrupted `install.ps1`, `MEMORY.md` and `CLAUDE.md`, each found only later). Use `s.replace(from, () => to)`, check that `from` matches exactly once, and look for a duplicated first heading afterwards. `String.raw` still interprets `${`; the Edit and Write tools do not have either problem.
- The first release is `v0.1.0`, declared by `CHANGELOG.md`. Add a `## [X.Y.Z]` heading to it when a release should skip ahead.
- Do not commit secrets, `.env` files, `secrets/` contents or tokens.
- Do not run `pull_request_target` workflows against untrusted code and do not expose secrets to pull requests.

## Git

- Conventional Commits, for example `feat(core): add status poller`.
- Do not add `Co-Authored-By` lines or any AI attribution to commits or pull request descriptions.
- Do not push, open pull requests or merge unless the owner asks.
- Keep commits reviewable (about 400 changed lines), with tests and docs alongside the behaviour.

## Working with this repo

- Resume from `MEMORY.md`, then check the roadmap phase in `README.md`.
- When you make an architectural decision, add it to `MEMORY.md` with its reason. When you change a command, option or message, update the help text and docs.
- Keep answers short. Ask one question at a time, only for a real product decision, then wait.
