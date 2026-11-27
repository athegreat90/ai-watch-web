import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clock } from '../time/clock';
import { FOCUS_MS, FocusTimer, formatClock } from './focus-timer';

const MIN = 60_000;

describe('formatClock', () => {
  it.each([
    [FOCUS_MS, '25:00'],
    [FOCUS_MS - 1, '25:00'],
    [4 * MIN + 7000, '04:07'],
    [1, '00:01'],
    [1000, '00:01'],
    [1001, '00:02'],
    [0, '00:00'],
    [-500, '00:00'],
  ])('shows %d ms as %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

describe('FocusTimer', () => {
  const tick = signal(0);
  let wall: number;
  let timer: FocusTimer;

  function create() {
    TestBed.configureTestingModule({
      providers: [{ provide: Clock, useValue: { tick, monotonic: () => 0, wallNow: () => wall } }],
    });
    timer = TestBed.inject(FocusTimer);
  }

  /** Moves the wall clock on. With `ticks` false the page is asleep and nothing looks at it. */
  const advance = (ms: number, ticks = true) => {
    wall += ms;
    if (ticks) tick.set(wall);
    return vi.advanceTimersByTimeAsync(ms);
  };

  const saved = () => JSON.parse(localStorage.getItem('aiw.focus') ?? 'null');

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    wall = 1_000_000;
    tick.set(wall);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('is ready for 25 minutes and not running', () => {
    create();
    expect(timer.phase()).toBe('idle');
    expect(formatClock(timer.remainingMs())).toBe('25:00');
    expect(timer.running()).toBe(false);
  });

  it('counts down once started', async () => {
    create();
    timer.toggle();
    expect(timer.phase()).toBe('running');
    expect(timer.running()).toBe(true);
    await advance(5000);
    expect(formatClock(timer.remainingMs())).toBe('24:55');
  });

  it('stays exact when the page was asleep, because it counts from timestamps', async () => {
    create();
    timer.toggle();
    await advance(10 * MIN, false);
    tick.set(wall);
    expect(formatClock(timer.remainingMs())).toBe('15:00');
  });

  it('pauses and keeps the time that was left', async () => {
    create();
    timer.toggle();
    await advance(5 * MIN);
    timer.toggle();
    expect(timer.phase()).toBe('paused');
    expect(timer.running()).toBe(false);
    await advance(10 * MIN);
    expect(formatClock(timer.remainingMs())).toBe('20:00');
  });

  it('resumes from where it paused, without drifting', async () => {
    create();
    timer.toggle();
    await advance(5 * MIN);
    timer.toggle();
    await advance(3 * MIN);
    timer.toggle();
    expect(timer.phase()).toBe('running');
    await advance(MIN);
    expect(formatClock(timer.remainingMs())).toBe('19:00');
  });

  it('finishes after 25 minutes, and a running timer is no longer running', async () => {
    create();
    timer.toggle();
    await advance(FOCUS_MS - 1000);
    expect(timer.running()).toBe(true);
    await advance(1000);
    expect(timer.phase()).toBe('done');
    expect(timer.running()).toBe(false);
    expect(timer.remainingMs()).toBe(0);
  });

  it('records the end on time even when nobody is looking', async () => {
    create();
    timer.toggle();
    await advance(FOCUS_MS + 100, false);
    expect(saved()).toEqual({ phase: 'done' });
  });

  it('starts a fresh 25 minutes from the done state', async () => {
    create();
    timer.toggle();
    await advance(FOCUS_MS);
    timer.toggle();
    expect(timer.phase()).toBe('running');
    expect(formatClock(timer.remainingMs())).toBe('25:00');
  });

  it('resets to ready at any time, and stops the clock', async () => {
    create();
    timer.toggle();
    await advance(5 * MIN);
    timer.reset();
    expect(timer.phase()).toBe('idle');
    expect(formatClock(timer.remainingMs())).toBe('25:00');
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('surviving a reload', () => {
    it('picks up a running timer where it is', async () => {
      create();
      timer.toggle();
      await advance(7 * MIN);
      TestBed.resetTestingModule();
      create();
      expect(timer.phase()).toBe('running');
      expect(formatClock(timer.remainingMs())).toBe('18:00');
    });

    it('finishes a timer that ran out while the page was closed', async () => {
      create();
      timer.toggle();
      TestBed.resetTestingModule();
      wall += FOCUS_MS + 5000;
      tick.set(wall);
      create();
      expect(timer.phase()).toBe('done');
    });

    it('keeps a paused timer paused with its time', async () => {
      create();
      timer.toggle();
      await advance(10 * MIN);
      timer.toggle();
      TestBed.resetTestingModule();
      wall += 99 * MIN;
      create();
      expect(timer.phase()).toBe('paused');
      expect(formatClock(timer.remainingMs())).toBe('15:00');
    });

    it.each([
      ['not json'],
      ['{"phase":"running"}'],
      ['{"phase":"paused","remainingMs":-5}'],
      ['null'],
      ['7'],
    ])('starts fresh from unreadable saved data %s', (value) => {
      localStorage.setItem('aiw.focus', value);
      create();
      expect(timer.phase()).toBe('idle');
    });

    it('still works when the browser refuses to store', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      create();
      expect(() => timer.toggle()).not.toThrow();
      expect(timer.phase()).toBe('running');
    });

    it('still starts when the browser refuses to read', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      create();
      expect(timer.phase()).toBe('idle');
    });
  });

  it('stops its timeout when the app closes', async () => {
    create();
    timer.toggle();
    TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0);
  });
});
