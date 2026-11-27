// Summarises a soak run (benchmarks/results/soak-*.jsonl): is anything growing?
//
//   node benchmarks/summarize.mjs [file]       (default: the newest soak file)
//
// For each page it fits a straight line to the heap after the first two minutes (the app is still starting up before
// that) and reports how many MiB an hour it rises, and what that would be over 24 hours if the line continued. A
// line with a small slope and a poor fit is noise around a flat value, which is what a healthy page looks like.
import fs from 'node:fs';
import path from 'node:path';
import { root } from './stack.mjs';

const dir = path.join(root, 'benchmarks', 'results');
const file =
  process.argv[2] ??
  fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('soak-'))
    .sort()
    .at(-1);
const rows = fs
  .readFileSync(
    path.resolve(file.includes(path.sep) || file.includes('/') ? file : path.join(dir, file)),
    'utf8',
  )
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function fit(xs, ys) {
  const mx = mean(xs),
    my = mean(ys);
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = sxx ? sxy / sxx : 0;
  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (my + slope * (xs[i] - mx))) ** 2, 0);
  return { slopePerSecond: slope, r2: ssTot ? 1 - ssRes / ssTot : 0 };
}
const p95 = (a) =>
  [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
const warmUpSeconds = 120;

const out = {
  file: path.basename(file),
  minutes: Math.round(Math.max(...rows.map((r) => r.t)) / 60),
  pages: {},
};
for (const page of [...new Set(rows.map((r) => r.page))]) {
  const all = rows.filter((r) => r.page === page);
  const r = all.filter((x) => x.t >= warmUpSeconds);
  const t = r.map((x) => x.t);
  const series = (key) => r.map((x) => x[key]);
  const heap = fit(t, series('heapMiB'));
  // A page warms up (compiled code, caches), so the straight line over the whole run overstates a late rise. The last
  // twenty minutes are the rate to extrapolate from.
  const tail = r.filter((x) => x.t >= Math.max(...t) - 1200);
  const lateFit = fit(
    tail.map((x) => x.t),
    tail.map((x) => x.heapMiB),
  );
  const late = {
    slopeMiBPerHour: +(lateFit.slopePerSecond * 3600).toFixed(3),
    projectedGrowthIn24hMiB: +(lateFit.slopePerSecond * 86400).toFixed(1),
    r2: +lateFit.r2.toFixed(3),
  };
  const nodes = fit(t, series('nodes'));
  const edge = (key, n = 5) => ({
    first: +mean(series(key).slice(0, n)).toFixed(2),
    last: +mean(series(key).slice(-n)).toFixed(2),
  });
  out.pages[page] = {
    samples: all.length,
    heapMiB: {
      ...edge('heapMiB'),
      min: Math.min(...series('heapMiB')),
      max: Math.max(...series('heapMiB')),
      slopeMiBPerHour: +(heap.slopePerSecond * 3600).toFixed(3),
      projectedGrowthIn24hMiB: +(heap.slopePerSecond * 86400).toFixed(1),
      r2: +heap.r2.toFixed(3),
      lastTwentyMinutes: late,
    },
    domNodes: {
      ...edge('nodes'),
      min: Math.min(...series('nodes')),
      max: Math.max(...series('nodes')),
      slopePerHour: +(nodes.slopePerSecond * 3600).toFixed(1),
    },
    eventListeners: {
      ...edge('listeners'),
      min: Math.min(...series('listeners')),
      max: Math.max(...series('listeners')),
    },
    documents: Math.max(...series('documents')),
    mainThreadBusyPct: {
      mean: +mean(series('busyPct')).toFixed(2),
      p95: +p95(series('busyPct')).toFixed(2),
      max: Math.max(...series('busyPct')),
    },
    problems: all.at(-1).problems,
  };
}
const one = rows.filter((r) => r.page === rows[0].page && r.t >= warmUpSeconds);
const col = (k) => one.map((x) => x[k]);
const nginxPss = fit(
  one.map((x) => x.t),
  col('nginxPssMiB'),
);
out.nginx = {
  processes: Math.max(...col('nginxProcesses')),
  rssSumMiB: { min: Math.min(...col('nginxRssMiB')), max: Math.max(...col('nginxRssMiB')) },
  pssMiB: {
    min: Math.min(...col('nginxPssMiB')),
    max: Math.max(...col('nginxPssMiB')),
    slopeMiBPerHour: +(nginxPss.slopePerSecond * 3600).toFixed(3),
  },
  containerMemMiB: { min: Math.min(...col('webMemMiB')), max: Math.max(...col('webMemMiB')) },
  serverContainerMemMiB: {
    min: Math.min(...col('serverMemMiB')),
    max: Math.max(...col('serverMemMiB')),
  },
};
console.log(JSON.stringify(out, null, 2));
