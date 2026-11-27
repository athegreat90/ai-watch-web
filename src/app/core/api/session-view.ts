import { Session, SessionStatus } from './models';
import { sessionKey, statusOf } from './session';

/** A session as the screens show it: durations already moved on from the moment of the response. */
export interface SessionView {
  readonly key: string;
  readonly agent: string;
  readonly sessionId: string;
  readonly initials: string;
  readonly project: string;
  readonly status: SessionStatus;
  readonly detail: string;
  /** True while the session is still going, so its times keep counting. */
  readonly running: boolean;
  readonly durationSec: number;
  /** Zero unless the session needs attention. */
  readonly waitingSec: number;
  /** Milliseconds since the epoch, 0 when the server did not send it. */
  readonly startedMs: number;
  readonly updatedMs: number;
}

/** Up to two letters, from the first letters of the first words. Works for any agent name. */
export function agentInitials(agent: string): string {
  const words = agent.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
      : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}

/**
 * `elapsedSec` is the time since the response arrived. Only a session that is still running moves
 * on with it: the server froze the others' duration at their last update.
 */
export function toView(session: Session, elapsedSec: number): SessionView {
  const status = statusOf(session);
  const running = status === 'working' || status === 'needs_attention';
  return {
    key: sessionKey(session),
    agent: session.agent,
    sessionId: session.session_id,
    initials: agentInitials(session.agent),
    project: session.project,
    status,
    detail: session.detail,
    running,
    durationSec: session.duration + (running ? elapsedSec : 0),
    waitingSec: status === 'needs_attention' ? session.waiting + elapsedSec : 0,
    startedMs: session.started * 1000,
    updatedMs: session.updated * 1000,
  };
}

/** What a session is doing, in the firmware's terms: waiting, running, or how long it took. */
export function activityText(view: SessionView): string | null {
  switch (view.status) {
    case 'needs_attention':
      return `Waiting ${formatDuration(view.waitingSec)}`;
    case 'working':
      return `Running ${formatDuration(view.durationSec)}`;
    case 'done':
      return `Took ${formatDuration(view.durationSec)}`;
    default:
      return null;
  }
}

/** 45s, 3m 05s, 1h 02m. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (seconds < 3600) return `${minutes}m ${pad(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${pad(minutes % 60)}m`;
}

/** A clock time such as 22:14:06 in the viewer's time zone. */
export function formatTime(ms: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(ms);
}
