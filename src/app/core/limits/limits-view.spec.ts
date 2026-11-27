import { AgentLimits } from '../api/models';
import { formatDateTime, formatResetIn, toLimitRows, usageLevel } from './limits-view';

const window = (over: Partial<AgentLimits['five_hour']> = {}) => ({
  used_pct: 42.5,
  resets_at: 1700003600,
  resets_in: 3600,
  ...over,
});

const entry = (five = {}, week = {}): AgentLimits => ({
  five_hour: window(five),
  weekly: window({ used_pct: 10, resets_in: 86400 * 4, ...week }),
});

describe('toLimitRows', () => {
  it('always gives the three known agents a row, in a fixed order', () => {
    expect(toLimitRows({}, 0, null).map((r) => r.agent)).toEqual([
      'Claude Code',
      'Codex',
      'Antigravity',
    ]);
  });

  it('marks an agent the server did not report as having no data, and invents nothing', () => {
    const rows = toLimitRows({ Codex: entry() }, 0, null);
    expect(rows.find((r) => r.agent === 'Claude Code')?.windows).toBeNull();
    expect(rows.find((r) => r.agent === 'Codex')?.windows).not.toBeNull();
  });

  it('adds any other agent the server reports, sorted, after the known ones', () => {
    const rows = toLimitRows({ Zed: entry(), Amp: entry(), Codex: entry() }, 0, null);
    expect(rows.map((r) => r.agent)).toEqual(['Claude Code', 'Codex', 'Antigravity', 'Amp', 'Zed']);
  });

  it('gives each agent a 5 hour and a weekly window', () => {
    const windows = toLimitRows({ Codex: entry() }, 0, null).find(
      (r) => r.agent === 'Codex',
    )?.windows;
    expect(windows?.map((w) => [w.label, w.usedPct])).toEqual([
      ['5 hours', 42.5],
      ['Weekly', 10],
    ]);
  });

  it('shows what is left', () => {
    const [five] =
      toLimitRows({ Codex: entry({ used_pct: 72.5 }) }, 0, null).find((r) => r.agent === 'Codex')
        ?.windows ?? [];
    expect(five?.remainingPct).toBe(27.5);
  });

  it('keeps used between 0 and 100 and to one decimal', () => {
    const rows = toLimitRows(
      {
        Codex: entry({ used_pct: 120 }, { used_pct: -5 }),
        Antigravity: entry({ used_pct: 33.333 }),
      },
      0,
      null,
    );
    const codex = rows.find((r) => r.agent === 'Codex')?.windows;
    expect(codex?.[0]).toMatchObject({ usedPct: 100, remainingPct: 0 });
    expect(codex?.[1]).toMatchObject({ usedPct: 0, remainingPct: 100 });
    expect(rows.find((r) => r.agent === 'Antigravity')?.windows?.[0]?.usedPct).toBe(33.3);
  });

  it('counts the reset down from when the data arrived, and stops at zero', () => {
    const at = (elapsed: number) =>
      toLimitRows({ Codex: entry({ resets_in: 100 }) }, elapsed, null).find(
        (r) => r.agent === 'Codex',
      )?.windows?.[0]?.resetsInSec;
    expect(at(0)).toBe(100);
    expect(at(40)).toBe(60);
    expect(at(100)).toBe(0);
    expect(at(500)).toBe(0);
  });

  it('uses the reset time from the server', () => {
    const w = toLimitRows({ Codex: entry({ resets_at: 1700003600 }) }, 0, 5)?.find(
      (r) => r.agent === 'Codex',
    )?.windows?.[0];
    expect(w?.resetsAtMs).toBe(1700003600000);
  });

  it('works out the reset time from the sync time when the server sent none', () => {
    const w = toLimitRows({ Codex: entry({ resets_at: 0, resets_in: 60 }) }, 0, 1_000_000)?.find(
      (r) => r.agent === 'Codex',
    )?.windows?.[0];
    expect(w?.resetsAtMs).toBe(1_060_000);
  });
});

describe('usageLevel', () => {
  it.each([
    [0, 'ok'],
    [69.9, 'ok'],
    [70, 'warn'],
    [89.9, 'warn'],
    [90, 'critical'],
    [100, 'critical'],
  ])('rates %d %% as %s', (pct, level) => {
    expect(usageLevel(pct)).toBe(level);
  });
});

describe('formatResetIn', () => {
  it.each([
    [0, 'now'],
    [-5, 'now'],
    [30, 'under 1m'],
    [60, '1m'],
    [720, '12m'],
    [3600, '1h 00m'],
    [6480, '1h 48m'],
    [86399, '23h 59m'],
    [86400, '1d 0h'],
    [86400 * 4 + 3600 * 6, '4d 6h'],
  ])('formats %d seconds as %s', (seconds, text) => {
    expect(formatResetIn(seconds)).toBe(text);
  });
});

describe('formatDateTime', () => {
  it('shows the weekday, date and time in the given time zone', () => {
    expect(formatDateTime(1700000000000, 'en-GB', 'UTC')).toMatch(/Tue.*14.*Nov.*22:13/);
  });
});
