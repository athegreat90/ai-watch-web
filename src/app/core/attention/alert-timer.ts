/** The firmware repeats the NEEDS YOU alert every two minutes while a session still needs you. */
export const ALERT_REPEAT_MS = 120_000;

/**
 * Decides when the alert should show. It fires when attention starts, then again every
 * `repeatMs` while attention lasts, counted from when it last fired. When attention clears it
 * forgets everything, so the next attention fires at once. Ported from the firmware's `AlertTimer`.
 */
export class AlertTimer {
  private last: number | null = null;

  constructor(private readonly repeatMs: number = ALERT_REPEAT_MS) {}

  poll(now: number, attention: boolean): boolean {
    if (!attention) {
      this.last = null;
      return false;
    }
    if (this.last === null || now - this.last >= this.repeatMs) {
      this.last = now;
      return true;
    }
    return false;
  }

  reset(): void {
    this.last = null;
  }
}
