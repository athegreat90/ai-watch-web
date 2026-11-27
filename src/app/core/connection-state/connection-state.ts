import { Injectable, computed, inject } from '@angular/core';
import { SettingsStore } from '../settings/settings-store';
import { StatusPoller } from '../polling/status-poller';
import { ConnectionStatus, snapshotState } from './snapshot-state';

export { STALE_AFTER_INTERVALS } from './snapshot-state';
export type { ConnectionStatus } from './snapshot-state';

/** The connection to `/api/status`, which feeds the dashboard and the header. */
@Injectable({ providedIn: 'root' })
export class ConnectionState {
  private readonly state = snapshotState(inject(StatusPoller));
  private readonly settings = inject(SettingsStore);

  /** `demo` while the user has demo mode on, so example data is never mistaken for live data. */
  readonly status = computed<ConnectionStatus>(() =>
    this.settings.demo() ? 'demo' : this.state.status(),
  );
  readonly snapshot = this.state.snapshot;
  readonly lastSyncAt = this.state.lastSyncAt;
  readonly lastError = this.state.lastError;
  readonly elapsedSec = this.state.elapsedSec;
  readonly views = this.state.views;

  refresh(): void {
    this.state.refresh();
  }
}
