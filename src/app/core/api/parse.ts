// Hand-written guards for the server response. This file has no runtime imports, so the contract
// test can load it directly with Node's type stripping.
import type { AgentLimits, LimitWindow, Session, Snapshot } from './models';

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

function parseSession(raw: unknown): Session | null {
  if (!isRecord(raw)) return null;
  const sessionId = raw['session_id'];
  const agent = raw['agent'];
  const status = raw['status'];
  // Same rule as the firmware: a row without id, agent or a string status rejects the response.
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  if (typeof agent !== 'string' || agent === '') return null;
  if (typeof status !== 'string') return null;
  return {
    session_id: sessionId,
    agent,
    status,
    project: str(raw['project'], 'Project'),
    detail: str(raw['detail']),
    updated: num(raw['updated']),
    started: num(raw['started']),
    since: num(raw['since']),
    duration: num(raw['duration']),
    finished_long: raw['finished_long'] === true,
    waiting: num(raw['waiting']),
  };
}

function parseWindow(raw: unknown): LimitWindow | null {
  if (!isRecord(raw)) return null;
  const used = raw['used_pct'];
  const resetsIn = raw['resets_in'];
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  if (typeof resetsIn !== 'number' || !Number.isFinite(resetsIn)) return null;
  return { used_pct: used, resets_at: num(raw['resets_at']), resets_in: resetsIn };
}

function parseLimits(raw: unknown): Record<string, AgentLimits> {
  const limits: Record<string, AgentLimits> = {};
  if (!isRecord(raw)) return limits;
  for (const [agent, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const fiveHour = parseWindow(value['five_hour']);
    const weekly = parseWindow(value['weekly']);
    // Like the firmware, an agent is shown only when both windows are present.
    if (fiveHour && weekly) limits[agent] = { five_hour: fiveHour, weekly };
  }
  return limits;
}

/** Returns the snapshot, or null when the body is not a valid server response. */
export function parseSnapshot(body: unknown): Snapshot | null {
  if (!isRecord(body) || !Array.isArray(body['sessions'])) return null;
  const sessions: Session[] = [];
  for (const row of body['sessions'] as unknown[]) {
    const session = parseSession(row);
    if (!session) return null;
    sessions.push(session);
  }
  return {
    sessions,
    limits: parseLimits(body['limits']),
    active_count: num(body['active_count']),
    attention_count: num(body['attention_count']),
    total_count: num(body['total_count'], sessions.length),
  };
}
