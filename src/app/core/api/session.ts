import { SESSION_STATUSES, type Session, type SessionStatus } from './models';

/** A session is identified by the pair (agent, session id), never by the id alone. */
export function sessionKey(session: Pick<Session, 'agent' | 'session_id'>): string {
  return `${session.agent}\u0000${session.session_id}`;
}

/** Unknown statuses show as idle, like the firmware. */
export function statusOf(session: Pick<Session, 'status'>): SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(session.status)
    ? (session.status as SessionStatus)
    : 'idle';
}
