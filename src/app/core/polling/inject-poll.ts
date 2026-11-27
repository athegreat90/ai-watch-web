import { inject } from '@angular/core';
import { Observable, Subject, shareReplay } from 'rxjs';
import { Snapshot } from '../api/models';
import { RuntimeConfig } from '../config/runtime-config';
import { SettingsStore } from '../settings/settings-store';
import { PAGE_VISIBLE } from './page-visibility';
import { PollEvent, poll } from './poll';

export const REQUEST_TIMEOUT_MS = 4000;
export const MAX_BACKOFF_MS = 30000;

/** What the connection state needs from a poll. */
export interface SnapshotSource {
  readonly events$: Observable<PollEvent<Snapshot>>;
  readonly intervalMs: number;
  refresh(): void;
}

/**
 * A shared poll of one endpoint. It runs while something listens and stops when nobody does.
 * Call it in an injection context. The interval is read once, so the config must be loaded first.
 * `intervalFactor` slows this poll down relative to the chosen interval (the list of sessions asks
 * at twice it). The stale rule of the connection state counts this poll's own interval.
 */
export function injectPoll(
  fetch: () => Observable<Snapshot>,
  options: { readonly intervalFactor?: number } = {},
): SnapshotSource {
  const visible$ = inject(PAGE_VISIBLE);
  // The user's own choice wins over the deployment default. It is read once, so a change in
  // Settings applies after a reload.
  const intervalMs =
    (inject(SettingsStore).pollIntervalMs() ?? inject(RuntimeConfig).value().pollIntervalMs) *
    (options.intervalFactor ?? 1);
  const refreshRequests = new Subject<void>();
  const events$ = poll({
    fetch,
    visible$,
    refresh$: refreshRequests,
    intervalMs,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxBackoffMs: MAX_BACKOFF_MS,
  }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
  return { events$, intervalMs, refresh: () => refreshRequests.next() };
}
