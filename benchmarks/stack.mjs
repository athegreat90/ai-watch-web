// Shared by the benchmarks: the same real stack as the end-to-end tests (the pinned AI Watch server release and
// the web image, compose.test.yaml), on ports of its own so it can run next to the end-to-end tests.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runDir = path.join(root, 'e2e', '.run');
export const ports = { server: 18795, web: 18190, badToken: 18191 };
export const project = 'aiw-bench';
let token = '';

function compose(args, timeout = 300_000) {
  const env = {
    ...process.env,
    COMPOSE_PROJECT_NAME: project,
    E2E_SERVER_PORT: String(ports.server),
    E2E_WEB_PORT: String(ports.web),
    E2E_BADTOKEN_PORT: String(ports.badToken),
    AI_WATCH_WEB_IMAGE: process.env.AI_WATCH_WEB_IMAGE ?? 'ai-watch-web:bench',
  };
  return spawnSync('docker', ['compose', '-f', path.join(root, 'compose.test.yaml'), ...args], {
    encoding: 'utf8',
    timeout,
    env,
    cwd: root,
  });
}

export function startStack() {
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(runDir, 'monitor_key'), token, { mode: 0o644 });
  fs.writeFileSync(path.join(runDir, 'bad_key'), crypto.randomBytes(24).toString('hex'), {
    mode: 0o644,
  });
  fs.writeFileSync(
    path.join(runDir, 'server-config.json'),
    JSON.stringify({ url: 'http://127.0.0.1:8765', token }),
    { mode: 0o644 },
  );
  compose(['down', '-v', '--remove-orphans']);
  const up = compose(['up', '-d', '--wait', '--wait-timeout', '120', 'server', 'web']);
  if (up.status !== 0) throw new Error(`the stack did not start:\n${up.stdout}\n${up.stderr}`);
}

export function stopStack() {
  compose(['down', '-v', '--remove-orphans']);
  fs.rmSync(runDir, { recursive: true, force: true });
}

export const containerName = (service) => `${project}-${service}-1`;

async function post(route, body) {
  const reply = await fetch(`http://127.0.0.1:${ports.server}${route}`, {
    method: 'POST',
    headers: { 'X-Monitor-Key': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (reply.status !== 200) throw new Error(`POST ${route} gave ${reply.status}`);
}

/** One event, as an agent's hook would send it. `ago` is seconds before now. */
export const event = ({ agent, id, status, project: name, detail = '', ago = 0 }) =>
  post('/api/events', {
    agent,
    session_id: id,
    status,
    project: name ?? id,
    detail,
    timestamp: Date.now() / 1000 - ago,
  });

export const limits = (agent, fiveHourPct, weeklyPct) =>
  post('/api/limits', {
    agent,
    five_hour: { used_pct: fiveHourPct, resets_at: Date.now() / 1000 + 6000 },
    weekly: { used_pct: weeklyPct, resets_at: Date.now() / 1000 + 4 * 86_400 },
  });

/** Memory of a container as `docker stats` reports it (MiB), and its CPU share (percent of one core). */
export function containerStats(name) {
  const r = spawnSync(
    'docker',
    ['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', name],
    { encoding: 'utf8', timeout: 30_000 },
  );
  const [mem, cpu] = r.stdout.trim().split('|');
  const m = /([\d.]+)\s*(KiB|MiB|GiB)/.exec(mem ?? '');
  const mib = m ? Number(m[1]) * { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]] : NaN;
  return { memMiB: mib, cpuPct: Number.parseFloat(cpu) };
}

/**
 * Memory of the processes named nginx inside the web container, in KiB. `rssKiB` adds up each process's resident
 * memory, which counts shared pages once per process (an upper bound); `pssKiB` shares those pages out between the
 * processes (proportional set size), so it is the better number for what Nginx really costs.
 */
export function nginxRssKiB(name) {
  // One line per Nginx process: "<VmRSS> <Pss>" in KiB.
  const script =
    'for p in /proc/[0-9]*; do if [ "$(cat $p/comm 2>/dev/null)" = nginx ]; then ' +
    "echo \"$(awk '/VmRSS/ {print $2}' $p/status) $(awk '/^Pss:/ {print $2}' $p/smaps_rollup)\"; fi; done";
  const r = spawnSync('docker', ['exec', name, 'sh', '-c', script], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  const rows = r.stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((a) => a[0] > 0);
  return {
    processes: rows.length,
    rssKiB: rows.reduce((a, row) => a + row[0], 0),
    pssKiB: rows.reduce((a, row) => a + (row[1] || 0), 0),
  };
}
