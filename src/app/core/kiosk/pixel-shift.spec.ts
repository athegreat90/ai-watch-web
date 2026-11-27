import { pixelShift } from './pixel-shift';

describe('pixelShift', () => {
  it('starts in the centre', () => {
    expect(pixelShift(0)).toEqual({ x: 0, y: 0 });
  });

  it('moves a little on every minute and repeats after nine', () => {
    const cycle = Array.from({ length: 9 }, (_, minute) => pixelShift(minute));
    expect(new Set(cycle.map(({ x, y }) => `${x},${y}`)).size).toBe(9);
    expect(pixelShift(9)).toEqual(cycle[0]);
    expect(pixelShift(13)).toEqual(cycle[4]);
  });

  it('never moves further than a few pixels, so nothing is cut off', () => {
    for (let minute = 0; minute < 50; minute++) {
      const { x, y } = pixelShift(minute);
      expect(Math.abs(x)).toBeLessThanOrEqual(4);
      expect(Math.abs(y)).toBeLessThanOrEqual(4);
    }
  });

  it('holds within a minute and copes with odd input', () => {
    expect(pixelShift(2.9)).toEqual(pixelShift(2));
    expect(pixelShift(-1)).toEqual(pixelShift(8));
  });
});
