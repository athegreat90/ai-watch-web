import { TestBed } from '@angular/core/testing';
import { ReplaySubject } from 'rxjs';
import { ApiErrorKind } from '../api/errors';
import { Snapshot } from '../api/models';
import { PollEvent } from '../polling/poll';
import { StatusPoller } from '../polling/status-poller';
import { ConnectionState, ConnectionStatus } from './connection-state';

const snapshot = (total = 0): Snapshot => ({
  sessions: [],
  limits: {},
  active_count: 0,
  attention_count: 0,
  total_count: total,
});

describe('ConnectionState', () => {
  let events$: ReplaySubject<PollEvent<Snapshot>>;
  let state: ConnectionState;
  const refresh = vi.fn();

  const succeed = (total = 0, at = 1000) => events$.next({ ok: true, data: snapshot(total), at });
  const fail = (error: ApiErrorKind, at = 2000) => events$.next({ ok: false, error, at });

  beforeEach(() => {
    vi.useFakeTimers();
    events$ = new ReplaySubject(1);
    TestBed.configureTestingModule({
      providers: [{ provide: StatusPoller, useValue: { events$, intervalMs: 3000, refresh } }],
    });
    state = TestBed.inject(ConnectionState);
  });

  afterEach(() => vi.useRealTimers());

  it('starts as connecting, with no data', () => {
    expect(state.status()).toBe('connecting');
    expect(state.snapshot()).toBeNull();
    expect(state.lastSyncAt()).toBeNull();
  });

  it('is live after a success and records the sync time', () => {
    succeed(2, 1234);
    expect(state.status()).toBe('live');
    expect(state.snapshot()?.total_count).toBe(2);
    expect(state.lastSyncAt()).toBe(1234);
  });

  it.each<[ApiErrorKind, ConnectionStatus]>([
    ['offline', 'offline'],
    ['token-rejected', 'token-rejected'],
    ['login-required', 'login-required'],
    ['config', 'config-error'],
    ['unexpected', 'stale'],
  ])('shows %s as %s and keeps the last good data', (error, expected) => {
    succeed(5, 1000);
    fail(error);
    expect(state.status()).toBe(expected);
    expect(state.lastError()).toBe(error);
    expect(state.snapshot()?.total_count).toBe(5);
    expect(state.lastSyncAt()).toBe(1000);
  });

  it('shows an error before any data without inventing a snapshot', () => {
    fail('offline');
    expect(state.status()).toBe('offline');
    expect(state.snapshot()).toBeNull();
  });

  it('recovers to live on the next success and clears the error', () => {
    fail('offline');
    succeed(1, 3000);
    expect(state.status()).toBe('live');
    expect(state.lastError()).toBeNull();
  });

  it('turns stale when no new success arrives within three intervals', async () => {
    succeed();
    await vi.advanceTimersByTimeAsync(8999);
    expect(state.status()).toBe('live');
    await vi.advanceTimersByTimeAsync(1);
    expect(state.status()).toBe('stale');
    succeed(0, 9000);
    expect(state.status()).toBe('live');
  });

  it('does not turn stale on top of an error', async () => {
    succeed();
    fail('offline');
    await vi.advanceTimersByTimeAsync(20000);
    expect(state.status()).toBe('offline');
  });

  it('passes a refresh on to the poller', () => {
    state.refresh();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
