import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { PAGE_VISIBLE } from '../polling/page-visibility';
import { Clock } from './clock';

describe('Clock', () => {
  let visible$: BehaviorSubject<boolean>;
  let clock: Clock;
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    visible$ = new BehaviorSubject(true);
    TestBed.configureTestingModule({ providers: [{ provide: PAGE_VISIBLE, useValue: visible$ }] });
    clock = TestBed.inject(Clock);
  });

  afterEach(() => vi.useRealTimers());

  it('gives wall-clock time for things that must survive a reload', () => {
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    expect(clock.wallNow()).toBe(Date.parse('2026-01-02T03:04:05Z'));
  });

  it('moves on every second while the page is visible', async () => {
    const start = clock.tick();
    await advance(1000);
    expect(clock.tick() - start).toBe(1000);
    await advance(2000);
    expect(clock.tick() - start).toBe(3000);
  });

  it('stops while the page is hidden', async () => {
    await advance(1000);
    visible$.next(false);
    const frozen = clock.tick();
    await advance(10000);
    expect(clock.tick()).toBe(frozen);
  });

  it('catches up at once when the page shows again', async () => {
    visible$.next(false);
    await advance(10000);
    visible$.next(true);
    await advance(0);
    expect(clock.tick()).toBe(clock.monotonic());
  });
});
