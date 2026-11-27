import {
  Observable,
  catchError,
  defer,
  expand,
  filter,
  map,
  of,
  race,
  switchMap,
  take,
  tap,
  timeout,
  timer,
} from 'rxjs';
import { ApiErrorKind, classifyError } from '../api/errors';

export type PollEvent<T> =
  | { readonly ok: true; readonly data: T; readonly at: number }
  | { readonly ok: false; readonly error: ApiErrorKind; readonly at: number };

export interface PollConfig<T> {
  /** One request. Unsubscribing must cancel it. */
  fetch: () => Observable<T>;
  /** Emits the current visibility on subscribe, then every change. Polling waits while false. */
  visible$: Observable<boolean>;
  /** Emits when the user asks for an immediate refresh. */
  refresh$: Observable<void>;
  /** Wait after a success, measured from the end of the request. */
  intervalMs: number;
  timeoutMs: number;
  maxBackoffMs: number;
  /** Fraction of the backoff added or removed at random. Default 0.2. */
  jitter?: number;
  random?: () => number;
  now?: () => number;
}

/** Failure 1 waits `base`, then 2x, 4x, 8x, up to `max`. Jitter never pushes it past `max`. */
export function backoffDelay(
  failures: number,
  base: number,
  max: number,
  jitter: number,
  random: () => number,
): number {
  const raw = Math.min(max, base * 2 ** (failures - 1));
  return Math.min(max, Math.max(0, Math.round(raw + raw * jitter * (random() * 2 - 1))));
}

/**
 * Polls one request at a time. A request starts only while the page is visible. After a success
 * the next one waits `intervalMs`. After a failure the wait grows until `maxBackoffMs`, and one
 * success resets it. A refresh request skips the wait but never overlaps a request in flight.
 * Unsubscribing cancels the request and the timers.
 */
export function poll<T>(config: PollConfig<T>): Observable<PollEvent<T>> {
  const { intervalMs, timeoutMs, maxBackoffMs, jitter = 0.2 } = config;
  const random = config.random ?? Math.random;
  const now = config.now ?? Date.now;

  return defer(() => {
    let failures = 0;

    const request = (): Observable<PollEvent<T>> =>
      config.visible$.pipe(
        filter(Boolean),
        take(1),
        switchMap(() =>
          config.fetch().pipe(
            take(1),
            timeout(timeoutMs),
            map((data): PollEvent<T> => ({ ok: true, data, at: now() })),
            catchError((error: unknown) =>
              of<PollEvent<T>>({ ok: false, error: classifyError(error), at: now() }),
            ),
          ),
        ),
        tap((event) => {
          failures = event.ok ? 0 : failures + 1;
        }),
      );

    return request().pipe(
      expand(() => {
        const wait =
          failures === 0
            ? intervalMs
            : backoffDelay(failures, intervalMs, maxBackoffMs, jitter, random);
        return race(timer(wait), config.refresh$.pipe(take(1))).pipe(
          take(1),
          switchMap(() => request()),
        );
      }),
    );
  });
}
