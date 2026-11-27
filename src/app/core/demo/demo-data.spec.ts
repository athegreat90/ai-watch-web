import { parseSnapshot } from '../api/parse';
import { statusOf } from '../api/session';
import { findFinished } from '../celebration/celebration';
import { demoSnapshot } from './demo-data';

const ANCHOR = 1_700_000_000;

describe('demoSnapshot', () => {
  const at = (elapsed: number) => demoSnapshot(ANCHOR, ANCHOR + elapsed);
  const byId = (snapshot: ReturnType<typeof at>, id: string) =>
    snapshot.sessions.find((s) => s.session_id === id);

  it('is the same every time for the same moment', () => {
    expect(at(10)).toEqual(at(10));
  });

  it('is accepted by the same parser as the server data, so the app treats it alike', () => {
    for (const elapsed of [0, 44, 45, 100, 300]) {
      const raw = JSON.parse(JSON.stringify(at(elapsed)));
      expect(parseSnapshot(raw)).toEqual(at(elapsed));
    }
  });

  it('shows every kind of situation at the start', () => {
    const snapshot = at(0);
    expect(snapshot.sessions.map((s) => statusOf(s))).toEqual([
      'needs_attention',
      'error',
      'working',
      'working',
      'working',
    ]);
  });

  it('lists the sessions in the order the server uses', () => {
    const order = ['needs_attention', 'error', 'working', 'notice', 'done', 'idle'];
    for (const elapsed of [0, 60]) {
      const ranks = at(elapsed).sessions.map((s) => order.indexOf(s.status));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('counts what the server would count', () => {
    const snapshot = at(0);
    expect(snapshot).toMatchObject({ active_count: 3, attention_count: 1, total_count: 5 });
  });

  it('uses distinct session ids', () => {
    const ids = at(0).sessions.map((s) => s.session_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('time', () => {
    it('lets the waiting and running times grow', () => {
      const early = byId(at(0), 'demo-checkout');
      const later = byId(at(30), 'demo-checkout');
      expect(later!.waiting - early!.waiting).toBe(30);
      expect(byId(at(30), 'demo-docs')!.duration - byId(at(0), 'demo-docs')!.duration).toBe(30);
    });

    it('keeps the update time of a waiting session fixed, so an acknowledgement holds', () => {
      expect(byId(at(0), 'demo-checkout')!.updated).toBe(byId(at(90), 'demo-checkout')!.updated);
    });
  });

  describe('the task that finishes', () => {
    it('is running until 45 seconds in', () => {
      expect(statusOf(byId(at(44), 'demo-infra')!)).toBe('working');
    });

    it('is then done after a long task, so the celebration can be seen', () => {
      const done = byId(at(45), 'demo-infra')!;
      expect(statusOf(done)).toBe('done');
      expect(done.finished_long).toBe(true);
      expect(done.duration).toBe(425);
    });

    it('is a working-to-done change that the celebration logic picks up', () => {
      const found = findFinished(at(40), at(50), new Set());
      expect(found.map((s) => s.session_id)).toEqual(['demo-infra']);
    });

    it('stays for two minutes, as the server would keep it, then goes', () => {
      expect(byId(at(45 + 119), 'demo-infra')).toBeDefined();
      expect(byId(at(45 + 120), 'demo-infra')).toBeUndefined();
      expect(at(45 + 120).total_count).toBe(4);
    });
  });

  describe('limits', () => {
    it('has two agents with both windows, and no data for the third', () => {
      const { limits } = at(0);
      expect(Object.keys(limits)).toEqual(['Claude Code', 'Codex']);
      expect(limits['Codex']?.five_hour.used_pct).toBe(93);
    });

    it('counts the reset down', () => {
      const first = at(0).limits['Codex']!.five_hour.resets_in;
      expect(at(100).limits['Codex']!.five_hour.resets_in).toBe(first - 100);
    });

    it('never goes below zero', () => {
      expect(at(100_000).limits['Codex']!.five_hour.resets_in).toBe(0);
    });
  });

  it('copes with a clock that is behind the start', () => {
    expect(() => demoSnapshot(ANCHOR, ANCHOR - 50)).not.toThrow();
  });
});
