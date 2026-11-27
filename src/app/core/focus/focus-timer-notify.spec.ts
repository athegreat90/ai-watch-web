import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Notifier } from '../notify/notifier';
import { Clock } from '../time/clock';
import { FOCUS_MS, FocusTimer } from './focus-timer';

describe('FocusTimer and the tone', () => {
  const tick = signal(0);
  const notifier = { attention: vi.fn(), focusComplete: vi.fn() };
  let wall: number;
  let timer: FocusTimer;

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: Clock, useValue: { tick, monotonic: () => 0, wallNow: () => wall } },
        { provide: Notifier, useValue: notifier },
      ],
    });
    timer = TestBed.inject(FocusTimer);
  }

  const advance = (ms: number) => {
    wall += ms;
    tick.set(wall);
    return vi.advanceTimersByTimeAsync(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    notifier.focusComplete.mockClear();
    wall = 1_000_000;
    tick.set(wall);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('speaks up once when the 25 minutes are up', async () => {
    create();
    timer.toggle();
    await advance(FOCUS_MS - 1000);
    expect(notifier.focusComplete).not.toHaveBeenCalled();
    await advance(1100);
    expect(notifier.focusComplete).toHaveBeenCalledOnce();
  });

  it('speaks up even when nobody is looking at the page', async () => {
    create();
    timer.toggle();
    wall += FOCUS_MS + 100;
    await vi.advanceTimersByTimeAsync(FOCUS_MS + 100);
    expect(notifier.focusComplete).toHaveBeenCalledOnce();
  });

  it('stays quiet when paused or reset', async () => {
    create();
    timer.toggle();
    await advance(10 * 60_000);
    timer.toggle();
    await advance(FOCUS_MS * 2);
    timer.reset();
    await advance(FOCUS_MS * 2);
    expect(notifier.focusComplete).not.toHaveBeenCalled();
  });

  it('stays quiet for a timer that ran out while the page was closed', () => {
    localStorage.setItem('aiw.focus', JSON.stringify({ phase: 'running', endsAt: wall - 5000 }));
    create();
    expect(timer.phase()).toBe('done');
    expect(notifier.focusComplete).not.toHaveBeenCalled();
  });
});
