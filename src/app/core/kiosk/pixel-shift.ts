/** The picture moves a few pixels every minute, so no pixel stays lit forever. */
const OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [3, 0],
  [3, 3],
  [0, 3],
  [-3, 3],
  [-3, 0],
  [-3, -3],
  [0, -3],
  [3, -3],
];

/** The offset in pixels for a given minute. It cycles through nine positions around the centre. */
export function pixelShift(minute: number): { readonly x: number; readonly y: number } {
  const index = ((Math.floor(minute) % OFFSETS.length) + OFFSETS.length) % OFFSETS.length;
  const [x, y] = OFFSETS[index] ?? [0, 0];
  return { x, y };
}
