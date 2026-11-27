// Shapes returned by GET /api/status and GET /api/sessions. Field names match the server (see docs/API.md).

export const SESSION_STATUSES = [
  'working',
  'needs_attention',
  'done',
  'idle',
  'notice',
  'error',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface Session {
  readonly session_id: string;
  readonly agent: string;
  readonly project: string;
  /** Raw value from the server. Use `statusOf` to get a known status. */
  readonly status: string;
  readonly detail: string;
  /** Unix seconds. */
  readonly updated: number;
  readonly started: number;
  readonly since: number;
  /** Seconds, as computed by the server at response time. */
  readonly duration: number;
  /** True for a `done` session that ran at least 5 minutes. Computed by the server. */
  readonly finished_long: boolean;
  /** Seconds a `needs_attention` session has waited, at response time. */
  readonly waiting: number;
}

export interface LimitWindow {
  readonly used_pct: number;
  /** Unix seconds. 0 when the server did not send it. */
  readonly resets_at: number;
  /** Seconds until reset, at response time. */
  readonly resets_in: number;
}

export interface AgentLimits {
  readonly five_hour: LimitWindow;
  readonly weekly: LimitWindow;
}

export interface Snapshot {
  readonly sessions: readonly Session[];
  /** Only agents with both windows present. An agent without data is absent. */
  readonly limits: Readonly<Record<string, AgentLimits>>;
  readonly active_count: number;
  readonly attention_count: number;
  readonly total_count: number;
}
