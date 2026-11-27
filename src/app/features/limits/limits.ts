import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatDuration } from '../../core/api/session-view';
import { ConnectionState } from '../../core/connection-state/connection-state';
import {
  LimitWindowView,
  formatDateTime,
  formatResetIn,
  toLimitRows,
} from '../../core/limits/limits-view';
import { ConnectionBanner } from '../../shared/connection-banner/connection-banner';

@Component({
  selector: 'app-limits',
  imports: [ConnectionBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './limits.html',
  styleUrl: './limits.scss',
})
export class Limits {
  private readonly connection = inject(ConnectionState);

  protected readonly status = this.connection.status;
  protected readonly lastSyncAt = this.connection.lastSyncAt;
  protected readonly snapshot = this.connection.snapshot;

  protected readonly rows = computed(() =>
    toLimitRows(
      this.snapshot()?.limits ?? {},
      this.connection.elapsedSec(),
      this.connection.lastSyncAt(),
    ),
  );

  protected readonly syncedAgo = computed(() =>
    this.lastSyncAt() === null
      ? null
      : `Synced ${formatDuration(this.connection.elapsedSec())} ago`,
  );

  protected resetText(window: LimitWindowView): string {
    return window.resetsInSec === 0
      ? 'Reset due. Waiting for new data.'
      : `Resets in ${formatResetIn(window.resetsInSec)} · ${formatDateTime(window.resetsAtMs)}`;
  }

  protected refresh(): void {
    this.connection.refresh();
  }
}
