import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ConnectionStatus } from '../../core/connection-state/snapshot-state';
import { connectionMessage } from '../../core/connection-state/messages';
import { formatTime } from '../../core/api/session-view';

/** The line above a screen's data when the connection is not healthy. It shows nothing when it is. */
@Component({
  selector: 'app-connection-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (message(); as text) {
    <p class="banner" role="status">{{ text }}</p>
  }`,
  styles: `
    .banner {
      margin: 0 0 1rem;
      padding: 0.5rem 0.875rem;
      border: 1px solid var(--aiw-attention);
      border-radius: 6px;
      color: var(--aiw-attention);
    }
  `,
})
export class ConnectionBanner {
  readonly status = input.required<ConnectionStatus>();
  /** Wall-clock milliseconds of the last good response, or null before the first one. */
  readonly lastSyncAt = input<number | null>(null);

  protected readonly message = computed(() => {
    const at = this.lastSyncAt();
    return connectionMessage(this.status(), at === null ? null : formatTime(at));
  });
}
