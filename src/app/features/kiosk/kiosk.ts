import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { filter, fromEvent, startWith, switchMap, tap, timer } from 'rxjs';
import { SessionView, activityText } from '../../core/api/session-view';
import { ConnectionState } from '../../core/connection-state/connection-state';
import { CONNECTION_LABELS } from '../../core/connection-state/labels';
import { FullscreenService } from '../../core/kiosk/fullscreen';
import { pixelShift } from '../../core/kiosk/pixel-shift';
import { ScreenWakeLock } from '../../core/kiosk/screen-wake-lock';
import { toLimitRows } from '../../core/limits/limits-view';
import { MeetingMode } from '../../core/meeting/meeting-mode';
import { PAGE_VISIBLE } from '../../core/polling/page-visibility';
import { Clock } from '../../core/time/clock';
import { AttentionOverlay } from '../../shared/attention-overlay/attention-overlay';
import { CelebrationBanner } from '../../shared/celebration-banner/celebration-banner';
import { ConnectionBanner } from '../../shared/connection-banner/connection-banner';
import { IdleRobot } from '../../shared/idle-robot/idle-robot';
import { StatusBadge } from '../../shared/status-badge/status-badge';

/** Rows that fit a small screen without scrolling. The counters still cover every session. */
export const KIOSK_MAX_ROWS = 6;
export const CURSOR_HIDE_MS = 5000;

/**
 * A screen for continuous monitoring: big numbers, no navigation, no scrolling. It keeps the
 * screen awake when the browser allows it, hides the mouse pointer after a few seconds and moves
 * the picture a few pixels every minute. None of this guarantees against OLED burn-in.
 */
@Component({
  selector: 'app-kiosk',
  imports: [
    RouterLink,
    AttentionOverlay,
    CelebrationBanner,
    ConnectionBanner,
    IdleRobot,
    StatusBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kiosk.html',
  styleUrl: './kiosk.scss',
})
export class Kiosk {
  private readonly connection = inject(ConnectionState);
  private readonly clock = inject(Clock);
  protected readonly fullscreen = inject(FullscreenService);
  protected readonly wakeLock = inject(ScreenWakeLock);
  protected readonly meeting = inject(MeetingMode);

  protected readonly status = this.connection.status;
  protected readonly statusLabel = computed(() => CONNECTION_LABELS[this.connection.status()]);
  protected readonly lastSyncAt = this.connection.lastSyncAt;
  protected readonly snapshot = this.connection.snapshot;

  protected readonly rows = computed(() => this.connection.views().slice(0, KIOSK_MAX_ROWS));
  protected readonly moreCount = computed(() =>
    Math.max(0, (this.snapshot()?.total_count ?? 0) - this.rows().length),
  );

  protected readonly limits = computed(() =>
    toLimitRows(
      this.snapshot()?.limits ?? {},
      this.connection.elapsedSec(),
      this.connection.lastSyncAt(),
    ).filter((row) => row.windows !== null),
  );

  protected readonly shift = computed(() => {
    const { x, y } = pixelShift(Math.floor(this.clock.tick() / 60_000));
    return `translate(${x}px, ${y}px)`;
  });

  protected readonly cursorHidden = signal(false);

  protected readonly wakeText = computed(() => {
    if (this.wakeLock.held()) return 'The screen stays on.';
    return this.wakeLock.supported
      ? 'The screen may turn off. The browser has not allowed it to stay on.'
      : 'This browser cannot keep the screen on here (it needs HTTPS or localhost). Use the system setting.';
  });

  constructor() {
    const doc = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);

    fromEvent(doc, 'pointermove')
      .pipe(
        startWith(null),
        tap(() => this.cursorHidden.set(false)),
        switchMap(() => timer(CURSOR_HIDE_MS)),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => this.cursorHidden.set(true));

    // The browser drops the lock when the tab is hidden, so ask again every time it shows.
    inject(PAGE_VISIBLE)
      .pipe(filter(Boolean), takeUntilDestroyed(destroyRef))
      .subscribe(() => void this.wakeLock.acquire());
    destroyRef.onDestroy(() => this.wakeLock.release());
  }

  protected activity(view: SessionView): string | null {
    return activityText(view);
  }

  protected toggleFullscreen(): void {
    void this.fullscreen.toggle();
  }
}
