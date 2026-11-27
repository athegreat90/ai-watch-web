import { Snapshot } from '../api/models';

/** The agents the server reports limits for. They always get a row, with or without data. */
export const KNOWN_LIMIT_AGENTS = ['Claude Code', 'Codex', 'Antigravity'] as const;

export const WARN_PCT = 70;
export const CRITICAL_PCT = 90;

export type UsageLevel = 'ok' | 'warn' | 'critical';

export interface LimitWindowView {
  readonly label: string;
  /** 0 to 100, one decimal. */
  readonly usedPct: number;
  readonly remainingPct: number;
  readonly level: UsageLevel;
  /** Seconds until the window resets, counted down locally. Zero once it is due. */
  readonly resetsInSec: number;
  /** Milliseconds since the epoch. */
  readonly resetsAtMs: number;
}

export interface LimitRow {
  readonly agent: string;
  /** The two windows, or null when the server reports no usage for this agent. */
  readonly windows: readonly [LimitWindowView, LimitWindowView] | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const clampPct = (value: number) => Math.min(100, Math.max(0, round1(value)));

export const usageLevel = (usedPct: number): UsageLevel =>
  usedPct >= CRITICAL_PCT ? 'critical' : usedPct >= WARN_PCT ? 'warn' : 'ok';

function windowView(
  label: string,
  raw: { used_pct: number; resets_at: number; resets_in: number },
  elapsedSec: number,
  syncedAtMs: number | null,
): LimitWindowView {
  const usedPct = clampPct(raw.used_pct);
  return {
    label,
    usedPct,
    remainingPct: round1(100 - usedPct),
    level: usageLevel(usedPct),
    resetsInSec: Math.max(0, raw.resets_in - elapsedSec),
    // Without a reset time from the server, work it out from when the data arrived.
    resetsAtMs: raw.resets_at > 0 ? raw.resets_at * 1000 : (syncedAtMs ?? 0) + raw.resets_in * 1000,
  };
}

/**
 * One row per known agent, then any other agent the server reported. An agent the server did not
 * report shows as having no data. Nothing is invented.
 */
export function toLimitRows(
  limits: Snapshot['limits'],
  elapsedSec: number,
  syncedAtMs: number | null,
): LimitRow[] {
  const others = Object.keys(limits)
    .filter((agent) => !(KNOWN_LIMIT_AGENTS as readonly string[]).includes(agent))
    .sort();
  return [...KNOWN_LIMIT_AGENTS, ...others].map((agent) => {
    const entry = limits[agent];
    return {
      agent,
      windows: entry
        ? ([
            windowView('5 hours', entry.five_hour, elapsedSec, syncedAtMs),
            windowView('Weekly', entry.weekly, elapsedSec, syncedAtMs),
          ] as const)
        : null,
    };
  });
}

/** 4d 6h, 1h 02m, 12m, under 1m, now. */
export function formatResetIn(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds === 0) return 'now';
  if (seconds < 60) return 'under 1m';
  const minutes = Math.floor(seconds / 60);
  if (seconds < 3600) return `${minutes}m`;
  const hours = Math.floor(seconds / 3600);
  if (seconds < 86400) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(seconds / 86400)}d ${hours % 24}h`;
}

/** Fri 27 Nov, 23:02 in the viewer's time zone. */
export function formatDateTime(ms: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(ms);
}
