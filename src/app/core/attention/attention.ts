import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SessionView } from '../api/session-view';
import { ConnectionState } from '../connection-state/connection-state';
import { MeetingMode } from '../meeting/meeting-mode';
import { Notifier } from '../notify/notifier';
import { Clock } from '../time/clock';
import { AlertTimer } from './alert-timer';

const STORAGE_KEY = 'aiw.acks';
const MAX_ACKS = 100;

/**
 * An acknowledgement belongs to one state of one session: the session (agent and id) and its
 * last update. A new event changes `updated`, so it asks for attention again.
 */
export const ackKey = (view: Pick<SessionView, 'key' | 'updatedMs'>): string =>
  `${view.key}\u0000${view.updatedMs}`;

function readAcks(): string[] {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function writeAcks(keys: readonly string[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage blocked or full: acknowledgements last until the page closes.
  }
}

/**
 * The NEEDS YOU alert. It shows when a session needs you and you have not acknowledged it, and
 * comes back every two minutes. Dismissing only hides it. Acknowledging stops it for that state
 * of that session. Meeting mode keeps it quiet. It never tells the server anything, because the
 * server has no acknowledgement.
 */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  private readonly connection = inject(ConnectionState);
  private readonly meeting = inject(MeetingMode);
  private readonly clock = inject(Clock);
  private readonly notifier = inject(Notifier);

  private readonly acks = signal<readonly string[]>(readAcks());
  private readonly open = signal(false);
  private readonly timer = new AlertTimer();
  private known = new Set<string>();

  /** Sessions that need you and that you have not acknowledged, in the server's order. */
  readonly pending = computed(() =>
    this.connection
      .views()
      .filter((view) => view.status === 'needs_attention' && !this.acks().includes(ackKey(view))),
  );

  /** Whether the alert is on screen. */
  readonly visible = this.open.asReadonly();

  constructor() {
    effect(() => {
      // The clock is read so this runs every second and the two-minute reminder can come due.
      this.clock.tick();
      const pending = this.pending();
      const inMeeting = this.meeting.active();
      untracked(() => this.evaluate(pending, inMeeting));
    });
  }

  /** Whether this state of this session is acknowledged. Reactive: it changes with `acknowledge`. */
  isAcknowledged(view: Pick<SessionView, 'key' | 'updatedMs'>): boolean {
    return this.acks().includes(ackKey(view));
  }

  /** Hides the alert. The session stays unacknowledged, so it comes back after two minutes. */
  dismiss(): void {
    this.open.set(false);
  }

  acknowledge(view: Pick<SessionView, 'key' | 'updatedMs'>): void {
    const keys = [...this.acks(), ackKey(view)].slice(-MAX_ACKS);
    this.acks.set(keys);
    writeAcks(keys);
  }

  private evaluate(pending: readonly SessionView[], inMeeting: boolean): void {
    if (inMeeting || pending.length === 0) {
      // Nothing to say, or not now. Forget the episode, so attention fires at once when it returns.
      this.timer.reset();
      this.known.clear();
      this.open.set(false);
      return;
    }
    const keys = new Set(pending.map((view) => view.key));
    // A session that needs you for the first time should not wait for the next reminder.
    if ([...keys].some((key) => !this.known.has(key))) this.timer.reset();
    this.known = keys;
    if (this.timer.poll(this.clock.monotonic(), true)) {
      // Tone and notification only when the alert comes up, not while it is already showing.
      if (!this.open()) this.notifier.attention(pending);
      this.open.set(true);
    }
  }
}
