# Performance

The targets set in the plan, what was measured against each, and how to repeat it. These are measurements, not promises, and the last column says what each one does **not** show.

**Where:** one desktop PC (Intel Core Ultra X7 358H, 16 cores, 32 GB) with Docker Desktop 29.9.3 and Chromium 159 (Playwright), no throttling, on 2026-11-27. **No Raspberry Pi and no real phone or tablet was measured.** Everything ran against the real AI Watch server release v1.1.4 and the real image, except the load test, which uses a stand-in server so it can count what reaches it.

## Against the targets

| Target | Result | Verdict | What it does not show |
|---|---|---|---|
| Compressed image at most 30 MB | **27.8 MB** (amd64), **28.4 MB** (arm64) | Met | Sizes from `docker save` piped through `gzip`; a registry's own compression differs a little. |
| Initial JavaScript at most 150 KB gzip | **92.9 KB** initial bundle (`ng build`); **116 KiB** of script crosses the network for the dashboard, which includes its lazy chunk | Met | |
| Nginx at most 20 MB RSS | **15.6 to 15.9 MiB** at rest and 13.0 MiB after a stress load, **adding up every process's RSS**, which counts shared pages once per process. The **proportional size (PSS) is 7.3 to 7.7 MiB**, and the container as Docker counts it is 4.7 to 9.5 MiB | Met | |
| Browser heap at most 120 MB | **5.5 MiB** at most, in 45 minutes (JavaScript heap after a garbage collection) | Met | It is the JavaScript heap of one page, not the whole browser process. |
| At most 20 requests a minute per client | **20** on the dashboard, limits, focus, settings and kiosk pages; **0** in a hidden tab; **30 on the Sessions pages** (40 before the list was slowed to twice the interval) | **Missed on Sessions** | See below. |
| Idle CPU under 3 % on a Raspberry Pi 4 kiosk | **0.16 to 0.18 %** of the page's main thread for the kiosk (0.09 to 0.27 % on the other pages, two runs) on the PC above | **Open** | A Pi 4 was not measured, and it is far slower than this PC. The number says the page does almost nothing when idle, not what the Pi will show. |
| A 24-hour soak with a flat heap | **45 minutes**, not 24 hours. The heap rose from 4.2 to 5.4 MiB: fast in the first 10 minutes, then about **0.4 to 0.6 MiB an hour and slowing**. DOM nodes and event listeners stayed flat | **Not demonstrated** | See below. |

### The Sessions pages make 30 requests a minute, not 20

The shell always polls `/api/status` (the connection state, the alert and the counters need it on every page), and the Sessions pages also poll `/api/sessions` for the full list (up to 40). Measured first, that was **40 a minute**, twice the target. The owner chose to poll the list at **twice the interval** (6 s by default, `LIST_INTERVAL_FACTOR` in `sessions-feed.ts`), which makes **30 a minute**: 20 for the status and 10 for the list. The target of 20 is therefore **still missed on those pages**, by half as much. Getting to 20 would mean the shell stops polling the status while the list is open and reads the list's answer instead (`/api/sessions` returns the same snapshot, with up to 40 sessions instead of 8, the same counters and the same limits). That makes the alert and the connection state of every page depend on which page is open, so it was not done.

It does not load the server much either way: the Nginx cache answers repeats, and 12 browsers on `/api/status` cost the server 31 requests a minute in total (below). A user's own interval from Settings is doubled for the list too, and "stale" for the list counts three of its own intervals (18 s by default), so it does not show stale between two of its own requests. The unit tests of `SessionsFeed` and an end-to-end test measure the rate.

### The heap in the soak

In 5-minute slices, the dashboard's average heap was 4.16, 4.80, 4.99, 5.10, 5.18, 5.29, 5.34, 5.37 and 5.43 MiB. A straight line over the last 20 minutes gives **0.6 MiB an hour** for the dashboard and **0.44** for the kiosk, which would be 10 to 14 MiB more after a day if it did not slow down, far under 120 MiB. Where it comes from was checked, because a steady rise is not noise:

- **Four copies of the page in parallel (`benchmarks/leak-probe.mjs`):** the rise was the same with 20 requests a minute (62 KiB a minute) as with 1 a minute (65 KiB a minute), so it does not follow the polling. A tab that was hidden, with no clock tick and no polling, did not rise at all (0). It follows the page being visible and ticking.
- **Two heap snapshots 5 minutes apart (`benchmarks/heap-diff.mjs`):** no object of the app grew. What grew was V8's compiled code (the page being optimised while it runs), internal browser structures, and the browser's records of network requests (a capped buffer of 250 for resource timing, and records the automation itself keeps).

So it looks like warm-up and bounded browser bookkeeping, not a leak in the app. **That is a reading of 45 minutes, not a proof of 24 hours.** The honest statement is: no leak was found, the rise was slowing, and the budget has a lot of room; running the soak for a day (`npm run bench:soak -- --minutes 1440`) is what would settle it.

## What else was measured

**Cost of the container** (64 MB and 0.5 CPU, the production limits, `benchmarks/load.mjs`):

| | Result |
|---|---|
| Memory at rest | 3 to 4 Nginx processes; 15.6 MiB RSS added up, 7.4 MiB PSS, 5.9 to 7.1 MiB for the container |
| 12 browsers, one request every 3 s each, for 60 s | 240 requests from the browsers, **31 reached the server** (the 1 to 2 s cache), 0 failures |
| 64 connections as fast as they go, for 15 s | **4,300 to 4,750 requests a second**, no errors, latency p50 9.8 ms, p95 about 40 ms, p99 about 47 ms, and only 8 requests reached the server. The container used 49.6 % of a core, which is its 0.5 CPU limit, so that is its ceiling. The load generator and Docker Desktop's port forwarding are part of what is measured. |
| Memory after that stress | 13.0 MiB RSS, 7.2 MiB PSS |

Twelve browsers on the dashboard are about 4 requests a second, around a thousandth of what one container serves.

**Cost of a page** (`benchmarks/page.mjs`, Chromium, no throttling):

| | Cold (empty cache) | Warm (files cached) |
|---|---|---|
| Downloaded | **142 KiB** in 10 requests (116 KiB script) | **3.8 KiB** |
| DOMContentLoaded | 73 to 85 ms | 69 ms |
| First and largest contentful paint | 120 to 156 ms | 116 ms |
| Ready with data on screen | 107 to 138 ms | 98 ms |

The hashed files are cached for a year (`immutable`), so a repeat visit only fetches `index.html`, `theme-init.js`, `config.json` and the data. On a real network the numbers add the round trips: this was on one machine.

**The 45-minute soak itself:** the dashboard and the kiosk stayed open against the real server while a session changed every 20 s, a long task finished every 5 minutes (the celebration), and an alert was raised and acknowledged. No console error, no script error and no failed request in either page. Main-thread busy 0.34 % (dashboard) and 0.24 % (kiosk) on average, 0.62 % and 0.49 % at the 95th percentile. Nginx stayed at 13.5 MiB RSS and 7.5 MiB PSS with no growth (0.03 MiB an hour).

## Repeat it

You need Docker and the image `ai-watch-web:bench`:

```sh
docker build -f docker/Dockerfile --build-arg VERSION=bench -t ai-watch-web:bench .
npm run bench:load                          # about 2 minutes
npm run bench:page                          # about 4 minutes
npm run bench:soak -- --minutes 45          # the soak, then: node benchmarks/summarize.mjs
node benchmarks/leak-probe.mjs --minutes 8  # which way the heap rises: polling, clock, or nothing
node benchmarks/heap-diff.mjs --minutes 5   # what grew, by kind of object
```

Results go to `benchmarks/results/` (git-ignored). Do not run two at once or do anything heavy meanwhile: they measure CPU and memory. A soak sample reads the heap after forcing a garbage collection, otherwise it measures when the collector happens to run.

## How the soak summary reads the numbers

`benchmarks/summarize.mjs` skips the first 2 minutes (the page is starting up) and fits a straight line to the rest, but it also fits the **last 20 minutes on their own**, because a page warms up and a line over the whole run overstates a late rise. That second number is the one to extrapolate from.
