import { session } from '../../testing/fixtures';
import { agentInitials, formatDuration, formatTime, toView } from './session-view';

describe('toView', () => {
  it('moves a working session on with the time since the response', () => {
    const view = toView(session({ status: 'working', duration: 100 }), 5);
    expect(view).toMatchObject({
      status: 'working',
      running: true,
      durationSec: 105,
      waitingSec: 0,
    });
  });

  it('moves both times of a session that needs attention', () => {
    const view = toView(session({ status: 'needs_attention', duration: 100, waiting: 30 }), 5);
    expect(view).toMatchObject({ running: true, durationSec: 105, waitingSec: 35 });
  });

  it.each(['done', 'error', 'notice', 'idle'])(
    'keeps a %s session as the server froze it',
    (status) => {
      const view = toView(session({ status, duration: 100, waiting: 0 }), 60);
      expect(view).toMatchObject({ running: false, durationSec: 100, waitingSec: 0 });
    },
  );

  it('shows an unknown status as idle', () => {
    expect(toView(session({ status: 'sleeping' }), 3)).toMatchObject({
      status: 'idle',
      running: false,
    });
  });

  it('keeps identity and text, and converts times to milliseconds', () => {
    const view = toView(session({ updated: 1700000100.5, started: 0 }), 0);
    expect(view).toMatchObject({
      agent: 'Claude Code',
      sessionId: 's1',
      project: 'shop',
      detail: 'running tests',
      updatedMs: 1700000100500,
      startedMs: 0,
    });
  });

  it('gives the same session id under two agents different keys', () => {
    expect(toView(session({ agent: 'Codex' }), 0).key).not.toBe(
      toView(session({ agent: 'Claude Code' }), 0).key,
    );
  });
});

describe('agentInitials', () => {
  it.each([
    ['Claude Code', 'CC'],
    ['Codex', 'CO'],
    ['Antigravity', 'AN'],
    ['Gemini CLI', 'GC'],
    ['GitHub Copilot CLI', 'GC'],
    ['  spaced   name ', 'SN'],
    ['x', 'X'],
    ['', ''],
  ])('turns %j into %j', (name, initials) => {
    expect(agentInitials(name)).toBe(initials);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [59, '59s'],
    [60, '1m 00s'],
    [185, '3m 05s'],
    [3599, '59m 59s'],
    [3600, '1h 00m'],
    [3725, '1h 02m'],
    [90000, '25h 00m'],
    [12.9, '12s'],
    [-4, '0s'],
  ])('formats %d seconds as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('formatTime', () => {
  it('shows hours, minutes and seconds in the given time zone', () => {
    expect(formatTime(1700000000000, 'en-GB', 'UTC')).toBe('22:13:20');
  });

  it('uses 24-hour time at midnight', () => {
    expect(formatTime(Date.UTC(2023, 0, 1, 0, 5, 9), 'en-US', 'UTC')).toBe('00:05:09');
  });
});
