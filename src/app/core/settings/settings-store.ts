import { Injectable, signal } from '@angular/core';

/** Update intervals offered in Settings. The default comes from the runtime config (3 s). */
export const POLL_OPTIONS_MS = [2000, 3000, 5000, 10_000, 30_000, 60_000] as const;
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 60_000;

const KEY = 'aiw.settings';
const DEMO_KEY = 'aiw.demo';

interface Saved {
  readonly pollIntervalMs: number | null;
  readonly sound: boolean;
  readonly notifications: boolean;
}

function readSaved(): Saved {
  const saved: Saved = { pollIntervalMs: null, sound: false, notifications: false };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return saved;
    const poll = raw['pollIntervalMs'];
    return {
      pollIntervalMs:
        typeof poll === 'number' &&
        Number.isFinite(poll) &&
        poll >= MIN_POLL_MS &&
        poll <= MAX_POLL_MS
          ? Math.round(poll)
          : null,
      sound: raw['sound'] === true,
      notifications: raw['notifications'] === true,
    };
  } catch {
    return saved;
  }
}

function readDemo(): boolean {
  try {
    return sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The user's non-sensitive preferences. Nothing secret is ever stored here. Demo mode lives in
 * the tab's session only, so a new tab always starts with real data.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly saved = readSaved();

  /** The user's own update interval, or null to use the default from the runtime config. */
  readonly pollIntervalMs = signal<number | null>(this.saved.pollIntervalMs);
  readonly sound = signal(this.saved.sound);
  readonly notifications = signal(this.saved.notifications);
  /** Example data instead of the server's. Off at the start of every tab. */
  readonly demo = signal(readDemo());

  setPollIntervalMs(ms: number | null): void {
    this.pollIntervalMs.set(
      ms === null ? null : Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(ms))),
    );
    this.persist();
  }

  setSound(on: boolean): void {
    this.sound.set(on);
    this.persist();
  }

  setNotifications(on: boolean): void {
    this.notifications.set(on);
    this.persist();
  }

  setDemo(on: boolean): void {
    this.demo.set(on);
    try {
      sessionStorage.setItem(DEMO_KEY, on ? '1' : '0');
    } catch {
      // Storage blocked: demo mode lasts until the page reloads.
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          pollIntervalMs: this.pollIntervalMs(),
          sound: this.sound(),
          notifications: this.notifications(),
        }),
      );
    } catch {
      // Storage blocked or full: the choice lasts until the page closes.
    }
  }
}
