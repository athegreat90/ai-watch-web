// Contract test: what the real AI Watch server sends must be what the app's parser accepts.
// It WRITES events and limits, so run it only against a throwaway server:
//   AIW_CONTRACT_URL    default http://127.0.0.1:8765
//   AIW_CONTRACT_TOKEN  the server's monitor token (required)
//   npm run test:contract
// Node strips the types of parse.ts itself, so the test uses the same parser as the app.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { parseSnapshot } from '../../src/app/core/api/parse.ts';

const base = (process.env.AIW_CONTRACT_URL ?? 'http://127.0.0.1:8765').replace(/\/$/, '');
const token = process.env.AIW_CONTRACT_TOKEN;
const skip = token ? false : 'set AIW_CONTRACT_TOKEN to run against a throwaway server';

if (token && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error(`Refusing to write test data to a non-local server: ${base}`);
}

const run = `c${Date.now().toString(36)}`;
const now = () => Date.now() / 1000;
const PRIORITY = ['needs_attention', 'error', 'working', 'notice', 'done', 'idle'];

const call = (path, { method = 'GET', body, key = token } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(key ? { 'X-Monitor-Key': key } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const event = (agent, id, status, secondsAgo, extra = {}) =>
  call('/api/events', {
    method: 'POST',
    body: {
      agent,
      session_id: `${run}-${id}`,
      status,
      project: `proj-${id}`,
      detail: `${status} ${id}`,
      timestamp: now() - secondsAgo,
      ...extra,
    },
  });

const limits = (agent, fiveHour, weekly) =>
  call('/api/limits', {
    method: 'POST',
    body: {
      agent,
      five_hour: { used_pct: fiveHour, resets_at: now() + 3600 },
      weekly: { used_pct: weekly, resets_at: now() + 86400 },
    },
  });

const keyOf = (s) => `${s.agent}|${s.session_id}`;

describe('AI Watch server contract', { skip }, () => {
  let status;
  let sessions;

  before(async () => {
    const replies = [
      await event('Claude Code', 'attn', 'needs_attention', 30),
      await event('Codex', 'err', 'error', 20),
      await event('Antigravity', 'work', 'working', 10),
      await event('Gemini CLI', 'note', 'notice', 15),
      await event('Claude Code', 'idle', 'idle', 3),
      // The same session id under another agent is a different session.
      await event('Codex', 'attn', 'working', 12),
      // A turn that ran 395 s, and one that ran 55 s.
      await event('Codex', 'long', 'working', 400),
      await event('Codex', 'long', 'done', 5),
      await event('Codex', 'short', 'working', 60),
      await event('Codex', 'short', 'done', 5),
      // Nine live sessions in all, one more than /api/status can list.
      await event('Codex', 'extra', 'idle', 2),
      await limits('Claude Code', 72.5, 10),
      await limits('Codex', 31, 55.5),
      await limits('Antigravity', 5, 95),
    ];
    assert.deepEqual(
      replies.map((r) => r.status),
      replies.map(() => 200),
    );
    status = parseSnapshot(await (await call('/api/status')).json());
    sessions = parseSnapshot(await (await call('/api/sessions')).json());
  });

  it('answers /health without a key', async () => {
    const reply = await call('/health', { key: '' });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), { ok: true });
  });

  it('refuses a missing or wrong key on the data routes', async () => {
    for (const key of ['', 'x'.repeat(30)]) {
      for (const path of ['/api/status', '/api/sessions']) {
        const reply = await call(path, { key });
        assert.equal(reply.status, 401, `${path} with key "${key.slice(0, 3)}"`);
        assert.deepEqual(await reply.json(), { error: 'unauthorized' });
      }
    }
  });

  it('sends no-store on the data routes', async () => {
    assert.match((await call('/api/status')).headers.get('cache-control') ?? '', /no-store/);
  });

  it('returns a response the app parser accepts, on both routes', () => {
    assert.ok(status, '/api/status did not parse');
    assert.ok(sessions, '/api/sessions did not parse');
  });

  it('caps /api/status at 8 sessions and counts every live one', () => {
    assert.equal(status.sessions.length, 8);
    assert.ok(status.total_count >= 9, 'total_count should include sessions beyond the cap');
    assert.ok(sessions.sessions.length >= 9, '/api/sessions should list all of them');
  });

  it('lists the seeded sessions on /api/sessions', () => {
    const keys = sessions.sessions.map(keyOf);
    for (const expected of [
      'Claude Code|attn',
      'Codex|err',
      'Antigravity|work',
      'Gemini CLI|note',
      'Codex|attn',
      'Codex|long',
    ]) {
      const [agent, id] = expected.split('|');
      assert.ok(keys.includes(`${agent}|${run}-${id}`), `missing ${expected}`);
    }
  });

  it('keeps the server order: needs_attention, error, working, notice, done, idle', () => {
    const order = sessions.sessions.map((s) => PRIORITY.indexOf(s.status));
    assert.ok(
      order.every((n) => n >= 0),
      'unknown status in the response',
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
  });

  it('treats agent and session id together as the identity', () => {
    const same = sessions.sessions.filter((s) => s.session_id === `${run}-attn`);
    assert.deepEqual(same.map((s) => s.agent).sort(), ['Claude Code', 'Codex']);
  });

  it('computes finished_long, waiting and duration on the server', () => {
    const byId = (id) => sessions.sessions.find((s) => s.session_id === `${run}-${id}`);
    assert.equal(byId('long').finished_long, true);
    assert.equal(byId('short').finished_long, false);
    assert.equal(byId('long').duration, 395);
    assert.ok(
      byId('attn') &&
        sessions.sessions.find(
          (s) => s.session_id === `${run}-attn` && s.status === 'needs_attention',
        ).waiting >= 30,
    );
    assert.equal(byId('err').waiting, 0);
  });

  it('counts attention and working sessions', () => {
    assert.ok(status.attention_count >= 1);
    assert.ok(status.active_count >= 2);
  });

  it('returns usage limits for the three supported agents', () => {
    assert.deepEqual(Object.keys(status.limits).sort(), ['Antigravity', 'Claude Code', 'Codex']);
    assert.equal(status.limits['Claude Code'].five_hour.used_pct, 72.5);
    assert.equal(status.limits['Codex'].weekly.used_pct, 55.5);
    const resetsIn = status.limits['Antigravity'].five_hour.resets_in;
    assert.ok(resetsIn > 3500 && resetsIn <= 3600, `resets_in ${resetsIn}`);
  });

  it('refuses limits for an agent it does not track', async () => {
    assert.equal((await limits('Gemini CLI', 1, 1)).status, 400);
  });

  it('treats the query string as part of the path, so the proxy must remove it', async () => {
    assert.equal((await call('/api/status?x=1')).status, 404);
    assert.equal((await call('/health?x=1', { key: '' })).status, 401);
  });

  it('answers an unsupported method with a plain 501, so a browser preflight fails', async () => {
    const reply = await call('/api/status', { method: 'OPTIONS' });
    assert.equal(reply.status, 501);
    assert.equal(reply.headers.get('access-control-allow-origin'), null);
  });
});
