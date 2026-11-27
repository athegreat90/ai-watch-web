import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  BehaviorSubject,
  NEVER,
  Observable,
  Subject,
  defer,
  map,
  of,
  throwError,
  timer,
} from 'rxjs';
import { PollEvent, backoffDelay, poll } from './poll';

describe('backoffDelay', () => {
  it('doubles from the interval up to the cap', () => {
    const delays = [1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, 3000, 30000, 0, () => 0.5));
    expect(delays).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
  });

  it('spreads by the jitter fraction and never passes the cap', () => {
    expect(backoffDelay(2, 3000, 30000, 0.2, () => 0)).toBe(4800);
    expect(backoffDelay(2, 3000, 30000, 0.2, () => 1)).toBe(7200);
    expect(backoffDelay(6, 3000, 30000, 0.2, () => 1)).toBe(30000);
  });
});

describe('poll', () => {
  const unavailable = () => throwError(() => new HttpErrorResponse({ status: 503 }));

  let started: number;
  let calls: number[];
  let events: PollEvent<string>[];
  let refresh$: Subject<void>;
  let visible$: BehaviorSubject<boolean>;
  let behaviour: () => Observable<string>;
  let subscription: { unsubscribe(): void };

  function start(options: { visible?: boolean; timeoutMs?: number } = {}) {
    refresh$ = new Subject<void>();
    visible$ = new BehaviorSubject(options.visible ?? true);
    subscription = poll<string>({
      fetch: () =>
        defer(() => {
          calls.push(Date.now() - started);
          return behaviour();
        }),
      visible$,
      refresh$,
      intervalMs: 3000,
      timeoutMs: options.timeoutMs ?? 4000,
      maxBackoffMs: 30000,
      jitter: 0,
    }).subscribe((event) => events.push(event));
  }

  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    started = Date.now();
    calls = [];
    events = [];
    behaviour = () => of('ok');
  });

  afterEach(() => {
    subscription.unsubscribe();
    vi.useRealTimers();
  });

  it('asks at once, then every interval after each request ends', async () => {
    start();
    await advance(0);
    expect(calls).toEqual([0]);
    await advance(2999);
    expect(calls).toEqual([0]);
    await advance(1);
    expect(calls).toEqual([0, 3000]);
    expect(events.map((e) => e.ok)).toEqual([true, true]);
  });

  it('counts the interval from the end of a slow request', async () => {
    behaviour = () => timer(1000).pipe(map(() => 'ok'));
    start();
    await advance(10000);
    expect(calls).toEqual([0, 4000, 8000]);
  });

  it('never overlaps: a refresh during a request does nothing', async () => {
    const pending = new Subject<string>();
    behaviour = () => pending;
    start({ timeoutMs: 60000 });
    await advance(500);
    refresh$.next();
    await advance(10000);
    expect(calls).toEqual([0]);
    pending.next('late');
    pending.complete();
    await advance(2999);
    expect(calls).toEqual([0]);
    await advance(1);
    expect(calls.length).toBe(2);
  });

  it('skips the wait when the user refreshes', async () => {
    start();
    await advance(1000);
    refresh$.next();
    await advance(0);
    expect(calls).toEqual([0, 1000]);
    await advance(3000);
    expect(calls).toEqual([0, 1000, 4000]);
  });

  it('backs off 3, 6, 12, 24, 30 s after failures and resets after one success', async () => {
    behaviour = unavailable;
    start();
    await advance(3000 + 6000 + 12000 + 24000 + 30000 + 30000);
    expect(calls).toEqual([0, 3000, 9000, 21000, 45000, 75000, 105000]);
    expect(events.every((e) => !e.ok)).toBe(true);

    behaviour = () => of('ok');
    await advance(30000);
    expect(calls.at(-1)).toBe(135000);
    await advance(3000);
    expect(calls.at(-1)).toBe(138000);
  });

  it('reports a request that never answers as offline after the timeout', async () => {
    behaviour = () => NEVER;
    start();
    await advance(3999);
    expect(events).toEqual([]);
    await advance(1);
    expect(events).toMatchObject([{ ok: false, error: 'offline' }]);
  });

  it('classifies the failure it reports', async () => {
    behaviour = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            headers: new HttpHeaders({ 'X-AIW-Upstream-Status': '401' }),
          }),
      );
    start();
    await advance(0);
    expect(events).toMatchObject([{ ok: false, error: 'token-rejected' }]);
  });

  it('waits while the page is hidden and asks the moment it shows', async () => {
    start({ visible: false });
    await advance(20000);
    expect(calls).toEqual([]);
    visible$.next(true);
    await advance(0);
    expect(calls).toEqual([20000]);
  });

  it('asks again right away when the page shows after the wait ran out while hidden', async () => {
    start();
    await advance(0);
    visible$.next(false);
    await advance(10000);
    expect(calls).toEqual([0]);
    visible$.next(true);
    await advance(0);
    expect(calls).toEqual([0, 10000]);
  });

  it('cancels the request in flight and stops the timers when unsubscribed', async () => {
    let cancelled = false;
    behaviour = () =>
      new Observable<string>(() => () => {
        cancelled = true;
      });
    start({ timeoutMs: 60000 });
    await advance(100);
    subscription.unsubscribe();
    expect(cancelled).toBe(true);
    await advance(60000);
    expect(calls).toEqual([0]);
  });
});
