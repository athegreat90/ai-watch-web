// What a page costs the browser and the network, against the real stack: how much is downloaded on a cold and on a
// warm load, how fast it paints, how many requests a minute each page makes (and a hidden tab), and how busy the
// page's main thread is when nothing is happening.
//
//   node benchmarks/page.mjs      (needs Docker and the image ai-watch-web:bench; takes about 4 minutes)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { event, limits, ports, root, startStack, stopStack } from './stack.mjs';

const base = `http://127.0.0.1:${ports.web}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  const names = [
    'checkout-service',
    'billing-api',
    'docs-site',
    'ai-watch-web',
    'notes',
    'infra-scripts',
    'sandbox',
    'mobile-app',
  ];
  for (const [i, n] of names.entries()) {
    await event({
      agent: ['Claude Code', 'Codex', 'Antigravity', 'Gemini CLI'][i % 4],
      id: `s${i}`,
      status: i % 3 === 0 ? 'working' : i % 3 === 1 ? 'done' : 'idle',
      project: n,
      detail: 'Seeded',
      ago: 100 + i * 30,
    });
  }
  await limits('Claude Code', 41, 12);
  await limits('Codex', 63, 30);
}

/** Opens a page and reports the bytes that crossed the network (compressed, as the browser received them). */
async function load(context, url) {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  const sizes = new Map();
  const kinds = new Map();
  client.on('Network.responseReceived', (e) => kinds.set(e.requestId, e.type));
  client.on('Network.loadingFinished', (e) => sizes.set(e.requestId, e.encodedDataLength));
  await page.addInitScript(() => {
    window.__paint = {};
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => {
        window.__paint[e.name] = e.startTime;
      }),
    ).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => {
      const e = l.getEntries().at(-1);
      window.__paint.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(`${base}${url}`);
  await page.waitForFunction(
    () =>
      !/Connecting/.test(
        document.querySelector('.shell-status, .k-status')?.textContent ?? 'Connecting',
      ),
  );
  const readyMs = Date.now() - t0;
  await sleep(600); // the browser hands paint timings over a little after the page is ready
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd };
  });
  const paint = await page.evaluate(() => window.__paint);
  const total = [...sizes.values()].reduce((a, b) => a + b, 0);
  const script = [...sizes]
    .filter(([id]) => kinds.get(id) === 'Script')
    .reduce((a, [, b]) => a + b, 0);
  return {
    page,
    client,
    result: {
      url,
      requests: sizes.size,
      transferKiB: +(total / 1024).toFixed(1),
      scriptKiB: +(script / 1024).toFixed(1),
      firstContentfulPaintMs: Math.round(paint['first-contentful-paint'] ?? NaN),
      largestContentfulPaintMs: Math.round(paint.lcp ?? NaN),
      domContentLoadedMs: Math.round(nav.domContentLoaded),
      loadMs: Math.round(nav.load),
      readyWithDataMs: readyMs,
    },
  };
}

async function main() {
  startStack();
  await seed();
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const out = {
    date: new Date().toISOString(),
    browser: `Chromium ${browser.version()}`,
    note: 'Desktop machine, no throttling.',
  };

  // Cold (a new profile) and warm (the same profile, files cached).
  const profile = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const cold = await load(profile, '/dashboard');
  await cold.page.close();
  const warm = await load(profile, '/dashboard');
  out.dashboardColdLoad = cold.result;
  out.dashboardWarmLoad = warm.result;
  await warm.page.close();
  await profile.close();

  // Requests a minute for each page, all open at once, and a tab that is hidden.
  const routes = ['/dashboard', '/sessions', '/limits', '/focus', '/settings', '/kiosk'];
  const views = [];
  for (const route of routes) {
    const context = await browser.newContext({
      viewport: route === '/kiosk' ? { width: 800, height: 480 } : { width: 1280, height: 800 },
    });
    const v = await load(context, route);
    v.count = 0;
    v.route = route;
    v.page.on('request', (r) => {
      if (/\/api\//.test(r.url())) v.count++;
    });
    views.push(v);
  }
  // The hidden tab: the page believes its tab is hidden.
  const hidden = await browser.newContext();
  const hp = await hidden.newPage();
  await hp.goto(`${base}/dashboard`);
  await hp.waitForFunction(
    () => !/Connecting/.test(document.querySelector('.shell-status')?.textContent ?? 'Connecting'),
  );
  let hiddenCount = 0;
  hp.on('request', (r) => {
    if (/\/api\//.test(r.url())) hiddenCount++;
  });
  await hp.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(2000);
  hiddenCount = 0;
  for (const v of views) v.count = 0;
  const cpuViews = [];
  for (const v of views) {
    await v.client.send('Performance.enable');
    const m = Object.fromEntries(
      (await v.client.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
    );
    cpuViews.push({ v, m, at: Date.now() });
  }
  await sleep(60_000);
  out.requestsPerMinute = Object.fromEntries(views.map((v) => [v.route, v.count]));
  out.requestsPerMinute['hidden tab (/dashboard)'] = hiddenCount;
  out.idleMainThreadBusy = {};
  for (const { v, m, at } of cpuViews) {
    const now = Object.fromEntries(
      (await v.client.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
    );
    const wall = (Date.now() - at) / 1000;
    out.idleMainThreadBusy[v.route] = {
      busyPct: +(((now.TaskDuration - m.TaskDuration) / wall) * 100).toFixed(2),
      scriptPct: +(((now.ScriptDuration - m.ScriptDuration) / wall) * 100).toFixed(2),
    };
  }
  out.pageResults = views.map((v) => v.result);
  console.log(JSON.stringify(out, null, 2));
  const dir = path.join(root, 'benchmarks', 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `page-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify(out, null, 2),
  );
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
