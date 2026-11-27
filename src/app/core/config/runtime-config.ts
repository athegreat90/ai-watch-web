import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, firstValueFrom, of } from 'rxjs';

export interface AppConfig {
  /** Wait between status requests, in milliseconds. */
  readonly pollIntervalMs: number;
}

export const DEFAULT_CONFIG: AppConfig = { pollIntervalMs: 3000 };
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 60000;

/** Takes the non-secret values from `/config.json`. Anything missing or out of range falls back. */
export function parseConfig(raw: unknown): AppConfig {
  const value = (raw as { pollIntervalMs?: unknown } | null)?.pollIntervalMs;
  const valid = typeof value === 'number' && Number.isFinite(value);
  return {
    pollIntervalMs: valid
      ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(value)))
      : DEFAULT_CONFIG.pollIntervalMs,
  };
}

@Injectable({ providedIn: 'root' })
export class RuntimeConfig {
  private readonly http = inject(HttpClient);
  private readonly current = signal<AppConfig>(DEFAULT_CONFIG);

  readonly value = this.current.asReadonly();

  /** Runs before the app starts. A missing or broken file is not an error: defaults apply. */
  async load(): Promise<void> {
    const raw = await firstValueFrom(
      this.http.get<unknown>('/config.json').pipe(catchError(() => of(null))),
    );
    this.current.set(parseConfig(raw));
  }
}
