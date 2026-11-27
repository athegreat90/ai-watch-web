import { Injectable, inject } from '@angular/core';
import { StatusApi } from '../api/status-api';
import { DemoSource } from '../demo/demo-source';
import { SnapshotSource, injectPoll } from './inject-poll';

/** The one shared `/api/status` poll for the whole app. */
@Injectable({ providedIn: 'root' })
export class StatusPoller implements SnapshotSource {
  private readonly api = inject(StatusApi);
  private readonly demo = inject(DemoSource);
  private readonly shared = injectPoll(() =>
    this.demo.enabled() ? this.demo.snapshot() : this.api.status(),
  );

  readonly events$ = this.shared.events$;
  readonly intervalMs = this.shared.intervalMs;

  /** Starts the next request now, unless one is already in flight. */
  refresh(): void {
    this.shared.refresh();
  }
}
