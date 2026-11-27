# Testing

What is tested, how to run it, and what is not covered. The numbers are from the last full run.

## The suites

| Suite | Command | Needs | What it proves |
|---|---|---|---|
| **Unit** (Vitest, jsdom) | `npm run test:ci` | Node | 583 tests in 48 files: parsing and type guards, polling and backoff, connection states, session ordering and local ticking, the alert timer, celebration edges, idle, focus, meeting, limits, settings, themes, every component. Coverage **94.5 % of lines, 92.3 % of branches** (`coverage/ai-watch-web/lcov.info`). |
| **Entrypoint** | `npm run test:entrypoint` | Docker | 172 checks of `docker/entrypoint.sh`: it refuses a bad key, a bad upstream, a newline in any value, and writes only what it should, with the right modes. |
| **Proxy** | `AIW_TEST_IMAGE=<image> npm run test:proxy` | Docker, a built image | 104 tests against real containers and a stand-in server: the three routes only, every other method and path blocked, the key added and the browser's own removed, the query string dropped, 401/502/504 mapped, the 1 to 2 s cache, security and cache headers, the token in no answer, no log, no process argument, the login. |
| **End to end** (Playwright, Chromium) | `npm run e2e` | Docker | 114 tests in a real browser against the real image **and the real, pinned AI Watch server release** (`compose.test.yaml`): every page, the alert, the celebration, focus, meeting, the idle robot, the kiosk at 800x480 and 1024x600, themes, demo mode, connection states, security headers, axe accessibility checks in three themes, and the **contract test** (what the app's parser assumes against the real server). About 5 minutes. |
| **Contract** | part of `npm run e2e`; alone `npm run test:contract` | a throwaway server | 14 checks of the server's real answers. It **writes data**, so it only runs against a throwaway server. |
| **Release tooling** | `npm run test:release` | Python | 17 tests: version choice, `latest` rules, what counts as a shipped file, idempotent publishing. |
| **Publication script** | `npm run test:release:registry` | Docker with buildx and QEMU | Runs `release/push-image.sh` against a throwaway registry with real multi-platform builds: immutable tags, `latest`, prereleases, malformed tags. A few minutes. |
| **Security and workflows** | `npm run test:security` | Python | 60 tests: the Trivy policy and the accepted-risk exceptions, base-image pins, the Nginx feature guard, and policy tests over the GitHub workflows (actions pinned to a SHA, least privilege, no secrets for pull requests). |
| **Installers** | `npm run test:deploy` (shell, Docker) and `npm run test:deploy:windows` (Windows PowerShell, Docker Desktop) | Docker | 9 and 7 scenarios against real containers: install, rerun, update, rollback, a different token refused, an external server, a wrong token, an unreachable server, a tampered download, no secret in any output. |
| **Static** | `npm run format:check`, `npm run lint`, `npm run typecheck` | Node | Prettier, ESLint, `tsc` for the app, the specs and `e2e/`. |

Not part of CI and not a gate: `npm run bench:*` (see `PERFORMANCE.md`).

## How the tests are written

- **Behaviour first, through the public interface.** A test asserts everything observable about the rule (output, status code, saved data), not the implementation. No test is written only to raise coverage.
- **Time is controlled.** The 2-minute alert, the 15-minute idle, the 25-minute focus timer and the backoff use fake timers (Vitest) or the Playwright clock. Timers use timestamps, never a count of interval ticks.
- **Real things at the edges.** The proxy and installer tests start real containers; the end-to-end tests use the real server image. A stand-in is used only where the real thing cannot be forced (a server that is slow or down).
- **The browser must be quiet.** The end-to-end fixture fails any test that logs a console error, a script error or a Content Security Policy violation. A test that causes one on purpose clears it and says why.
- **Every test starts clean.** The fixture restarts the server and the web container (the container has a 1 to 2 s cache), so no test sees another's data.
- **Break it on purpose.** After writing or changing a rule, break the rule and see a test fail. This found real gaps: a test that only tried a short digest, a negative test that could pass without the event happening, an assertion deleted by a scripted edit. A test that still passes with the rule broken proves nothing.

## What the tests found that reading did not

A newline in a value could have carried Nginx directives past a valid first line; the entrypoint refused every start because of an empty shell variable; the kiosk scrolled at 800x480 with real data; an installer left a half installation after a refused password; a rollback from `:latest` returned to what was already running. Each has a test now.

## Writing a new test

1. Put a unit test next to the code (`x.spec.ts`), with the helpers in `src/app/testing/` (they are not in the app build).
2. A page-level behaviour that needs a real server goes in `e2e/`, using the helpers in `e2e/support/` (`event`, `limits`, `seedMix`, `open`).
3. A rule of the image goes in `tests/proxy/proxy.test.mjs`; a rule of the entrypoint in `docker/test/entrypoint.test.sh`.
4. Run it, break the rule, see it fail, restore it.

## Known gaps

- **Browsers:** only Chromium. No Firefox or WebKit.
- **Screens:** no end-to-end pass at 400 px (phone) and no visual snapshot per theme.
- **Hardware:** nothing has run on a real Raspberry Pi, a tablet or a long-lived screen; the arm64 image was run under emulation only.
- **Linux and macOS installers:** the installer tests ran on Windows with Docker Desktop. Linux is covered by the `deploy` CI job, which has not run yet. The CRLF handling of `.env` and the exec bit of the zip can only be checked on Linux.
- **PowerShell 7:** only parsed, not run.
- **GitHub:** none of the workflows has run on GitHub, and SonarQube has never analysed the project.
- **Soak:** 45 minutes in a browser, not the 24 hours of the target.
- **`ng lint` does not lint `e2e/`**, `tests/` or `benchmarks/`; `tsc` checks `e2e/` only.
