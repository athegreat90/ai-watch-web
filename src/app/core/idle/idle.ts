import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Snapshot } from '../api/models';
import { sessionKey } from '../api/session';
import { AttentionService } from '../attention/attention';
import { ConnectionState } from '../connection-state/connection-state';
import { ConnectionStatus } from '../connection-state/snapshot-state';
import { Clock } from '../time/clock';

/** The idle robot appears after 15 minutes without activity. */
export const IDLE_MS = 15 * 60 * 1000;
/** It jumps to the next of four positions every 30 seconds. */
export const ROBOT_MOVE_MS = 30_000;
/** A tap that wakes the screen must not also press what is under it. */
const SWALLOW_CLICK_MS = 600;

const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'touchstart',
  'wheel',
  'click',
] as const;
/** Events that only wake the screen when it is idle, and do nothing else. */
const CONSUMED = new Set<string>(['pointerdown', 'keydown', 'touchstart']);

/**
 * What counts as the data changing: which sessions exist, when each last changed, and the state
 * of the connection. Timers and limit values moving do not count, like the firmware.
 */
export function activitySignature(status: ConnectionStatus, snapshot: Snapshot | null): string {
  if (!snapshot) return status;
  const sessions = snapshot.sessions.map((s) => `${sessionKey(s)}\u0000${s.updated}`);
  return [status, snapshot.total_count, ...sessions].join('\u0001');
}

/**
 * Tells when the screen has been idle. A touch, key, mouse move, a change in the sessions, or a
 * session that needs you counts as activity. The first interaction while idle only wakes it.
 */
@Injectable({ providedIn: 'root' })
export class IdleService {
  private readonly clock = inject(Clock);
  private readonly connection = inject(ConnectionState);
  private readonly attention = inject(AttentionService);

  private lastActivity = this.clock.monotonic();
  private swallowClicksUntil = 0;
  private signature = '';
  private readonly idle = signal(false);
  private readonly idleSince = signal<number | null>(null);

  readonly active = this.idle.asReadonly();

  /** Which of the four corners the robot is in. */
  readonly position = computed(() => {
    const since = this.idleSince();
    return since === null
      ? 0
      : Math.floor(Math.max(0, this.clock.tick() - since) / ROBOT_MOVE_MS) % 4;
  });

  constructor() {
    const doc = inject(DOCUMENT);
    const onActivity = (event: Event) => this.onActivity(event);
    for (const type of ACTIVITY_EVENTS) {
      // Not passive: touchstart and wheel on the document are passive by default, and a passive
      // listener cannot stop the tap that wakes the screen from reaching what is under it.
      doc.addEventListener(type, onActivity, { capture: true, passive: false });
    }
    inject(DestroyRef).onDestroy(() => {
      for (const type of ACTIVITY_EVENTS)
        doc.removeEventListener(type, onActivity, { capture: true });
    });

    effect(() => {
      // The clock is read so this runs every second and the 15 minutes can come due.
      this.clock.tick();
      const signature = activitySignature(this.connection.status(), this.connection.snapshot());
      const needsYou = this.attention.pending().length > 0;
      untracked(() => this.evaluate(signature, needsYou));
    });
  }

  private evaluate(signature: string, needsYou: boolean): void {
    const now = this.clock.monotonic();
    if (signature !== this.signature) {
      this.signature = signature;
      this.touch(now);
    }
    if (needsYou) this.touch(now);
    else if (!this.idle() && now - this.lastActivity >= IDLE_MS) {
      this.idle.set(true);
      this.idleSince.set(now);
    }
  }

  private onActivity(event: Event): void {
    const now = this.clock.monotonic();
    if (event.type === 'click' && now < this.swallowClicksUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.idle()) {
      this.touch(now);
      if (CONSUMED.has(event.type)) {
        this.swallowClicksUntil = now + SWALLOW_CLICK_MS;
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    this.lastActivity = now;
  }

  private touch(now: number): void {
    this.lastActivity = now;
    this.idle.set(false);
    this.idleSince.set(null);
  }
}
