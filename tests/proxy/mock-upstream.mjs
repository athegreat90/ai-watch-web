// A small stand-in for the AI Watch server, for testing the Nginx proxy. It follows the real
// server's contract (docs/API.md): /health is public, the two data routes need X-Monitor-Key, the
// path is matched with the query string included, other methods get a plain 501, and answers
// carry `Cache-Control: no-store`. It records every request so a test can see exactly what the
// proxy sent.
import http from 'node:http';

const snapshot = (route) => ({
  sessions: [
    {
      session_id: `${route}-1`,
      agent: 'Codex',
      project: 'proxy-test',
      status: 'working',
      detail: route,
      updated: 1700000000,
      started: 1699999900,
      since: 1699999900,
      duration: 100,
      finished_long: false,
      waiting: 0,
    },
  ],
  limits: {},
  active_count: 1,
  attention_count: 0,
  total_count: 1,
});

export function startMock({ token }) {
  const requests = [];
  const state = { token, delayMs: 0, failNextStatusWith500: false };

  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    const send = (code, body) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Connection: 'close',
        'Set-Cookie': 'mock=1',
        'X-Powered-By': 'mock-upstream',
      });
      res.end(JSON.stringify(body));
    };
    const respond = () => {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(501, { 'Content-Type': 'text/plain' });
        res.end('Unsupported method');
        return;
      }
      if (req.url === '/health') return send(200, { ok: true });
      if (req.headers['x-monitor-key'] !== state.token) return send(401, { error: 'unauthorized' });
      if (req.method === 'GET' && req.url === '/api/status') {
        if (state.failNextStatusWith500) {
          state.failNextStatusWith500 = false;
          return send(500, { error: 'boom' });
        }
        return send(200, snapshot('status'));
      }
      if (req.method === 'GET' && req.url === '/api/sessions')
        return send(200, snapshot('sessions'));
      return send(404, { error: 'not found' });
    };
    if (state.delayMs > 0) setTimeout(respond, state.delayMs);
    else respond();
  });

  // A mock a failing test forgot to close must not keep the whole run alive (CI once hung for 30 minutes).
  server.unref();
  return new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () =>
      resolve({
        port: server.address().port,
        requests,
        state,
        /** Requests the mock received for a path, so a test can say "this never arrived". */
        seen: (predicate) => requests.filter(predicate),
        reset: () => (requests.length = 0),
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(done);
          }),
      }),
    );
  });
}
