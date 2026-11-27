import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatDuration, formatTime } from '../../core/api/session-view';
import { sessionKey } from '../../core/api/session';
import { AttentionService } from '../../core/attention/attention';
import { ConnectionBanner } from '../../shared/connection-banner/connection-banner';
import { StatusBadge } from '../../shared/status-badge/status-badge';
import { SessionsFeed } from './sessions-feed';

interface Fact {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

@Component({
  selector: 'app-session-detail',
  imports: [RouterLink, ConnectionBanner, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-detail.html',
  styleUrl: './session-detail.scss',
})
export class SessionDetail {
  private readonly state = inject(SessionsFeed).state;
  private readonly router = inject(Router);
  private readonly attention = inject(AttentionService);

  /** Route parameters. The pair identifies the session. */
  readonly agent = input.required<string>();
  readonly sessionId = input.required<string>();

  protected readonly status = this.state.status;
  protected readonly lastSyncAt = this.state.lastSyncAt;

  protected readonly view = computed(() => {
    const key = sessionKey({ agent: this.agent(), session_id: this.sessionId() });
    return this.state.views().find((view) => view.key === key) ?? null;
  });

  protected readonly loaded = computed(() => this.state.snapshot() !== null);

  /** True once you have acknowledged this state of a session that needs you. */
  protected readonly acknowledged = computed(() => {
    const view = this.view();
    return view !== null && this.attention.isAcknowledged(view);
  });

  protected readonly facts = computed<Fact[]>(() => {
    const view = this.view();
    if (!view) return [];
    const time = (ms: number) => (ms > 0 ? formatTime(ms) : '–');
    return [
      { label: view.running ? 'Running for' : 'Duration', value: formatDuration(view.durationSec) },
      ...(view.status === 'needs_attention'
        ? [{ label: 'Waiting', value: formatDuration(view.waitingSec) }]
        : []),
      { label: 'Started', value: time(view.startedMs) },
      { label: 'Last update', value: time(view.updatedMs) },
      { label: 'Session ID', value: view.sessionId, mono: true },
    ];
  });

  constructor() {
    // Like the firmware: when the session is gone from fresh data, go back to the list.
    effect(() => {
      if (this.loaded() && !this.view())
        void this.router.navigate(['/sessions'], { replaceUrl: true });
    });
  }

  protected acknowledge(): void {
    const view = this.view();
    if (view) this.attention.acknowledge(view);
  }
}
