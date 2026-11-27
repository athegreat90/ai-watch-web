import { Session, Snapshot } from '../api/models';

/** After a finished session is this old the server forgets it (120 s), so the demo does too. */
const DONE_TTL_SEC = 120;
/** The demo task that finishes: it ran 380 s before the demo started and ends this long after. */
const FINISH_AFTER_SEC = 45;
const FINISHING_STARTED_AGO = 380;

const PRIORITY = ['needs_attention', 'error', 'working', 'notice', 'done', 'idle'];

const row = (
  anchor: number,
  now: number,
  over: Pick<Session, 'session_id' | 'agent' | 'project' | 'status' | 'detail'> & {
    startedAgo: number;
    updatedAgo: number;
    finishedAt?: number;
  },
): Session => {
  const started = anchor - over.startedAgo;
  const updated = over.finishedAt ?? anchor - over.updatedAgo;
  const running = over.status === 'working' || over.status === 'needs_attention';
  const duration = Math.floor((running ? now : updated) - started);
  return {
    session_id: over.session_id,
    agent: over.agent,
    project: over.project,
    status: over.status,
    detail: over.detail,
    updated,
    started,
    since: over.status === 'needs_attention' ? anchor - over.updatedAgo : updated,
    duration,
    finished_long: over.status === 'done' && duration >= 300,
    waiting: over.status === 'needs_attention' ? Math.floor(now - (anchor - over.updatedAgo)) : 0,
  };
};

/**
 * Example data that looks like the server's, for trying the app out. It is the same every time:
 * a session that needs you, a failure, two tasks that keep running, and one long task that
 * finishes 45 seconds in, so the celebration can be seen. Times are in Unix seconds.
 */
export function demoSnapshot(anchorSec: number, nowSec: number): Snapshot {
  const elapsed = Math.max(0, nowSec - anchorSec);
  const finished = elapsed >= FINISH_AFTER_SEC;
  const finishedAt = anchorSec + FINISH_AFTER_SEC;

  const sessions: Session[] = [
    row(anchorSec, nowSec, {
      session_id: 'demo-checkout',
      agent: 'Claude Code',
      project: 'checkout-service',
      status: 'needs_attention',
      detail: 'Approve running the migration?',
      startedAgo: 600,
      updatedAgo: 250,
    }),
    row(anchorSec, nowSec, {
      session_id: 'demo-billing',
      agent: 'Claude Code',
      project: 'billing-api',
      status: 'error',
      detail: 'Command failed with exit code 2',
      startedAgo: 200,
      updatedAgo: 40,
    }),
    row(anchorSec, nowSec, {
      session_id: 'demo-docs',
      agent: 'Codex',
      project: 'docs-site',
      status: 'working',
      detail: 'Running the test suite',
      startedAgo: 760,
      updatedAgo: 5,
    }),
    row(anchorSec, nowSec, {
      session_id: 'demo-web',
      agent: 'Antigravity',
      project: 'ai-watch-web',
      status: 'working',
      detail: 'Editing the dashboard',
      startedAgo: 95,
      updatedAgo: 3,
    }),
    row(anchorSec, nowSec, {
      session_id: 'demo-infra',
      agent: 'Codex',
      project: 'infra-scripts',
      status: finished ? 'done' : 'working',
      detail: finished ? 'All changes applied' : 'Applying changes',
      startedAgo: FINISHING_STARTED_AGO,
      updatedAgo: 2,
      finishedAt: finished ? finishedAt : undefined,
    }),
  ].filter((s) => !(s.session_id === 'demo-infra' && nowSec >= finishedAt + DONE_TTL_SEC));

  sessions.sort(
    (a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status) || b.updated - a.updated,
  );

  const limitWindow = (usedPct: number, resetsInSec: number) => ({
    used_pct: usedPct,
    resets_at: anchorSec + resetsInSec,
    resets_in: Math.max(0, Math.floor(anchorSec + resetsInSec - nowSec)),
  });

  return {
    sessions,
    limits: {
      'Claude Code': {
        five_hour: limitWindow(72.5, 6480),
        weekly: limitWindow(10, 4 * 86400 + 6 * 3600),
      },
      Codex: { five_hour: limitWindow(93, 1200), weekly: limitWindow(55.5, 2 * 86400) },
    },
    active_count: sessions.filter((s) => s.status === 'working').length,
    attention_count: sessions.filter((s) => s.status === 'needs_attention').length,
    total_count: sessions.length,
  };
}
