// Tests of the real image: Nginx, the entrypoint and the proxy rules, with a stand-in for the AI
// Watch server. They start real containers, so they need Docker and a built image:
//   docker build -f docker/Dockerfile -t ai-watch-web:test .
//   AIW_TEST_IMAGE=ai-watch-web:test npm run test:proxy
// Without AIW_TEST_IMAGE (or without Docker) they are skipped.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startMock } from './mock-upstream.mjs';

const image = process.env.AIW_TEST_IMAGE;
// A limit on every call, so a command that never ends cannot freeze the whole run.
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 });
const dockerUp = image && docker('info', '--format', '{{.ServerVersion}}').status === 0;
const skip = dockerUp ? false : 'set AIW_TEST_IMAGE and start Docker to test the image';

/** Nginx counts the cache in whole seconds, so an entry lives 1 to 2 seconds. */
const CACHE_RUNS_OUT_MS = 2300;
const TOKEN = `tok-${crypto.randomBytes(16).toString('hex')}`;
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aiw-proxy-'));
const started = [];

/** One raw request. `http.request` does not tidy the path, so dot segments reach Nginx untouched. */
function call(port, method, rawPath, { headers = {}, auth } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: rawPath,
        headers: { ...headers, ...(auth ? { Authorization: auth } : {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function startWeb({ key = TOKEN, upstream, env = {}, htpasswd } = {}) {
  const dir = fs.mkdtempSync(path.join(scratch, 'web-'));
  const keyFile = path.join(dir, 'monitor_key');
  fs.writeFileSync(keyFile, key, { mode: 0o644 });
  const args = [
    'run',
    '-d',
    '--rm',
    '--read-only',
    '--tmpfs',
    '/tmp:size=16m,mode=1777',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--add-host',
    'host.docker.internal:host-gateway',
    '-p',
    '127.0.0.1::8080',
    '-e',
    `UPSTREAM_URL=${upstream}`,
    '--mount',
    `type=bind,source=${keyFile},target=/run/secrets/monitor_key,readonly`,
  ];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  if (htpasswd) {
    const file = path.join(dir, 'htpasswd');
    fs.writeFileSync(file, htpasswd, { mode: 0o644 });
    args.push('--mount', `type=bind,source=${file},target=/run/secrets/htpasswd,readonly`);
  }
  args.push(image);
  const run = docker(...args);
  assert.equal(run.status, 0, run.stderr);
  const id = run.stdout.trim();
  started.push(id);
  const mapped = docker('port', id, '8080/tcp').stdout.trim().split('\n')[0] ?? '';
  const port = Number(mapped.split(':').pop());
  return { id, port };
}

async function waitReady(port) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await call(port, 'GET', '/healthz')).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the container did not become ready');
}

const exec = (id, ...cmd) => docker('exec', id, ...cmd);
const logs = (id) => {
  const r = docker('logs', id);
  return `${r.stdout}${r.stderr}`;
};
const upstreamUrl = (port) => `http://host.docker.internal:${port}`;

describe('the AI Watch Web image', { skip }, () => {
  let mock;
  let web;

  before(async () => {
    mock = await startMock({ token: TOKEN });
    web = startWeb({ upstream: upstreamUrl(mock.port) });
    await waitReady(web.port);
  });

  after(async () => {
    for (const id of started) docker('rm', '-f', id);
    await mock?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  const get = (p, options) => call(web.port, 'GET', p, options);

  describe('the container', () => {
    it('runs as a normal user, not root', () => {
      assert.equal(exec(web.id, 'id', '-u').stdout.trim(), '101');
    });

    it('has a read-only root filesystem', () => {
      assert.notEqual(exec(web.id, 'sh', '-c', 'touch /usr/share/nginx/html/x').status, 0);
      assert.notEqual(exec(web.id, 'sh', '-c', 'touch /etc/nginx/x').status, 0);
    });

    it('can write only to /tmp', () => {
      assert.equal(exec(web.id, 'sh', '-c', 'touch /tmp/ok').status, 0);
    });

    it('answers its own health check without the server', async () => {
      const r = await get('/healthz');
      assert.equal(r.status, 200);
      assert.equal(r.body, 'ok\n');
      assert.equal(
        exec(web.id, 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8080/healthz').status,
        0,
      );
    });

    it('keeps the key out of the environment and the process list', () => {
      const inspect = JSON.parse(docker('inspect', web.id).stdout)[0];
      assert.ok(!JSON.stringify(inspect.Config.Env).includes(TOKEN));
      assert.ok(!exec(web.id, 'ps', '-o', 'args').stdout.includes(TOKEN));
    });

    it('stores the key only in a file that only its user can read, in /tmp', () => {
      assert.equal(
        exec(web.id, 'stat', '-c', '%a %U', '/tmp/nginx/runtime.conf').stdout.trim(),
        '600 nginx',
      );
      const found = exec(
        web.id,
        'sh',
        '-c',
        // Only real directories: /var/log/nginx links to /dev/stdout, a pipe that grep would wait on.
        `grep -rl "${TOKEN}" /etc/nginx /run/secrets /tmp /usr/share/nginx 2>/dev/null | sort`,
      ).stdout.trim();
      assert.equal(found, '/run/secrets/monitor_key\n/tmp/nginx/runtime.conf');
    });

    it('labels the image with the source', () => {
      const labels = JSON.parse(docker('inspect', image).stdout)[0].Config.Labels;
      assert.equal(
        labels['org.opencontainers.image.source'],
        'https://github.com/athegreat90/ai-watch-web',
      );
    });
  });

  describe('the three allowed routes', () => {
    // The two data routes are cached for 1 to 2 seconds. So each is asked for once, after the
    // cache has run out, and the tests below read what the server received for that one request.
    const seen = {};

    before(async () => {
      await new Promise((r) => setTimeout(r, CACHE_RUNS_OUT_MS));
      mock.reset();
      seen.status = await get('/api/status?x=1&y=2', {
        headers: {
          'X-Monitor-Key': 'attacker-key-attacker-key-1234',
          Cookie: 'a=b',
          'X-Forwarded-For': '6.6.6.6',
          'X-Real-IP': '6.6.6.6',
        },
        auth: 'Basic YTpi',
      });
      seen.sessions = await get('/api/sessions?x');
      seen.health = await get('/health?x=1');
    });

    const upstream = (url) => mock.requests.find((r) => r.url === url);

    it('passes GET /health on, without a key', () => {
      assert.equal(seen.health.status, 200);
      assert.deepEqual(JSON.parse(seen.health.body), { ok: true });
      assert.equal(upstream('/health').headers['x-monitor-key'], undefined);
    });

    it('passes GET /api/status on with the server\x27s key', () => {
      assert.equal(seen.status.status, 200);
      assert.equal(JSON.parse(seen.status.body).sessions[0].detail, 'status');
      assert.equal(upstream('/api/status').headers['x-monitor-key'], TOKEN);
    });

    it('passes GET /api/sessions on with the server\x27s key', () => {
      assert.equal(seen.sessions.status, 200);
      assert.equal(JSON.parse(seen.sessions.body).sessions[0].detail, 'sessions');
      assert.equal(upstream('/api/sessions').headers['x-monitor-key'], TOKEN);
    });

    it('removes the query string, because the server would answer 404 to it', () => {
      assert.deepEqual(
        mock.requests.map((r) => r.url),
        ['/api/status', '/api/sessions', '/health'],
      );
    });

    it('sends its own key and nothing of the browser', () => {
      const headers = upstream('/api/status').headers;
      assert.equal(headers['x-monitor-key'], TOKEN);
      assert.equal(headers.authorization, undefined);
      assert.equal(headers.cookie, undefined);
      assert.equal(headers['x-forwarded-for'], undefined);
      assert.equal(headers['x-real-ip'], undefined);
    });

    it('asks the server with a plain GET and the server\x27s own host name', () => {
      const request = upstream('/api/status');
      assert.equal(request.method, 'GET');
      assert.equal(request.headers.host, `host.docker.internal:${mock.port}`);
    });

    it('tells the browser not to keep the data, and hides the server\x27s own headers', () => {
      for (const r of [seen.status, seen.sessions, seen.health]) {
        assert.equal(r.headers['cache-control'], 'no-store');
        assert.equal(r.headers['x-powered-by'], undefined);
        assert.equal(r.headers['set-cookie'], undefined);
      }
    });

    it('says the server answered, with its status', () => {
      assert.equal(seen.status.headers['x-aiw-upstream-status'], '200');
      assert.equal(seen.health.headers['x-aiw-upstream-status'], '200');
    });
  });

  describe('everything else is closed', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
      for (const route of ['/api/status', '/api/sessions', '/health']) {
        it(`refuses ${method} ${route} before the server is asked`, async () => {
          mock.reset();
          const r = await call(web.port, method, route);
          assert.equal(r.status, 405);
          assert.equal(mock.requests.length, 0);
        });
      }
    }

    const blocked = [
      '/api/events',
      '/api/event',
      '/api/limits',
      '/api/',
      '/api',
      '/api/foo',
      '/api/status/',
      '/api/status/x',
      '/api/sessions/',
      '/api/status/../events',
      '/api/./limits',
      '/api/status%2f..%2fevents',
      '//api/events',
      '/api/status.json',
      '/api/events.js',
    ];
    for (const p of blocked) {
      for (const method of ['GET', 'POST']) {
        it(`never passes ${method} ${p} on`, async () => {
          mock.reset();
          const r = await call(web.port, method, p);
          assert.equal(mock.requests.length, 0, `the server saw ${JSON.stringify(mock.requests)}`);
          assert.ok([404, 405, 200].includes(r.status), `status ${r.status}`);
          if (p.startsWith('/api/') && !p.includes('..')) assert.notEqual(r.status, 200);
        });
      }
    }

    it('answers /api/ with 404 and no-store', async () => {
      const r = await get('/api/events');
      assert.equal(r.status, 404);
      assert.equal(r.headers['cache-control'], 'no-store');
    });

    it('does not take a body', async () => {
      mock.reset();
      const body = 'x'.repeat(5000);
      const r = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: web.port,
            method: 'POST',
            path: '/api/events',
            headers: { 'Content-Length': body.length },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
        req.end(body);
      });
      assert.ok([404, 413].includes(r));
      assert.equal(mock.requests.length, 0);
    });
  });

  describe('when the server does not answer as hoped', () => {
    it('shows the server refusing the token, with the header the app reads', async () => {
      const other = await startMock({ token: 'a-different-token-a-different-token' });
      const own = startWeb({ upstream: upstreamUrl(other.port) });
      await waitReady(own.port);
      const r = await call(own.port, 'GET', '/api/status');
      assert.equal(r.status, 401);
      assert.equal(r.headers['x-aiw-upstream-status'], '401');
      assert.deepEqual(JSON.parse(r.body), { error: 'unauthorized' });
      await other.close();
    });

    it('answers 502 when the server is down, and the page itself keeps working', async () => {
      const gone = await startMock({ token: TOKEN });
      const own = startWeb({ upstream: upstreamUrl(gone.port) });
      await waitReady(own.port);
      await gone.close();
      const r = await call(own.port, 'GET', '/api/status');
      assert.equal(r.status, 502);
      assert.equal((await call(own.port, 'GET', '/healthz')).status, 200);
      assert.equal((await call(own.port, 'GET', '/')).status, 200);
    });

    it('answers 504 when the server is too slow', async () => {
      const slow = await startMock({ token: TOKEN });
      slow.state.delayMs = 8000;
      const own = startWeb({ upstream: upstreamUrl(slow.port) });
      await waitReady(own.port);
      const r = await call(own.port, 'GET', '/api/status');
      assert.equal(r.status, 504);
      await slow.close();
    });

    it('starts even when the server name does not exist yet, and answers 502 until it does', async () => {
      const own = startWeb({ upstream: 'http://no-such-host.invalid:8765' });
      await waitReady(own.port);
      assert.equal((await call(own.port, 'GET', '/api/status')).status, 502);
      assert.equal((await call(own.port, 'GET', '/')).status, 200);
    });

    it('does not keep an error, so the next request goes to the server', async () => {
      const own = await startMock({ token: TOKEN });
      const site = startWeb({ upstream: upstreamUrl(own.port) });
      await waitReady(site.port);
      own.state.failNextStatusWith500 = true;
      assert.equal((await call(site.port, 'GET', '/api/status')).status, 500);
      assert.equal((await call(site.port, 'GET', '/api/status')).status, 200);
      await own.close();
    });
  });

  describe('the one-second cache that protects the server', () => {
    it('lets many browsers share one request', async () => {
      await new Promise((r) => setTimeout(r, CACHE_RUNS_OUT_MS));
      mock.reset();
      const results = await Promise.all(Array.from({ length: 12 }, () => get('/api/status')));
      assert.ok(results.every((r) => r.status === 200));
      assert.ok(mock.requests.length <= 2, `the server was asked ${mock.requests.length} times`);
    });

    it('asks again once the second is over', async () => {
      await new Promise((r) => setTimeout(r, CACHE_RUNS_OUT_MS));
      mock.reset();
      await get('/api/status');
      await new Promise((r) => setTimeout(r, CACHE_RUNS_OUT_MS));
      await get('/api/status');
      assert.equal(mock.requests.length, 2);
    });

    it('keeps the two data routes apart', async () => {
      await new Promise((r) => setTimeout(r, CACHE_RUNS_OUT_MS));
      const a = JSON.parse((await get('/api/status')).body);
      const b = JSON.parse((await get('/api/sessions')).body);
      assert.equal(a.sessions[0].detail, 'status');
      assert.equal(b.sessions[0].detail, 'sessions');
    });

    it('does not cache /health', async () => {
      mock.reset();
      for (let i = 0; i < 3; i++) await get('/health');
      assert.equal(mock.requests.length, 3);
    });
  });

  describe('the app', () => {
    it('serves the page, never cached', async () => {
      const r = await get('/');
      assert.equal(r.status, 200);
      assert.match(r.body, /<app-root/);
      assert.equal(r.headers['cache-control'], 'no-cache');
    });

    it('serves the page for a route of the app', async () => {
      for (const p of ['/sessions', '/sessions/Codex/abc123', '/kiosk', '/settings']) {
        const r = await get(p);
        assert.equal(r.status, 200, p);
        assert.match(r.body, /<app-root/, p);
      }
    });

    it('answers 404 for a missing file instead of the page', async () => {
      for (const p of ['/nope.js', '/missing.css', '/main-AAAA.js', '/a/b/c.png'])
        assert.equal((await get(p)).status, 404, p);
    });

    it('caches the files with a hash for a year', async () => {
      const page = (await get('/')).body;
      const asset = /(main-[A-Za-z0-9]+\.js)/.exec(page)?.[1];
      assert.ok(asset, 'no hashed main file in index.html');
      const r = await get(`/${asset}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.match(r.headers['content-type'], /javascript/);
    });

    it('makes the browser check the other files', async () => {
      const r = await get('/theme-init.js');
      assert.equal(r.status, 200);
      assert.equal(r.headers['cache-control'], 'no-cache');
    });

    it('compresses the scripts', async () => {
      const asset = /(main-[A-Za-z0-9]+\.js)/.exec((await get('/')).body)[1];
      const r = await get(`/${asset}`, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(r.headers['content-encoding'], 'gzip');
    });

    it('serves the runtime settings, never cached, empty by default', async () => {
      const r = await get('/config.json');
      assert.equal(r.status, 200);
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.match(r.headers['content-type'], /json/);
      assert.deepEqual(JSON.parse(r.body), {});
    });

    it('serves the default update interval when one is set', async () => {
      const own = startWeb({ upstream: upstreamUrl(mock.port), env: { POLL_INTERVAL_MS: '5000' } });
      await waitReady(own.port);
      assert.deepEqual(JSON.parse((await call(own.port, 'GET', '/config.json')).body), {
        pollIntervalMs: 5000,
      });
    });
  });

  describe('security headers', () => {
    const routes = [
      '/',
      '/sessions',
      '/main.js-missing',
      '/theme-init.js',
      '/config.json',
      '/healthz',
      '/api/events',
      '/api/status',
      '/health',
    ];
    for (const p of routes) {
      it(`are on ${p}`, async () => {
        const r = await get(p);
        assert.equal(r.headers['content-security-policy'], CSP);
        assert.equal(r.headers['x-content-type-options'], 'nosniff');
        assert.equal(r.headers['x-frame-options'], 'DENY');
        assert.equal(r.headers['referrer-policy'], 'no-referrer');
        assert.equal(r.headers['cross-origin-opener-policy'], 'same-origin');
        assert.match(r.headers['permissions-policy'], /camera=\(\)/);
        assert.doesNotMatch(r.headers['permissions-policy'], /wake-lock|fullscreen/);
      });
    }

    it('never allow inline scripts', () => {
      assert.match(CSP, /script-src 'self';/);
      assert.doesNotMatch(CSP.split('style-src')[0], /unsafe-inline/);
    });

    it('do not tell which Nginx version this is', async () => {
      const r = await get('/');
      assert.doesNotMatch(r.headers.server ?? '', /\d/);
    });
  });

  describe('the key never leaves', () => {
    it('is not in any page, script, setting or answer the browser can get', async () => {
      const page = (await get('/')).body;
      const files = new Set([
        '/',
        '/config.json',
        '/healthz',
        '/theme-init.js',
        '/api/events',
        '/health',
      ]);
      for (const m of page.matchAll(/(?:src|href)="([^"]+)"/g))
        if (m[1].startsWith('/') || !m[1].includes(':'))
          files.add(m[1].startsWith('/') ? m[1] : `/${m[1]}`);
      for (const f of files) {
        const r = await get(f);
        assert.ok(!r.body.includes(TOKEN), `the key is in the body of ${f}`);
        assert.ok(!JSON.stringify(r.headers).includes(TOKEN), `the key is in the headers of ${f}`);
      }
      const api = await get('/api/status');
      assert.ok(!api.body.includes(TOKEN) && !JSON.stringify(api.headers).includes(TOKEN));
    });

    it('is not in the logs, and neither is a query string', async () => {
      await get('/api/status?secret=hunter2');
      const text = logs(web.id);
      assert.ok(!text.includes(TOKEN), 'the key is in the logs');
      assert.ok(!text.includes('hunter2'), 'a query string is in the logs');
      assert.match(text, /"GET \/api\/status"/);
    });
  });

  describe('refusing to start', () => {
    /** `--rm` removes the container when it exits, so "gone" means it stopped. */
    const stopped = (id) => {
      const state = docker('inspect', '-f', '{{.State.Running}}', id);
      return state.status !== 0 || state.stdout.trim() !== 'true';
    };

    it('with a key that is too short', async () => {
      const own = startWeb({ upstream: upstreamUrl(mock.port), key: 'short' });
      await new Promise((r) => setTimeout(r, 2500));
      assert.ok(stopped(own.id), 'the container is still running');
    });

    it('with a key that would break the configuration, and does not print it', async () => {
      const bad = `bad"key;with$chars${'x'.repeat(24)}`;
      const own = startWeb({ upstream: upstreamUrl(mock.port), key: bad });
      await new Promise((r) => setTimeout(r, 2500));
      const state = docker('inspect', '-f', '{{.State.Running}}', own.id);
      assert.ok(
        state.status !== 0 || state.stdout.trim() !== 'true',
        'the container is still running',
      );
      assert.ok(!logs(own.id).includes(bad));
    });

    it('with an address that is not http://host[:port]', async () => {
      const own = startWeb({ upstream: 'https://example.com' });
      await new Promise((r) => setTimeout(r, 2500));
      const state = docker('inspect', '-f', '{{.State.Running}}', own.id);
      assert.ok(state.status !== 0 || state.stdout.trim() !== 'true');
    });
  });

  describe('the optional login', () => {
    const user = 'watcher';
    const password = 'correct horse';
    const sha = `{SHA}${crypto.createHash('sha1').update(password).digest('base64')}`;
    const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
    let own;
    let ownMock;

    before(async () => {
      ownMock = await startMock({ token: TOKEN });
      own = startWeb({ upstream: upstreamUrl(ownMock.port), htpasswd: `${user}:${sha}\n` });
      await waitReady(own.port);
    });

    after(() => ownMock?.close());

    it('asks for a login on the page and on the data, and the server is not asked', async () => {
      ownMock.reset();
      for (const p of ['/', '/api/status', '/health', '/config.json']) {
        const r = await call(own.port, 'GET', p);
        assert.equal(r.status, 401, p);
        assert.match(r.headers['www-authenticate'], /^Basic/);
      }
      assert.equal(ownMock.requests.length, 0);
    });

    it('does not say the server answered, so the app can tell the login from a refused token', async () => {
      const r = await call(own.port, 'GET', '/api/status');
      assert.equal(r.headers['x-aiw-upstream-status'], undefined);
    });

    it('lets the health check through without a login', async () => {
      assert.equal((await call(own.port, 'GET', '/healthz')).status, 200);
    });

    it('refuses a wrong password', async () => {
      assert.equal((await call(own.port, 'GET', '/', { auth: basic(user, 'wrong') })).status, 401);
      assert.equal(
        (await call(own.port, 'GET', '/', { auth: basic('someone', password) })).status,
        401,
      );
    });

    it('lets in the right login, and keeps it from the server', async () => {
      ownMock.reset();
      assert.equal((await call(own.port, 'GET', '/', { auth: basic(user, password) })).status, 200);
      const r = await call(own.port, 'GET', '/api/status', { auth: basic(user, password) });
      assert.equal(r.status, 200);
      assert.equal(ownMock.requests[0].headers.authorization, undefined);
      assert.equal(ownMock.requests[0].headers['x-monitor-key'], TOKEN);
    });

    it('still blocks the write routes after logging in', async () => {
      ownMock.reset();
      const r = await call(own.port, 'POST', '/api/events', { auth: basic(user, password) });
      assert.equal(r.status, 404);
      assert.equal(ownMock.requests.length, 0);
    });
  });
});
