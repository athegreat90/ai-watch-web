import { parseSnapshot } from './parse';
import { sessionKey, statusOf } from './session';

const row = (over: Record<string, unknown> = {}) => ({
  session_id: 's1',
  agent: 'Claude Code',
  project: 'shop',
  status: 'working',
  detail: 'running tests',
  updated: 1700000100,
  started: 1700000000,
  since: 1700000050,
  duration: 100,
  finished_long: false,
  waiting: 0,
  ...over,
});

const window = (over: Record<string, unknown> = {}) => ({
  used_pct: 42.5,
  resets_at: 1700003600,
  resets_in: 3600,
  ...over,
});

describe('parseSnapshot', () => {
  it('reads sessions, limits and counters', () => {
    const snapshot = parseSnapshot({
      sessions: [
        row(),
        row({ session_id: 's2', agent: 'Codex', status: 'needs_attention', waiting: 90 }),
      ],
      limits: { 'Claude Code': { five_hour: window(), weekly: window({ used_pct: 10 }) } },
      active_count: 1,
      attention_count: 1,
      total_count: 2,
    });
    expect(snapshot?.sessions.map((s) => s.session_id)).toEqual(['s1', 's2']);
    expect(snapshot?.sessions[1]?.waiting).toBe(90);
    expect(snapshot?.limits['Claude Code']?.weekly.used_pct).toBe(10);
    expect(snapshot).toMatchObject({ active_count: 1, attention_count: 1, total_count: 2 });
  });

  it('keeps the order the server sent', () => {
    const snapshot = parseSnapshot({
      sessions: [row({ session_id: 'b' }), row({ session_id: 'a' })],
    });
    expect(snapshot?.sessions.map((s) => s.session_id)).toEqual(['b', 'a']);
  });

  it('accepts an empty server state', () => {
    expect(parseSnapshot({ sessions: [], limits: {} })).toEqual({
      sessions: [],
      limits: {},
      active_count: 0,
      attention_count: 0,
      total_count: 0,
    });
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['an array', []],
    ['sessions missing', { limits: {} }],
    ['sessions not an array', { sessions: {} }],
  ])('rejects a body that is %s', (_name, body) => {
    expect(parseSnapshot(body)).toBeNull();
  });

  it.each([
    ['session_id missing', row({ session_id: undefined })],
    ['session_id empty', row({ session_id: '' })],
    ['agent missing', row({ agent: undefined })],
    ['agent empty', row({ agent: '' })],
    ['status not a string', row({ status: 3 })],
    ['row not an object', 'x'],
  ])('rejects the whole response when a row has %s', (_name, bad) => {
    expect(parseSnapshot({ sessions: [row(), bad] })).toBeNull();
  });

  it('fills defaults for optional fields instead of rejecting', () => {
    const snapshot = parseSnapshot({
      sessions: [{ session_id: 's', agent: 'Codex', status: 'idle' }],
    });
    expect(snapshot?.sessions[0]).toMatchObject({
      project: 'Project',
      detail: '',
      duration: 0,
      waiting: 0,
      finished_long: false,
    });
  });

  it('treats finished_long as true only for a real boolean true', () => {
    const flags = [true, 'true', 1, null].map(
      (value) =>
        parseSnapshot({ sessions: [row({ finished_long: value })] })?.sessions[0]?.finished_long,
    );
    expect(flags).toEqual([true, false, false, false]);
  });

  it('keeps an unknown status as sent, for statusOf to map', () => {
    const snapshot = parseSnapshot({ sessions: [row({ status: 'sleeping' })] });
    expect(snapshot?.sessions[0]?.status).toBe('sleeping');
  });

  it('drops an agent whose limits are incomplete, like the firmware', () => {
    const snapshot = parseSnapshot({
      sessions: [],
      limits: {
        Codex: { five_hour: window() },
        'Claude Code': { five_hour: window(), weekly: window({ resets_in: 'soon' }) },
        Antigravity: { five_hour: window(), weekly: window() },
      },
    });
    expect(Object.keys(snapshot?.limits ?? {})).toEqual(['Antigravity']);
  });

  it('keeps used_pct as sent without clamping it', () => {
    const snapshot = parseSnapshot({
      sessions: [],
      limits: { Codex: { five_hour: window({ used_pct: 120 }), weekly: window() } },
    });
    expect(snapshot?.limits['Codex']?.five_hour.used_pct).toBe(120);
  });
});

describe('sessionKey', () => {
  it('separates the same session id under different agents', () => {
    expect(sessionKey({ agent: 'Codex', session_id: 'x' })).not.toBe(
      sessionKey({ agent: 'Claude Code', session_id: 'x' }),
    );
  });

  it('does not mix up an agent and an id that join into the same text', () => {
    expect(sessionKey({ agent: 'ab', session_id: 'c' })).not.toBe(
      sessionKey({ agent: 'a', session_id: 'bc' }),
    );
  });
});

describe('statusOf', () => {
  it('returns every known status unchanged', () => {
    for (const status of ['working', 'needs_attention', 'done', 'idle', 'notice', 'error']) {
      expect(statusOf({ status })).toBe(status);
    }
  });

  it('shows an unknown status as idle', () => {
    expect(statusOf({ status: 'sleeping' })).toBe('idle');
  });
});
