// Finds what makes the JavaScript heap rise, by running the same page in four ways at once against unchanging data:
//   fast   polls every 1 second   (3x the default rate)
//   normal polls every 3 seconds  (the default)
//   slow   polls every 60 seconds (almost never) but is visible, so the one-second clock still ticks
//   hidden polls nothing and ticks nothing (the tab is hidden)
// If the rise follows the polling rate, something is kept for every request. If it follows the clock, it is the
// one-second tick. If even `hidden` rises, it is the browser or the measurement.
//
//   node benchmarks/leak-probe.mjs --minutes 8
import { chromium } from '@playwright/test';
import { event, limits, ports, startStack, stopStack } from './stack.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const minutes = Number(arg('minutes', '8'));
const everyMs = 15_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${ports.web}`;

async function main() {
  startStack();
  for (const [i, p] of [
    'checkout-service',
    'billing-api',
    'docs-site',
    'ai-watch-web',
    'notes',
    'infra-scripts',
  ].entries()) {
    await event({
      agent: ['Claude Code', 'Codex'][i % 2],
      id: `s${i}`,
      status: i % 3 === 0 ? 'working' : 'idle',
      project: p,
      detail: 'Static',
      ago: 100 + i * 30,
    });
  }
  await limits('Claude Code', 41, 12);
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const variants = [
    { name: 'fast', pollIntervalMs: 1000 },
    { name: 'normal', pollIntervalMs: 3000 },
    { name: 'slow', pollIntervalMs: 60_000 },
    { name: 'hidden', pollIntervalMs: 3000, hidden: true },
  ];
  for (const v of variants) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(
      (ms) =>
        localStorage.setItem(
          'aiw.settings',
          JSON.stringify({ pollIntervalMs: ms, sound: false, notifications: false }),
        ),
      v.pollIntervalMs,
    );
    v.page = await context.newPage();
    v.client = await context.newCDPSession(v.page);
    await v.client.send('HeapProfiler.enable');
    await v.client.send('Performance.enable');
    v.requests = 0;
    v.page.on('request', (r) => {
      if (/\/api\//.test(r.url())) v.requests++;
    });
    await v.page.goto(`${base}/dashboard`);
    await v.page.waitForFunction(
      () =>
        !/Connecting/.test(document.querySelector('.shell-status')?.textContent ?? 'Connecting'),
    );
    if (v.hidden) {
      await v.page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    v.samples = [];
  }
  const started = Date.now();
  while (Date.now() - started < minutes * 60_000) {
    await sleep(everyMs);
    const t = (Date.now() - started) / 1000;
    for (const v of variants) {
      await v.client.send('HeapProfiler.collectGarbage');
      const m = Object.fromEntries(
        (await v.client.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
      );
      v.samples.push({
        t,
        heap: m.JSHeapUsedSize / 1048576,
        nodes: m.Nodes,
        listeners: m.JSEventListeners,
      });
    }
  }
  const report = {};
  for (const v of variants) {
    const s = v.samples.filter((x) => x.t >= 60);
    const n = s.length,
      mx = s.reduce((a, x) => a + x.t, 0) / n,
      my = s.reduce((a, x) => a + x.heap, 0) / n;
    const slope =
      s.reduce((a, x) => a + (x.t - mx) * (x.heap - my), 0) /
      s.reduce((a, x) => a + (x.t - mx) ** 2, 0);
    report[v.name] = {
      requests: v.requests,
      requestsPerMinute: +(v.requests / minutes).toFixed(1),
      heapStartMiB: +s[0].heap.toFixed(2),
      heapEndMiB: +s.at(-1).heap.toFixed(2),
      slopeKiBPerMinute: +(slope * 60 * 1024).toFixed(1),
      nodes: [s[0].nodes, s.at(-1).nodes],
      listeners: [s[0].listeners, s.at(-1).listeners],
    };
  }
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  stopStack();
}

main().catch((e) => {
  console.error(e);
  try {
    stopStack();
  } catch {
    /* nothing to stop */
  }
  process.exit(1);
});
