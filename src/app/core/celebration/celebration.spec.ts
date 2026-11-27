import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { Snapshot } from '../api/models';
import { MeetingMode } from '../meeting/meeting-mode';
import { PollEvent } from '../polling/poll';
import { StatusPoller } from '../polling/status-poller';
import { Clock } from '../time/clock';
import { session, snapshot } from '../../testing/fixtures';
import { CELEBRATION_MS, CelebrationService, findFinished, turnKey } from './celebration';

const working = (over = {}) => session({ status: 'working', ...over });
const finished = (over = {}) =>
  session({ status: 'done', finished_long: true, duration: 395, ...over });

describe('findFinished', () => {
  const none = new Set<string>();

  it('finds a session that went from working to done after a long task', () => {
    const found = findFinished(snapshot([working()]), snapshot([finished()]), none);
    expect(found.map((s) => s.session_id)).toEqual(['s1']);
  });

  it('needs a previous snapshot', () => {
    expect(findFinished(null, snapshot([finished()]), none)).toEqual([]);
  });

  it('ignores a short task', () => {
    expect(
      findFinished(snapshot([working()]), snapshot([finished({ finished_long: false })]), none),
    ).toEqual([]);
  });

  it('ignores a session first seen as done', () => {
    expect(findFinished(snapshot([]), snapshot([finished()]), none)).toEqual([]);
  });

  it.each(['needs_attention', 'idle', 'done', 'error', 'notice'])(
    'ignores a session that was %s before, not working',
    (status) => {
      expect(findFinished(snapshot([session({ status })]), snapshot([finished()]), none)).toEqual(
        [],
      );
    },
  );

  it('does not mix up the same session id under two agents', () => {
    const before = snapshot([working({ agent: 'Codex' })]);
    const after = snapshot([finished({ agent: 'Claude Code' })]);
    expect(findFinished(before, after, none)).toEqual([]);
  });

  it('ignores a turn that was already celebrated', () => {
    const done = finished();
    expect(findFinished(snapshot([working()]), snapshot([done]), new Set([turnKey(done)]))).toEqual(
      [],
    );
  });

  it('treats a new turn of the same session as new', () => {
    const old = finished({ started: 1700000000 });
    const next = finished({ started: 1700009999 });
    expect(
      findFinished(snapshot([working()]), snapshot([next]), new Set([turnKey(old)])),
    ).toHaveLength(1);
  });
});

describe('CelebrationService', () => {
  let events$: Subject<PollEvent<Snapshot>>;
  let service: CelebrationService;
  let meeting: MeetingMode;
  let now: number;

  const ok = (data: Snapshot) => events$.next({ ok: true, data, at: 0 });
  const advance = (ms: number) => {
    now += ms;
    return vi.advanceTimersByTimeAsync(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    events$ = new Subject();
    TestBed.configureTestingModule({
      providers: [
        { provide: StatusPoller, useValue: { events$, intervalMs: 3000 } },
        { provide: Clock, useValue: { monotonic: () => now, wallNow: () => 0, tick: signal(0) } },
      ],
    });
    service = TestBed.inject(CelebrationService);
    meeting = TestBed.inject(MeetingMode);
  });

  afterEach(() => vi.useRealTimers());

  it('celebrates a long task that just finished, with its project and time', () => {
    ok(snapshot([working({ project: 'docs-site' })]));
    advance(3000);
    ok(snapshot([finished({ project: 'docs-site', duration: 395 })]));
    expect(service.current()).toEqual({
      project: 'docs-site',
      agent: 'Claude Code',
      durationSec: 395,
    });
  });

  it('lasts four seconds', async () => {
    ok(snapshot([working()]));
    await advance(3000);
    ok(snapshot([finished()]));
    await advance(CELEBRATION_MS - 1);
    expect(service.current()).not.toBeNull();
    await advance(1);
    expect(service.current()).toBeNull();
  });

  it('can be ended early', () => {
    ok(snapshot([working()]));
    advance(3000);
    ok(snapshot([finished()]));
    service.dismiss();
    expect(service.current()).toBeNull();
  });

  it('celebrates a turn only once, even if it flips back and forth', async () => {
    ok(snapshot([working()]));
    await advance(3000);
    ok(snapshot([finished()]));
    service.dismiss();
    await advance(3000);
    ok(snapshot([working()]));
    await advance(3000);
    ok(snapshot([finished()]));
    expect(service.current()).toBeNull();
  });

  it('celebrates the next turn of the same session', async () => {
    ok(snapshot([working()]));
    await advance(3000);
    ok(snapshot([finished({ started: 1700000000 })]));
    service.dismiss();
    await advance(3000);
    ok(snapshot([working({ started: 1700009000 })]));
    await advance(3000);
    ok(snapshot([finished({ started: 1700009000 })]));
    expect(service.current()).not.toBeNull();
  });

  it('does not celebrate a task that was never seen working', () => {
    ok(snapshot([]));
    advance(3000);
    ok(snapshot([finished()]));
    expect(service.current()).toBeNull();
  });

  it('skips the celebration in a meeting, and does not save it for later', async () => {
    meeting.manual.set(true);
    ok(snapshot([working()]));
    await advance(3000);
    ok(snapshot([finished()]));
    expect(service.current()).toBeNull();
    meeting.manual.set(false);
    await advance(3000);
    ok(snapshot([finished()]));
    expect(service.current()).toBeNull();
  });

  it('forgets what it saw after an error, so a finish across an outage is not celebrated', async () => {
    ok(snapshot([working()]));
    await advance(3000);
    events$.next({ ok: false, error: 'offline', at: 0 });
    await advance(3000);
    ok(snapshot([finished()]));
    expect(service.current()).toBeNull();
  });

  it('does not celebrate a finish noticed after a long gap', async () => {
    ok(snapshot([working()]));
    await advance(3 * 3000 + 1);
    ok(snapshot([finished()]));
    expect(service.current()).toBeNull();
  });

  it('still celebrates when the gap is within three intervals', async () => {
    ok(snapshot([working()]));
    await advance(3 * 3000);
    ok(snapshot([finished()]));
    expect(service.current()).not.toBeNull();
  });

  it('shows the latest when two tasks finish together', async () => {
    ok(
      snapshot([
        working({ session_id: 'a', project: 'first' }),
        working({ session_id: 'b', project: 'second' }),
      ]),
    );
    await advance(3000);
    ok(
      snapshot([
        finished({ session_id: 'a', project: 'first' }),
        finished({ session_id: 'b', project: 'second' }),
      ]),
    );
    expect(service.current()?.project).toBe('second');
  });

  it('stops its timer when the app closes', async () => {
    ok(snapshot([working()]));
    await advance(3000);
    ok(snapshot([finished()]));
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
