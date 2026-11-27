import { ports, readToken } from './support/stack';
import { event } from './support/server';
import { expect, test } from './support/fixtures';
import { open } from './support/ui';

const web = (path: string) => `http://127.0.0.1:${ports.web}${path}`;

test.describe('the proxy in front of the real server', () => {
  test('the real server really needs the key, and the proxy adds it', async ({ request }) => {
    const direct = await request.get(`http://127.0.0.1:${ports.server}/api/status`);
    expect(direct.status()).toBe(401);
    expect((await request.get(web('/api/status'))).status()).toBe(200);
    expect((await request.get(web('/api/sessions'))).status()).toBe(200);
    expect((await request.get(web('/health'))).status()).toBe(200);
  });

  test('drops the query string, which the server would refuse', async ({ request }) => {
    const direct = await request.get(`http://127.0.0.1:${ports.server}/api/status?x=1`, {
      headers: { 'X-Monitor-Key': readToken() },
    });
    expect(direct.status()).toBe(404);
    expect((await request.get(web('/api/status?x=1'))).status()).toBe(200);
    expect((await request.get(web('/api/sessions?limit=5'))).status()).toBe(200);
  });

  test('ignores a key sent by the browser', async ({ request }) => {
    const reply = await request.get(web('/api/status'), { headers: { 'X-Monitor-Key': 'wrong' } });
    expect(reply.status()).toBe(200);
    const bad = await request.get(web('/api/status'), {
      headers: { Authorization: 'Bearer nope', Cookie: 'a=b' },
    });
    expect(bad.status()).toBe(200);
  });

  test('closes everything except the three read routes', async ({ request }) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const)
      expect((await request.fetch(web('/api/status'), { method })).status(), method).toBe(405);
    for (const path of [
      '/api/events',
      '/api/event',
      '/api/limits',
      '/api/',
      '/api/status/',
      '/api/status/x',
      '/api/STATUS',
    ])
      expect((await request.get(web(path))).status(), path).toBe(404);
    for (const path of ['/api/events', '/api/limits'])
      expect((await request.post(web(path), { data: {} })).status(), `POST ${path}`).toBe(404);
  });

  test('merges repeated slashes into the allowed route, nothing more', async ({ request }) => {
    expect((await request.get(web('/api//status'))).status()).toBe(200);
    expect((await request.get(web('/api//events'))).headers()['content-type']).toContain(
      'text/html',
    );
  });

  test('resolves dot segments before routing, so they never reach a write route', async ({
    request,
  }) => {
    const before = (await (await request.get(web('/api/sessions'))).json()).sessions.length;
    const asHealth = await request.get(web('/api/%2e%2e/health'));
    expect(asHealth.status()).toBe(200);
    const asEvents = await request.fetch(web('/api/%2e%2e/events'), { method: 'POST', data: {} });
    // Nginx resolves the path to a file of the app, which does not take a POST.
    expect(asEvents.status()).toBe(405);
    const get = await request.get(web('/api/%2e%2e/events'));
    expect(get.headers()['content-type']).toContain('text/html');
    expect((await (await request.get(web('/api/sessions'))).json()).sessions.length).toBe(before);
  });

  test('a write sent through the page cannot reach the server', async ({ page, problems }) => {
    await open(page, '/dashboard');
    const before = await (await page.request.get(web('/api/sessions'))).json();
    await page.evaluate(() =>
      fetch('/api/events', {
        method: 'POST',
        body: JSON.stringify({ agent: 'Codex', session_id: 'sneak', status: 'working' }),
      }),
    );
    const after = await (await page.request.get(web('/api/sessions'))).json();
    expect(after.sessions.length).toBe(before.sessions.length);
    problems.length = 0;
  });

  test('never shows the token: not in a page, a script, a style, the config or any answer', async ({
    request,
    page,
  }) => {
    await event({ agent: 'Codex', id: 'x', status: 'working', project: 'p' });
    const token = readToken();
    await open(page, '/dashboard');
    const assets = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLScriptElement>('script[src]'),
        ...document.querySelectorAll<HTMLLinkElement>('link[href]'),
      ].map((el) => ('src' in el && el.src) || (el as HTMLLinkElement).href),
    );
    expect(assets.length).toBeGreaterThan(1);
    const urls = [
      web('/'),
      web('/config.json'),
      web('/api/status'),
      web('/api/sessions'),
      web('/health'),
      ...assets,
    ];
    for (const url of urls) {
      const reply = await request.get(url);
      const body = await reply.text();
      const headers = JSON.stringify(reply.headers());
      expect(body.includes(token), `body of ${url}`).toBe(false);
      expect(headers.includes(token), `headers of ${url}`).toBe(false);
    }
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored.includes(token)).toBe(false);
  });

  test('sends the security headers on the page, the data and the assets', async ({
    request,
    page,
  }) => {
    await open(page, '/dashboard');
    const script = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLScriptElement>('script[src]')]
          .map((e) => e.src)
          .find((u) => /main-[A-Z0-9]+\.js$/.test(u)) ?? '',
    );
    for (const url of [
      web('/'),
      web('/dashboard'),
      web('/api/status'),
      web('/config.json'),
      script,
    ]) {
      const h = (await request.get(url)).headers();
      expect(h['content-security-policy'], url).toContain("script-src 'self';");
      expect(h['content-security-policy'], url).not.toMatch(/script-src[^;]*unsafe/);
      expect(h['content-security-policy'], url).toContain("default-src 'none'");
      expect(h['content-security-policy'], url).toContain("frame-ancestors 'none'");
      expect(h['x-content-type-options'], url).toBe('nosniff');
      expect(h['x-frame-options'], url).toBe('DENY');
      expect(h['referrer-policy'], url).toBe('no-referrer');
      expect(h['server'] ?? '', url).not.toMatch(/\d/);
      expect(h['x-powered-by'], url).toBeUndefined();
    }
  });

  test('caches the app files for a year but never the page or the data', async ({
    request,
    page,
  }) => {
    await open(page, '/dashboard');
    const script = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLScriptElement>('script[src]')]
          .map((e) => e.src)
          .find((u) => /main-[A-Z0-9]+\.js$/.test(u)) ?? '',
    );
    expect((await request.get(script)).headers()['cache-control']).toContain('immutable');
    expect((await request.get(web('/'))).headers()['cache-control']).toContain('no-cache');
    expect((await request.get(web('/config.json'))).headers()['cache-control']).toBe('no-store');
    expect((await request.get(web('/api/status'))).headers()['cache-control']).toBe('no-store');
  });

  test('serves the page for a deep link, and says 404 for a file that is not there', async ({
    request,
  }) => {
    const deep = await request.get(web('/sessions/Codex/anything'));
    expect(deep.status()).toBe(200);
    expect(await deep.text()).toContain('<app-root');
    expect((await request.get(web('/missing.js'))).status()).toBe(404);
  });

  test('tells a refused proxy token apart from a login, with the header the page reads', async ({
    request,
  }) => {
    const reply = await request.get(`http://127.0.0.1:${ports.badToken}/api/status`);
    expect(reply.status()).toBe(401);
    expect(reply.headers()['x-aiw-upstream-status']).toBe('401');
    const fine = await request.get(web('/api/status'));
    expect(fine.headers()['x-aiw-upstream-status']).toBe('200');
  });

  test('the runtime config has the poll interval and nothing else that matters', async ({
    request,
  }) => {
    const config = await (await request.get(web('/config.json'))).json();
    // Empty unless POLL_INTERVAL_MS was set. Nothing else belongs here.
    expect(Object.keys(config).filter((key) => key !== 'pollIntervalMs')).toEqual([]);
    if ('pollIntervalMs' in config) expect(config.pollIntervalMs).toBeGreaterThanOrEqual(1000);
  });

  test('the health check of the container answers on its own', async ({ request }) => {
    const reply = await request.get(web('/healthz'));
    expect(reply.status()).toBe(200);
  });
});
