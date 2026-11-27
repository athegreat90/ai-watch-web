import { Injectable, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, map, switchMap, timer } from 'rxjs';
import { PAGE_VISIBLE } from '../polling/page-visibility';

/**
 * Local time for things that keep counting between server responses. It is monotonic, so a change
 * of the browser's wall clock cannot move it, and it stops ticking while the tab is hidden.
 */
@Injectable({ providedIn: 'root' })
export class Clock {
  private readonly visible$ = inject(PAGE_VISIBLE);

  monotonic(): number {
    return performance.now();
  }

  /** Wall-clock milliseconds since the epoch. Only for times that must survive a reload. */
  wallNow(): number {
    return Date.now();
  }

  /** The monotonic time in milliseconds, refreshed every second while the page is visible. */
  readonly tick: Signal<number> = toSignal(
    this.visible$.pipe(
      switchMap((visible) => (visible ? timer(0, 1000).pipe(map(() => this.monotonic())) : EMPTY)),
    ),
    { initialValue: this.monotonic() },
  );
}
