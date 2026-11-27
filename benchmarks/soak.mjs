// A soak test in a real browser: the dashboard and the kiosk stay open against the real server while the data keeps
// changing, the NEEDS YOU alert opens and is acknowledged, and long tasks finish (the celebration). Every 30 seconds
// it forces a garbage collection and records the JavaScript heap, the DOM nodes and the event listeners, so a leak
// shows as a rising line. It also records the Nginx and server container memory.
//
//   node benchmarks/soak.mjs --minutes 30      (needs Docker and the image ai-watch-web:bench)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import {
  containerName,
  containerStats,
  event,
  limits,
  nginxRssKiB,
  ports,
  root,
  startStack,
  stopStack,
} from './stack.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const minutes = Number(arg('minutes', '30'));
const sampleEveryMs = Number(arg('sample-seconds', '30')) * 1000;
const outDir = path.join(root, 'benchmarks', 'results');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = path.join(outDir, `soak-${stamp}.jsonl`);

const agents = ['Claude Code', 'Codex', 'Antigravity', 'Gemini CLI'];
const projects = [
  'checkout-service',
  'billing-api',
  'docs-site',
  'ai-watch-web',
  'notes',
  'infra-scripts',
  'sandbox',
  'mobile-app',
];
const sessions = projects.map((project, i) => ({
  id: `s${i}`,
  agent: agents[i % agents.length],
  project,
}));

async function seed() {
  for (const [i, s] of sessions.entries()) {
    await event({
      agent: s.agent,
      id: s.id,
      status: i % 3 === 0 ? 'working' : i % 3 === 1 ? 'done' : 'idle',
      project: s.project,
      detail: 'Warming up',
      ago: 60 + i * 20,
    });
  }
  await limits('Claude Code', 41, 12);
  await limits('Codex', 63, 30);
}

const metricsOf = async (client) =>
  Object.fromEntries(
    (await client.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
  );

async function main() {
  console.log(
    `soak: ${minutes} min, a sample every ${sampleEveryMs / 1000} s -> ${path.relative(root, log)}`,
  );
  startStack();
  await seed();
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const views = [];
  for (const [name, url, size] of [
    ['dashboard', '/dashboard', { width: 1280, height: 800 }],
    ['kiosk', '/kiosk', { width: 800, height: 480 }],
  ]) {
    const context = await browser.newContext({ viewport: size });
    const page = await context.newPage();
    const problems = { console: 0, pageErrors: 0, failedRequests: 0 };
    page.on('console', (m) => {
      if (m.type() === 'error') problems.console++;
    });
    page.on('pageerror', () => problems.pageErrors++);
    page.on('requestfailed', () => problems.failedRequests++);
    const client = await context.newCDPSession(page);
    await client.send('Performance.enable');
    await client.send('HeapProfiler.enable');
    await page.goto(`http://127.0.0.1:${ports.web}${url}`);
    await page.waitForFunction(
      () =>
        !/Connecting/.test(
          document.querySelector('.shell-status, .k-status')?.textContent ?? 'Connecting',
        ),
    );
    views.push({ name, page, client, problems, last: await metricsOf(client), lastAt: Date.now() });
  }

  const started = Date.now();
  const end = started + minutes * 60_000;
  let stop = false;
  process.on('SIGINT', () => {
    stop = true;
  });
  let tick = 0;

  // Drives the data: one session changes every 20 s, a long task finishes every 5 min, an alert is raised and answered.
  const driver = (async () => {
    let n = 0;
    while (!stop && Date.now() < end) {
      const s = sessions[n % sessions.length];
      const statuses = ['working', 'done', 'idle', 'notice', 'error'];
      try {
        await event({
          agent: s.agent,
          id: s.id,
          status: statuses[Math.floor(n / sessions.length + n) % statuses.length],
          project: s.project,
          detail: `Step ${n}`,
        });
        if (n % 15 === 14) {
          await event({
            agent: 'Codex',
            id: 'long',
            status: 'working',
            project: 'long-task',
            detail: 'Refactoring',
            ago: 400,
          });
          await new Promise((r) => setTimeout(r, 4000));
          await event({
            agent: 'Codex',
            id: 'long',
            status: 'done',
            project: 'long-task',
            detail: 'Finished',
          });
        }
        if (n % 15 === 7) {
          await event({
            agent: 'Claude Code',
            id: 'ask',
            status: 'needs_attention',
            project: 'asks',
            detail: 'Approve the plan?',
          });
          await new Promise((r) => setTimeout(r, 6000));
          for (const v of views) {
            const ack = v.page
              .locator('dialog.alert')
              .getByRole('button', { name: 'Acknowledge' })
              .first();
            if (await ack.isVisible().catch(() => false)) await ack.click().catch(() => {});
          }
          await event({ agent: 'Claude Code', id: 'ask', status: 'idle', project: 'asks' });
        }
        if (n % 9 === 0) await limits('Claude Code', 30 + (n % 60), 10 + (n % 20));
      } catch (e) {
        console.log('driver:', String(e).slice(0, 120));
      }
      n++;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  })();

  while (!stop && Date.now() < end) {
    await new Promise((r) => setTimeout(r, sampleEveryMs));
    tick++;
    const t = (Date.now() - started) / 1000;
    const web = containerStats(containerName('web'));
    const srv = containerStats(containerName('server'));
    const rss = nginxRssKiB(containerName('web'));
    for (const v of views) {
      // The busy share of the page's main thread since the last sample, read before the garbage collection.
      const before = await metricsOf(v.client);
      const wall = (Date.now() - v.lastAt) / 1000;
      const busy = (before.TaskDuration - v.last.TaskDuration) / wall;
      await v.client.send('HeapProfiler.collectGarbage');
      const m = await metricsOf(v.client);
      v.last = m;
      v.lastAt = Date.now();
      const row = {
        t: Math.round(t),
        page: v.name,
        heapMiB: +(m.JSHeapUsedSize / 1048576).toFixed(2),
        nodes: m.Nodes,
        listeners: m.JSEventListeners,
        documents: m.Documents,
        busyPct: +(busy * 100).toFixed(2),
        nginxProcesses: rss.processes,
        nginxRssMiB: +(rss.rssKiB / 1024).toFixed(2),
        nginxPssMiB: +(rss.pssKiB / 1024).toFixed(2),
        webMemMiB: +web.memMiB.toFixed(2),
        serverMemMiB: +srv.memMiB.toFixed(2),
        problems: { ...v.problems },
      };
      fs.appendFileSync(log, JSON.stringify(row) + '\n');
      if (tick % 4 === 0)
        console.log(
          `${String(row.t).padStart(5)} s  ${v.name.padEnd(9)} heap ${row.heapMiB} MiB  nodes ${row.nodes}  listeners ${row.listeners}  busy ${row.busyPct}%  nginx ${row.nginxRssMiB} MiB (pss ${row.nginxPssMiB})`,
        );
    }
  }
  stop = true;
  await driver;
  await browser.close();
  stopStack();
  console.log('soak finished:', path.relative(root, log));
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
