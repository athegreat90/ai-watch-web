import { ALERT_REPEAT_MS, AlertTimer } from './alert-timer';

describe('AlertTimer', () => {
  it('repeats every two minutes', () => {
    expect(ALERT_REPEAT_MS).toBe(120_000);
  });

  it('fires when attention starts', () => {
    expect(new AlertTimer().poll(1000, true)).toBe(true);
  });

  it('stays quiet while nothing needs attention', () => {
    const timer = new AlertTimer();
    expect(timer.poll(0, false)).toBe(false);
    expect(timer.poll(500_000, false)).toBe(false);
  });

  it('is silent until the repeat time, then fires again', () => {
    const timer = new AlertTimer();
    timer.poll(0, true);
    expect(timer.poll(119_999, true)).toBe(false);
    expect(timer.poll(120_000, true)).toBe(true);
  });

  it('counts the next repeat from the last time it fired', () => {
    const timer = new AlertTimer();
    timer.poll(0, true);
    timer.poll(121_000, true);
    expect(timer.poll(240_999, true)).toBe(false);
    expect(timer.poll(241_000, true)).toBe(true);
  });

  it('forgets everything when attention clears, so the next attention fires at once', () => {
    const timer = new AlertTimer();
    timer.poll(0, true);
    timer.poll(10_000, false);
    expect(timer.poll(20_000, true)).toBe(true);
  });

  it('fires at once after a reset', () => {
    const timer = new AlertTimer();
    timer.poll(0, true);
    timer.reset();
    expect(timer.poll(1000, true)).toBe(true);
  });

  it('honours a different repeat time', () => {
    const timer = new AlertTimer(5000);
    timer.poll(0, true);
    expect(timer.poll(4999, true)).toBe(false);
    expect(timer.poll(5000, true)).toBe(true);
  });
});
