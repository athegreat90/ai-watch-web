import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Notifier } from '../notify/notifier';
import { Clock } from '../time/clock';

/** The firmware's focus timer is 25 minutes. */
export const FOCUS_MS = 25 * 60 * 1000;
const STORAGE_KEY = 'aiw.focus';

export type FocusPhase = 'idle' | 'running' | 'paused' | 'done';

type Saved =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running'; readonly endsAt: number }
  | { readonly phase: 'paused'; readonly remainingMs: number }
  | { readonly phase: 'done' };

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function read(now: number): Saved {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const saved = raw as { phase?: unknown; endsAt?: unknown; remainingMs?: unknown } | null;
    if (saved?.phase === 'running' && finite(saved.endsAt)) {
      return saved.endsAt > now ? { phase: 'running', endsAt: saved.endsAt } : { phase: 'done' };
    }
    if (saved?.phase === 'paused' && finite(saved.remainingMs) && saved.remainingMs > 0) {
      return { phase: 'paused', remainingMs: Math.min(FOCUS_MS, saved.remainingMs) };
    }
    if (saved?.phase === 'done') return { phase: 'done' };
  } catch {
    // Storage blocked or unreadable: start fresh.
  }
  return { phase: 'idle' };
}

/** 25:00, 04:07, 00:01. A started second counts as a whole one, so zero means finished. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * The 25 minute focus timer. It is counted from timestamps, not from ticks, so a hidden or
 * sleeping tab cannot make it drift, and it is saved, so a reload keeps it. It does not need the
 * server.
 */
@Injectable({ providedIn: 'root' })
export class FocusTimer {
  private readonly clock = inject(Clock);
  private readonly notifier = inject(Notifier);
  private readonly state = signal<Saved>(read(this.clock.wallNow()));
  private timeout: ReturnType<typeof setTimeout> | undefined;

  /** What the timer is doing. It turns `done` by itself the moment the time is up. */
  readonly phase = computed<FocusPhase>(() => {
    const state = this.state();
    this.clock.tick();
    return state.phase === 'running' && this.clock.wallNow() >= state.endsAt ? 'done' : state.phase;
  });

  readonly remainingMs = computed(() => {
    const state = this.state();
    this.clock.tick();
    switch (state.phase) {
      case 'idle':
        return FOCUS_MS;
      case 'running':
        return Math.max(0, state.endsAt - this.clock.wallNow());
      case 'paused':
        return state.remainingMs;
      case 'done':
        return 0;
    }
  });

  readonly running = computed(() => this.phase() === 'running');

  constructor() {
    const state = this.state();
    if (state.phase === 'running') this.schedule(state.endsAt);
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timeout));
  }

  /** Start, pause or resume. After the time is up it starts a fresh 25 minutes. */
  toggle(): void {
    switch (this.phase()) {
      case 'running':
        return this.pause();
      case 'paused':
        return this.resume();
      default:
        return this.begin(FOCUS_MS);
    }
  }

  reset(): void {
    clearTimeout(this.timeout);
    this.save({ phase: 'idle' });
  }

  private pause(): void {
    clearTimeout(this.timeout);
    this.save({ phase: 'paused', remainingMs: Math.max(1, this.remainingMs()) });
  }

  private resume(): void {
    this.begin(this.remainingMs());
  }

  private begin(durationMs: number): void {
    const endsAt = this.clock.wallNow() + durationMs;
    this.save({ phase: 'running', endsAt });
    this.schedule(endsAt);
  }

  /** A timeout still runs in a hidden tab, so the end is recorded on time. */
  private schedule(endsAt: number): void {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(
      () => {
        const state = this.state();
        if (state.phase === 'running' && this.clock.wallNow() >= state.endsAt) {
          this.save({ phase: 'done' });
          this.notifier.focusComplete();
        }
      },
      Math.max(0, endsAt - this.clock.wallNow()) + 25,
    );
  }

  private save(state: Saved): void {
    this.state.set(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage blocked or full: the timer works until the page closes.
    }
  }
}
