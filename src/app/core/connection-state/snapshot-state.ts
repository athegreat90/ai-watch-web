import { DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, of, startWith, switchMap, timer } from 'rxjs';
import { ApiErrorKind } from '../api/errors';
import { Snapshot } from '../api/models';
import { toView } from '../api/session-view';
import { PollEvent } from '../polling/poll';
import { SnapshotSource } from '../polling/inject-poll';
import { Clock } from '../time/clock';

/** No success for this many poll intervals means the data is stale. */
export const STALE_AFTER_INTERVALS = 3;

export type ConnectionStatus =
  | 'connecting'
  | 'live'
  | 'stale'
  | 'offline'
  | 'token-rejected'
  | 'login-required'
  | 'config-error'
  /** The user turned demo mode on. Set by `ConnectionState`, never by the poll itself. */
  | 'demo';

/**
 * What the user should believe about the data on screen. The last good snapshot is kept through
 * errors, so a screen can keep showing it, labelled by `status`. Real data is never replaced.
 * Call it in an injection context: it listens until that context is destroyed.
 */
export function snapshotState(source: SnapshotSource) {
  const clock = inject(Clock);
  const destroyRef = inject(DestroyRef);
  const lastEvent = signal<PollEvent<Snapshot> | null>(null);
  const agedOut = signal(false);
  const good = signal<{ snapshot: Snapshot; at: number; monotonic: number } | null>(null);

  source.events$.pipe(takeUntilDestroyed(destroyRef)).subscribe((event) => {
    lastEvent.set(event);
    if (event.ok) good.set({ snapshot: event.data, at: event.at, monotonic: clock.monotonic() });
  });
  // A success that is not followed by another one in time turns stale (for example a hung request).
  source.events$
    .pipe(
      switchMap((event) =>
        event.ok
          ? timer(STALE_AFTER_INTERVALS * source.intervalMs).pipe(
              map(() => true),
              startWith(false),
            )
          : of(false),
      ),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe((aged) => agedOut.set(aged));

  const status = computed<ConnectionStatus>(() => {
    const event = lastEvent();
    if (!event) return 'connecting';
    if (event.ok) return agedOut() ? 'stale' : 'live';
    switch (event.error) {
      case 'token-rejected':
        return 'token-rejected';
      case 'login-required':
        return 'login-required';
      case 'config':
        return 'config-error';
      case 'offline':
        return 'offline';
      case 'unexpected':
        return 'stale';
    }
  });

  /** Whole seconds since the last good response arrived, counted on the monotonic clock. */
  const elapsedSec = computed(() => {
    const current = good();
    return current ? Math.max(0, Math.floor((clock.tick() - current.monotonic) / 1000)) : 0;
  });

  const snapshot = computed(() => good()?.snapshot ?? null);

  return {
    status,
    /** The last valid snapshot, kept while the connection is down. */
    snapshot,
    /** Wall-clock time of the last successful sync, for display only. */
    lastSyncAt: computed(() => good()?.at ?? null),
    lastError: computed<ApiErrorKind | null>(() => {
      const event = lastEvent();
      return event && !event.ok ? event.error : null;
    }),
    elapsedSec,
    /** The sessions in the server's order, with running times moved on from the response. */
    views: computed(
      () => snapshot()?.sessions.map((session) => toView(session, elapsedSec())) ?? [],
    ),
    refresh: () => source.refresh(),
  };
}

export type SnapshotState = ReturnType<typeof snapshotState>;
