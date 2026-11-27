import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Session, Snapshot } from '../api/models';
import { sessionKey, statusOf } from '../api/session';
import { STALE_AFTER_INTERVALS } from '../connection-state/snapshot-state';
import { MeetingMode } from '../meeting/meeting-mode';
import { StatusPoller } from '../polling/status-poller';
import { Clock } from '../time/clock';

export const CELEBRATION_MS = 4000;
const MAX_REMEMBERED_TURNS = 200;

export interface Celebration {
  readonly project: string;
  readonly agent: string;
  readonly durationSec: number;
}

/** One turn of one session: its identity plus when the turn started. */
export const turnKey = (session: Session): string =>
  `${sessionKey(session)}\u0000${session.started}`;

/**
 * Sessions that just finished a long task: the same session was `working` in the previous
 * snapshot, is `done` now, and the server says it ran long. A session first seen as `done`, or
 * already celebrated for this turn, does not count.
 */
export function findFinished(
  previous: Snapshot | null,
  next: Snapshot,
  celebrated: ReadonlySet<string>,
): Session[] {
  if (!previous) return [];
  const before = new Map(previous.sessions.map((s) => [sessionKey(s), statusOf(s)]));
  return next.sessions.filter(
    (s) =>
      statusOf(s) === 'done' &&
      s.finished_long &&
      before.get(sessionKey(s)) === 'working' &&
      !celebrated.has(turnKey(s)),
  );
}

/**
 * The "Task done!" celebration. It lasts four seconds and shows once per turn. Meeting mode skips
 * it for good, it is not saved for later. After an outage or a long gap the previous snapshot is
 * forgotten, like the firmware, so an old finish is not celebrated.
 */
@Injectable({ providedIn: 'root' })
export class CelebrationService {
  private readonly poller = inject(StatusPoller);
  private readonly meeting = inject(MeetingMode);
  private readonly clock = inject(Clock);

  private readonly shown = signal<Celebration | null>(null);
  private previous: { snapshot: Snapshot; at: number } | null = null;
  private readonly celebrated = new Set<string>();
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  readonly current = this.shown.asReadonly();

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.poller.events$.pipe(takeUntilDestroyed(destroyRef)).subscribe((event) => {
      if (!event.ok) {
        this.previous = null;
        return;
      }
      const now = this.clock.monotonic();
      const fresh =
        this.previous && now - this.previous.at <= STALE_AFTER_INTERVALS * this.poller.intervalMs
          ? this.previous.snapshot
          : null;
      for (const session of findFinished(fresh, event.data, this.celebrated)) {
        this.remember(turnKey(session));
        if (!this.meeting.active()) this.show(session);
      }
      this.previous = { snapshot: event.data, at: now };
    });
    destroyRef.onDestroy(() => clearTimeout(this.hideTimer));
  }

  /** Ends the celebration early. */
  dismiss(): void {
    clearTimeout(this.hideTimer);
    this.shown.set(null);
  }

  private show(session: Session): void {
    clearTimeout(this.hideTimer);
    this.shown.set({
      project: session.project,
      agent: session.agent,
      durationSec: session.duration,
    });
    this.hideTimer = setTimeout(() => this.shown.set(null), CELEBRATION_MS);
  }

  private remember(key: string): void {
    this.celebrated.add(key);
    if (this.celebrated.size > MAX_REMEMBERED_TURNS) {
      const oldest = this.celebrated.values().next().value;
      if (oldest !== undefined) this.celebrated.delete(oldest);
    }
  }
}
