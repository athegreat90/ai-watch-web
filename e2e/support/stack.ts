import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
export const runDir = path.join(root, 'e2e', '.run');
const composeFile = path.join(root, 'compose.test.yaml');

export const ports = {
  server: Number(process.env['E2E_SERVER_PORT'] ?? 18765),
  web: Number(process.env['E2E_WEB_PORT'] ?? 18080),
  badToken: Number(process.env['E2E_BADTOKEN_PORT'] ?? 18081),
};

export const image = process.env['AI_WATCH_WEB_IMAGE'] ?? 'ai-watch-web:test';

/** Runs docker with a time limit, so a stuck command cannot freeze the run. */
export function docker(args: string[], timeoutMs = 240_000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, cwd: root });
  if (result.error) throw result.error;
  return result;
}

export function compose(args: string[], timeoutMs?: number) {
  return docker(['compose', '-f', composeFile, ...args], timeoutMs);
}

/** Random token and its files. The server needs one of at least 24 characters. */
export function writeRunFiles(): { token: string } {
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(runDir, 'monitor_key'), token, { mode: 0o644 });
  fs.writeFileSync(path.join(runDir, 'bad_key'), crypto.randomBytes(24).toString('hex'), {
    mode: 0o644,
  });
  fs.writeFileSync(
    path.join(runDir, 'server-config.json'),
    JSON.stringify({ url: 'http://127.0.0.1:8765', token }),
    { mode: 0o644 },
  );
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ token }));
  return { token };
}

export function readToken(): string {
  return (JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8')) as { token: string })
    .token;
}

export function imageExists(): boolean {
  return docker(['image', 'inspect', image]).status === 0;
}
