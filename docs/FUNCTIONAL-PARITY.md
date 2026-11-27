# Functional parity

What the AI Watch firmware does, what the web app does in its place, and how each item is tested. Everything marked "verified" was read in the firmware or server source. Items marked **new** are not firmware behaviour.

## Sources

| Repository | Analysed `main` head | Files |
|---|---|---|
| ai-watch-firmware | `97bb7c9` (2026-11-22) | `firmware/AIWatch/AIWatch.ino` (INO), `AlertTimer.h`, `FocusTimer.h`, `config.example.h`, `tests/*.cpp`, `docs/SCREENS.md` |
| ai-watch-server | `a495671` (2026-11-26) | `internal/httpapi/handler.go`, `internal/monitor/monitor.go`, `docs/API.md` |
| ai-watch-hooks | `646f476` (2026-11-26) | `bridge/hook.py`, `bridge/limits.py` |

**Check of the local copies (2026-11-26).** The analysis ran on local copies. Their files were compared with the GitHub `main` trees by git blob hash, after removing carriage returns, skipping the firmware `vendor/` folder. Server 125 of 126 files, firmware 26 of 26, hooks 40 of 41 were identical. The one remaining file in each of the server and hooks is `security/test_upsert_issue.sh`. It differs only by a literal carriage-return character inside the script that the comparison itself removes, so the content is the same. The copies were therefore current at the time of the check. GitHub heads can move, so re-run the comparison before relying on this later.

## Parity matrix

Phase = the roadmap phase that builds it.

| ID | Firmware behaviour (verified) | Source | Web equivalent | Browser limit | Required tests | Phase |
|---|---|---|---|---|---|---|
| P01 | Polls only `GET /api/status`. The wait of 3000 ms starts after each fetch ends. Only header `X-Monitor-Key`. | INO:376-386, 37-39, 447 | Shared poller, 3 s after completion, through the Nginx proxy. | The browser never sends the key. | Fake-timer unit tests. Integration with a mocked backend. | 3 |
| P02 | Timeouts 1200 ms connect and 1500 ms read (4000 ms on HTTPS). No retries. A new attempt every poll. Wi-Fi reconnect every 10 s while offline. | INO:378-379, 437-440 | Timeout 4 s. Backoff 3, 6, 12, 24, 30 s with jitter. | None | Unit: backoff, jitter bounds, reset on success. | 3 |
| P03 | Status must be 200 with `Content-Length` 1 to 12288. More than 8 sessions, or a row without `session_id`, `agent` or string `status`, is rejected. Non-200 clears sessions and limits. | INO:390-400, 422 | Type guards reject the same rows. On failure the last good data stays on screen, marked stale, instead of being cleared. | The `Content-Length` rule is not applicable. | Unit: guard accepts and rejects each case. | 3 |
| P04 | 401 shows "Backend: check token". Any other non-200 shows "Backend offline". | INO:304-307 | 401 with `X-AIW-Upstream-Status: 401` means "proxy token rejected". 401 without it means dashboard login. 502, 504 and timeouts mean offline. | Two 401 sources exist because of the proxy. | Integration with the Nginx proxy. | 3, 8 |
| P05 | Session identity is the pair (agent, `session_id`). | INO:183, 590-591, 604, 618 | Composite key built from both fields. | None | Unit | 3 |
| P06 | Order comes from the server only. Firmware does not sort. | INO:320 | Server order kept. Never re-sorted. | None | Contract test with a fixture that exercises every status. | 4 |
| P07 | Six statuses. Unknown values display as Idle. Labels: Needs you, Working, Completed, Error, Notification, Idle. | INO:142-157 | Same labels and mapping. Colours from the theme tokens. | None | Unit | 4 |
| P08 | Home shows only `sessions[0]`. Sessions screen shows up to 4 rows per page from at most 8. | INO:320, 475-480 | Dashboard lists all sessions from `/api/status`. A Sessions page lists up to 40 from `/api/sessions`. | **New:** the firmware never calls `/api/sessions`. | Contract, E2E | 4 |
| P09 | Detail screen with an Acknowledge button. If the selected session disappears, Detail closes. | INO:321, 495-504, 615-622 | Detail view with the same fallback. | None | E2E | 4 |
| P10 | NEEDS YOU overlay for a `needs_attention` session that is not acknowledged. Shows project, agent, detail, waiting time. | INO:189-196, 215-229 | Overlay with the same content. Stacks for several sessions. | Audio needs a user gesture. Notifications need a secure context. | E2E | 5 |
| P11 | The alert repeats every 120 s. It resets completely when attention clears. | `AlertTimer.h:6,14-16` | Same logic, ported. | None | Unit and E2E with a fake clock. | 5 |
| P12 | A tap only hides the overlay. The session is not acknowledged and the alert returns 120 s later. | INO:465 | Same. | None | E2E | 5 |
| P13 | Acknowledge is keyed by (id, agent, `updated`). It holds 8 entries and is lost on reboot. A new event re-arms the alert. | INO:107-111, 181-187, 499-503 | Same key, kept in `sessionStorage`. No acknowledgement is sent to the server, because none exists. | None | Unit | 5 |
| P14 | Celebration when the same agent and id go from working to done between two polls, `finished_long` is true and meeting is off. Lasts 4000 ms. Ends early on touch. | INO:600-612, 44, 639 | Same edge detection. Plus a Set keyed (agent, id, `started`) to stop repeats. Under reduced motion the same message shows without the confetti animation. | None | Unit and E2E | 5 |
| P15 | The 5-minute threshold lives on the server (`LONG_TASK_SECONDS = 300`). The firmware reads only the boolean. | SRV:24, 117 | Reads `finished_long`. Does not recompute it. | None | Contract | 5 |
| P16 | If the working state is never seen, there is no celebration. During meeting mode a finish is skipped for good. | INO:600-612 | Same. After an error, or a gap of more than three poll intervals, the previous snapshot is forgotten, like the firmware, which clears its sessions on an error. | None | Unit | 5 |
| P17 | Limits for Claude Code, Codex, Antigravity. Bars for 5h and 7d, amber at 70 %, red at 90 %. Values clamped to 0 to 100. | INO:275, 250-264 | Same agents and thresholds. Remaining = 100 minus used (derived). | None | Unit | 5 |
| P18 | A limit row shows only when both windows exist. No rows means "No limit data yet". The server drops readings older than 15 minutes. | INO:279, 284 | Same. Never invents values. | None | Unit | 5 |
| P19 | `resets_in` is shown as sent at the last poll, with no local countdown. | INO:250-264 | Local countdown from fetch time on a monotonic clock. | Avoids clock skew between browser and server. | Unit | 5 |
| P20 | Focus timer, 25 minutes. Start, pause, resume, reset. Shown on Home and Focus. Independent of the server. | `FocusTimer.h:11,17-23`, INO:358, 361 | Same, based on timestamps stored in `localStorage`, so a hidden tab does not drift. | Timers in hidden tabs are throttled, which is why timestamps are used. | Unit and E2E | 6 |
| P21 | Completion shows "Focus complete" in green. No sound and no alert. | INO:169-170 | Same. **New, built in phase 7:** optional tone and desktop notification, off by default, set in Settings. | Audio and notifications need a gesture or a secure context. | Unit | 6 |
| P22 | Meeting is on when set manually or while the focus timer runs. Brightness drops to 40. Alert and celebration are suppressed. A "Meeting" badge is muted, or amber when attention is pending. | INO:179, 309, 606, 634, 640, 656 | Same signal. Dimming is simulated by lowering content opacity. | The browser cannot change hardware brightness. | Unit and E2E | 6 |
| P23 | Meeting mode does **not** suppress the idle robot. | INO:641 | Same. | None | E2E | 6 |
| P24 | Idle robot after 15 minutes without activity, and only if no session needs attention. Activity: a touch, a session change, an alert appearing. Limit and duration ticks do not count. | INO:41, 463, 593, 614, 635, 641 | Same triggers and exits, using pointer, key and touch events. | None | E2E with a fake clock. | 6 |
| P25 | Offline preview when `config.h` is missing: shows "Wi-Fi offline", "Backend offline", "Disconnected". No mock data. | INO:28-33, 561-563 | Real offline and stale states, shown clearly. **New:** a separate Demo mode with fixed example data, only when the user turns it on. | None | Unit and E2E | 3, 7 |
| P26 | Configuration is compile-time only: `WIFI_SSID`, `WIFI_PASSWORD`, `BRIDGE_URL`, `MONITOR_TOKEN`, and optionally `POLL_INTERVAL_MS` and `IDLE_MS`. | `config.example.h` | Runtime `/config.json` for non-secret values. The token stays in the Nginx secret. | None | Integration | 8 |
| P27 | Touch is edge-triggered on finger down. A touch while an overlay is up only dismisses the overlay. No swipe or gestures. | INO:458, 464-469 | The same rule for pointer input. | None | E2E | 5 |

## Hardware features with no browser equivalent

| Firmware feature | Source | Web alternative |
|---|---|---|
| AMOLED panel, QSPI driver, I/O expander reset | INO:526-535 | AMOLED theme (true black) and a kiosk layout. |
| Touch controller with init retries | INO:537-543 | Pointer and touch events, 48 px targets. |
| Hardware brightness (165 normal, 40 in meeting; "Light" button cycles 165, 215, 65, 115) | INO:472, 656 | Simulated dimming. No brightness control. |
| Wi-Fi station mode, reconnect, NTP | INO:431, 437-440 | The browser's own connectivity. Offline state and recovery. |
| Burn-in handling | n/a | Best-effort pixel shift and the idle robot. No guarantee. |
| USB serial log (`Screen:`, `Alert:`, `Celebrate:`, `Limits:`, `Meeting:`, `Overlay:`) | INO | Browser console is not part of the product. |

## New in the web app (not in the firmware)

Demo mode, optional focus-timer sound and notification, the full Sessions page backed by `/api/sessions`, a dashboard that lists more than one session, the three themes, the kiosk layout, and local ticking of `duration`, `waiting` and `resets_in`.

## Not in the firmware

No buzzer, battery readout, OTA, Wi-Fi provisioning, persistence (acknowledgements, brightness and meeting state are lost on reboot), calls to `/health` or `/api/sessions`, demo data, local sorting, stale-data timers, or local ticking of `waiting`, `duration` and `resets_in`.

## Discrepancies between firmware, server and docs

| Item | Detail | Decision |
|---|---|---|
| Alert dismissal | `docs/SCREENS.md` says the alert repeats until you tap or acknowledge. Code: a tap only hides it temporarily. | Follow the code (P12). |
| Limit agents | `docs/API.md:39` lists two agents. The server accepts three (`monitor.go:247`) and the firmware shows three. | Follow the code (P17). |
| Firmware version | The boot banner says 1.1.0 (INO:522). `CHANGELOG.md` says 1.1.1. | Not relevant to the web app. |
| Other agents | The server accepts any `agent` string for sessions. The hooks also send "Gemini CLI" and "GitHub Copilot CLI". The firmware knows only the three limit agents for limits. | Generic agent fallback for sessions. Limits only for the three. |
| Firmware tests | Only `AlertTimer` and `FocusTimer` have tests, compiled with `g++ -fsyntax-only` and checked by `static_assert`. Network, celebration, idle, meeting and limits have none. | The web tests are the first tests for these behaviours, so expected values come from the source, not from existing tests. |

## Not verified

Nothing was flashed or run on hardware. The firmware `MEMORY.md` records that a standalone HTTPS build has not been flash-tested. Firmware vendor libraries, the Hello and VerifyRevision sketches and the release and security scripts were not read.
