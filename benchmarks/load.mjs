// How much the Nginx container costs, and how well its cache protects the server. It runs the image with the
// production limits (64 MB, 0.5 CPU) in front of a stand-in server that counts what it receives (tests/proxy/mock-upstream.mjs).
//
//   node benchmarks/load.mjs      (needs Docker and the image ai-watch-web:bench; takes about 2 minutes)
//
// Three things are measured:
//   1. at rest: the memory of Nginx right after it starts,
//   2. a realistic load: 12 browsers asking every 3 seconds, and how many requests reach the server,
//   3. a stress load: 64 connections asking as fast as they can, for 15 seconds.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMock } from '../tests/proxy/mock-upstream.mjs';
import { containerStats, nginxRssKiB, root } from './stack.mjs';

const image = process.env.AI_WATCH_WEB_IMAGE ?? 'ai-watch-web:bench';
const name = `aiw-bench-load-${process.pid}`;
const token = crypto.randomBytes(24).toString('hex');
const docker = (...args) =>
  spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
const mib = (kib) => +(kib / 1024).toFixed(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// CPU time the container has used so far, in microseconds, from its cgroup (docker stats has no previous sample to compare with).
const cpuUsec = () =>
  Number(
    /usage_usec (\d+)/.exec(docker('exec', name, 'cat', '/sys/fs/cgroup/cpu.stat').stdout)?.[1] ??
      NaN,
  );
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-load-'));
const keyFile = path.join(dir, 'monitor_key');
fs.writeFileSync(keyFile, token, { mode: 0o644 });
const mock = await startMock({ token });

function cleanup() {
  docker('rm', '-f', name);
  mock.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

try {
  const run = docker(
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--tmpfs',
    '/tmp:size=16m,mode=1777',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    '64m',
    '--cpus',
    '0.5',
    '--pids-limit',
    '64',
    '--add-host',
    'host.docker.internal:host-gateway',
    '-e',
    `UPSTREAM_URL=http://host.docker.internal:${mock.port}`,
    '-p',
    '127.0.0.1::8080',
    '--mount',
    `type=bind,source=${keyFile},target=/run/secrets/monitor_key,readonly`,
    image,
  );
  if (run.status !== 0) throw new Error(run.stderr);
  const port = docker('port', name, '8080/tcp').stdout.trim().split('\n')[0].split(':').pop();
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).status === 200) break;
    } catch {
      /* starting */
    }
    await sleep(500);
  }
  await sleep(1500);

  const result = { image, limits: '64 MB, 0.5 CPU', date: new Date().toISOString() };

  // 1. At rest.
  const rest = nginxRssKiB(name);
  const restStats = containerStats(name);
  result.atRest = {
    nginxProcesses: rest.processes,
    rssSumMiB: mib(rest.rssKiB),
    pssMiB: mib(rest.pssKiB),
    containerMemMiB: +restStats.memMiB.toFixed(2),
  };

  // 2. Twelve browsers, every 3 seconds, for 60 seconds.
  const clients = 12,
    seconds = 60;
  mock.requests.length = 0;
  let sent = 0,
    failed = 0;
  const stop = Date.now() + seconds * 1000;
  await Promise.all(
    Array.from({ length: clients }, async (_, i) => {
      await sleep((i * 3000) / clients); // browsers are not in step
      while (Date.now() < stop) {
        const r = await fetch(`${base}/api/status`).catch(() => null);
        sent++;
        if (!r || r.status !== 200) failed++;
        else await r.arrayBuffer();
        await sleep(3000);
      }
    }),
  );
  const upstream = mock.requests.filter((r) => r.url === '/api/status').length;
  result.realistic = {
    browsers: clients,
    seconds,
    clientRequests: sent,
    failed,
    reachedTheServer: upstream,
    perMinuteAtTheServer: +(upstream / (seconds / 60)).toFixed(1),
    perMinutePerBrowser: +(sent / clients / (seconds / 60)).toFixed(1),
  };

  // 3. Stress: 64 connections as fast as they go, for 15 seconds.
  mock.requests.length = 0;
  const latencies = [];
  let errors = 0,
    done = 0;
  const end = Date.now() + 15_000;
  const worker = async () => {
    while (Date.now() < end) {
      const t = performance.now();
      const r = await fetch(`${base}/api/status`).catch(() => null);
      if (r && r.status === 200) {
        await r.arrayBuffer();
        latencies.push(performance.now() - t);
        done++;
      } else errors++;
    }
  };
  const cpuBefore = cpuUsec();
  const startedAt = Date.now();
  const workers = Array.from({ length: 64 }, worker);
  await Promise.all(workers);
  const cpuPct = ((cpuUsec() - cpuBefore) / ((Date.now() - startedAt) * 1000)) * 100;
  latencies.sort((a, b) => a - b);
  const after = nginxRssKiB(name);
  result.stress = {
    connections: 64,
    seconds: 15,
    requests: done,
    errors,
    requestsPerSecond: Math.round(done / 15),
    latencyMs: {
      p50: +percentile(latencies, 50).toFixed(1),
      p95: +percentile(latencies, 95).toFixed(1),
      p99: +percentile(latencies, 99).toFixed(1),
      max: +latencies.at(-1).toFixed(1),
    },
    reachedTheServer: mock.requests.filter((r) => r.url === '/api/status').length,
    cpuPctOfOneCoreDuringLoad: +cpuPct.toFixed(1),
    nginxRssSumMiBAfter: mib(after.rssKiB),
    nginxPssMiBAfter: mib(after.pssKiB),
  };
  console.log(JSON.stringify(result, null, 2));
  const out = path.join(root, 'benchmarks', 'results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, `load-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify(result, null, 2),
  );
} finally {
  cleanup();
}
