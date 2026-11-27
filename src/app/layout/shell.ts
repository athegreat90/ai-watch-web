import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AttentionService } from '../core/attention/attention';
import { ConnectionState } from '../core/connection-state/connection-state';
import { CONNECTION_LABELS } from '../core/connection-state/labels';
import { FocusTimer, formatClock } from '../core/focus/focus-timer';
import { MeetingMode } from '../core/meeting/meeting-mode';
import { SettingsStore } from '../core/settings/settings-store';
import { AttentionOverlay } from '../shared/attention-overlay/attention-overlay';
import { CelebrationBanner } from '../shared/celebration-banner/celebration-banner';
import { IdleRobot } from '../shared/idle-robot/idle-robot';

@Component({
  selector: 'app-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    AttentionOverlay,
    CelebrationBanner,
    IdleRobot,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly connection = inject(ConnectionState);
  private readonly attention = inject(AttentionService);
  private readonly focus = inject(FocusTimer);
  protected readonly meeting = inject(MeetingMode);
  protected readonly demo = inject(SettingsStore).demo;

  protected readonly items = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/sessions', label: 'Sessions' },
    { path: '/limits', label: 'Limits' },
    { path: '/focus', label: 'Focus' },
    { path: '/settings', label: 'Settings' },
  ] as const;

  protected readonly status = this.connection.status;
  protected readonly statusLabel = computed(() => CONNECTION_LABELS[this.connection.status()]);

  /** The Meeting badge turns amber when a session needs you, so it is not missed. */
  protected readonly needsYou = computed(() => this.attention.pending().length > 0);

  protected readonly timerPhase = this.focus.phase;
  protected readonly timerText = computed(() => {
    switch (this.focus.phase()) {
      case 'idle':
        return null;
      case 'done':
        return 'Focus complete';
      default:
        return formatClock(this.focus.remainingMs());
    }
  });

  // A plain "#main" link would navigate through the router's base href, so focus the element instead.
  protected skipToMain(event: Event, main: HTMLElement): void {
    event.preventDefault();
    main.focus();
  }
}
