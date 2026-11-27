import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDuration } from '../../core/api/session-view';
import { ConnectionState } from '../../core/connection-state/connection-state';
import { ConnectionBanner } from '../../shared/connection-banner/connection-banner';
import { SessionRow } from '../../shared/session-row/session-row';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, ConnectionBanner, SessionRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly connection = inject(ConnectionState);

  protected readonly status = this.connection.status;
  protected readonly lastSyncAt = this.connection.lastSyncAt;
  protected readonly snapshot = this.connection.snapshot;
  protected readonly views = this.connection.views;

  /** `/api/status` lists at most 8 sessions, while the counter covers all of them. */
  protected readonly hiddenCount = computed(() =>
    Math.max(0, (this.snapshot()?.total_count ?? 0) - this.views().length),
  );

  protected readonly syncedAgo = computed(() =>
    this.lastSyncAt() === null
      ? null
      : `Synced ${formatDuration(this.connection.elapsedSec())} ago`,
  );

  protected refresh(): void {
    this.connection.refresh();
  }
}
