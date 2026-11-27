import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ConnectionBanner } from '../../shared/connection-banner/connection-banner';
import { SessionRow } from '../../shared/session-row/session-row';
import { SessionsFeed } from './sessions-feed';

@Component({
  selector: 'app-sessions',
  imports: [ConnectionBanner, SessionRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sessions.html',
  styleUrl: './sessions.scss',
})
export class Sessions {
  private readonly state = inject(SessionsFeed).state;

  protected readonly status = this.state.status;
  protected readonly lastSyncAt = this.state.lastSyncAt;
  protected readonly snapshot = this.state.snapshot;
  protected readonly views = this.state.views;

  /** The server lists at most 40 sessions. Say so when there are more. */
  protected readonly hiddenCount = computed(() =>
    Math.max(0, (this.snapshot()?.total_count ?? 0) - this.views().length),
  );

  protected refresh(): void {
    this.state.refresh();
  }
}
