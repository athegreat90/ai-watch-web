// Helpers for unit tests only. Excluded from the app build.
import { signal } from '@angular/core';
import { Session, Snapshot } from '../core/api/models';
import { SessionView, toView } from '../core/api/session-view';
import { ConnectionStatus } from '../core/connection-state/snapshot-state';

export const session = (over: Partial<Session> = {}): Session => ({
  session_id: 's1',
  agent: 'Claude Code',
  project: 'shop',
  status: 'working',
  detail: 'running tests',
  updated: 1700000100,
  started: 1700000000,
  since: 1700000050,
  duration: 100,
  finished_long: false,
  waiting: 0,
  ...over,
});

export const snapshot = (sessions: Session[] = [], over: Partial<Snapshot> = {}): Snapshot => ({
  sessions,
  limits: {},
  active_count: sessions.filter((s) => s.status === 'working').length,
  attention_count: sessions.filter((s) => s.status === 'needs_attention').length,
  total_count: sessions.length,
  ...over,
});

export const view = (over: Partial<Session> = {}, elapsedSec = 0): SessionView =>
  toView(session(over), elapsedSec);

/** The signals a screen reads from the connection state or a sessions feed. */
export function fakeState() {
  return {
    status: signal<ConnectionStatus>('connecting'),
    snapshot: signal<Snapshot | null>(null),
    views: signal<SessionView[]>([]),
    lastSyncAt: signal<number | null>(null),
    lastError: signal(null),
    elapsedSec: signal(0),
    refresh: () => undefined,
  };
}
