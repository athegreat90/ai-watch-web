import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { Snapshot } from '../api/models';
import { PollEvent } from '../polling/poll';
import { session, snapshot } from '../../testing/fixtures';
import { SnapshotState, snapshotState } from './snapshot-state';

describe('snapshotState: local time', () => {
  let events$: Subject<PollEvent<Snapshot>>;
  let state: SnapshotState;
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    events$ = new Subject();
    state = TestBed.runInInjectionContext(() =>
      snapshotState({ events$, intervalMs: 3000, refresh: () => undefined }),
    );
  });

  afterEach(() => vi.useRealTimers());

  const succeed = (...sessions: ReturnType<typeof session>[]) =>
    events$.next({ ok: true, data: snapshot(sessions), at: Date.now() });

  it('counts whole seconds since the last good response', async () => {
    succeed();
    await advance(2500);
    expect(state.elapsedSec()).toBe(2);
    await advance(1000);
    expect(state.elapsedSec()).toBe(3);
  });

  it('moves running sessions on and leaves finished ones alone', async () => {
    succeed(
      session({ session_id: 'a', status: 'working', duration: 100 }),
      session({ session_id: 'b', status: 'done', duration: 100 }),
    );
    await advance(5000);
    expect(state.views().map((v) => [v.sessionId, v.durationSec])).toEqual([
      ['a', 105],
      ['b', 100],
    ]);
  });

  it('starts counting again from a new response', async () => {
    succeed(session({ duration: 100 }));
    await advance(5000);
    succeed(session({ duration: 200 }));
    await advance(1000);
    expect(state.views()[0]?.durationSec).toBe(201);
  });

  it('keeps counting from the last good data while the server is unreachable', async () => {
    succeed(session({ duration: 100 }));
    events$.next({ ok: false, error: 'offline', at: Date.now() });
    await advance(4000);
    expect(state.status()).toBe('offline');
    expect(state.views()[0]?.durationSec).toBe(104);
  });

  it('has no sessions and no elapsed time before the first response', () => {
    expect(state.views()).toEqual([]);
    expect(state.elapsedSec()).toBe(0);
  });

  it('keeps the server order of the sessions', () => {
    succeed(
      session({ session_id: 'b' }),
      session({ session_id: 'a' }),
      session({ session_id: 'c' }),
    );
    expect(state.views().map((v) => v.sessionId)).toEqual(['b', 'a', 'c']);
  });
});
