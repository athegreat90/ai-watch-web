// Takes two heap snapshots of the dashboard a few minutes apart (after a garbage collection each) and lists what grew,
// by kind of object. Use it when the soak shows the heap rising: it says what is being kept.
//
//   node benchmarks/heap-diff.mjs --minutes 5
import { chromium } from '@playwright/test';
import { event, limits, ports, startStack, stopStack } from './stack.mjs';

const minutes = Number(process.argv[process.argv.indexOf('--minutes') + 1] || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapshot(client) {
  await client.send('HeapProfiler.collectGarbage');
  const chunks = [];
  const onChunk = (e) => chunks.push(e.chunk);
  client.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  client.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  return JSON.parse(chunks.join(''));
}

/** Total size and count of the objects, grouped by "type:name" (for example "object:Subscriber", "closure:tick"). */
function summarise(snap) {
  const f = snap.snapshot.meta.node_fields;
  const stride = f.length;
  const iType = f.indexOf('type'),
    iName = f.indexOf('name'),
    iSize = f.indexOf('self_size');
  const types = snap.snapshot.meta.node_types[0];
  const groups = new Map();
  for (let i = 0; i < snap.nodes.length; i += stride) {
    const key = `${types[snap.nodes[i + iType]]}:${snap.strings[snap.nodes[i + iName]]}`.slice(
      0,
      90,
    );
    const g = groups.get(key) ?? { count: 0, bytes: 0 };
    g.count++;
    g.bytes += snap.nodes[i + iSize];
    groups.set(key, g);
  }
  return groups;
}

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send('HeapProfiler.enable');
  await page.goto(`http://127.0.0.1:${ports.web}/dashboard`);
  await page.waitForFunction(
    () => !/Connecting/.test(document.querySelector('.shell-status')?.textContent ?? 'Connecting'),
  );
  await sleep(90_000); // past the start-up
  const before = summarise(await snapshot(client));
  await sleep(minutes * 60_000);
  const after = summarise(await snapshot(client));
  const rows = [];
  for (const [key, a] of after) {
    const b = before.get(key) ?? { count: 0, bytes: 0 };
    if (a.bytes - b.bytes > 0 || a.count - b.count > 0)
      rows.push({
        kind: key,
        addedObjects: a.count - b.count,
        addedKiB: +((a.bytes - b.bytes) / 1024).toFixed(1),
      });
  }
  rows.sort((x, y) => y.addedKiB - x.addedKiB);
  console.log(`after ${minutes} minutes (one tick a second = ${minutes * 60} ticks), what grew:`);
  console.table(rows.slice(0, 15));
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
