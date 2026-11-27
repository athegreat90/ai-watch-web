import { compose, ports, readToken } from './stack';

const base = () => `http://127.0.0.1:${ports.server}`;

export type Status = 'working' | 'needs_attention' | 'done' | 'idle' | 'notice' | 'error';

export interface EventInput {
  agent: string;
  id: string;
  status: Status;
  project?: string;
  detail?: string;
  /** Seconds before now. The server accepts times from an hour ago to a minute ahead. */
  ago?: number;
}

async function post(path: string, body: unknown): Promise<void> {
  const reply = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'X-Monitor-Key': readToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (reply.status !== 200)
    throw new Error(`POST ${path} gave ${reply.status}: ${await reply.text()}`);
}

/** Sends one event, as an agent's hook would. */
export function event(input: EventInput): Promise<void> {
  return post('/api/events', {
    agent: input.agent,
    session_id: input.id,
    status: input.status,
    project: input.project ?? input.id,
    detail: input.detail ?? '',
    timestamp: Date.now() / 1000 - (input.ago ?? 0),
  });
}

export function limits(
  agent: string,
  fiveHourPct: number,
  weeklyPct: number,
  fiveHourResetsInSec = 6480,
): Promise<void> {
  const now = Date.now() / 1000;
  return post('/api/limits', {
    agent,
    five_hour: { used_pct: fiveHourPct, resets_at: now + fiveHourResetsInSec },
    weekly: { used_pct: weeklyPct, resets_at: now + 4 * 86_400 },
  });
}

async function waitHealthy(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base()}/health`)).status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the server did not come back');
}

async function waitWebHealthy(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${ports.web}/healthz`)).status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('the web image did not come back');
}

/**
 * The server keeps everything in memory, so a restart is the way to get an empty one. The web image
 * is restarted too: its 1 to 2 second cache would otherwise hand the next test the last answer of
 * the previous one.
 */
export async function resetServer(): Promise<void> {
  compose(['restart', 'server', 'web'], 120_000);
  await waitHealthy();
  await waitWebHealthy();
}

export async function stopServer(): Promise<void> {
  compose(['stop', 'server'], 120_000);
}

export async function startServer(): Promise<void> {
  compose(['start', 'server'], 120_000);
  await waitHealthy();
}

/** The same long-running task, as the hooks would report it: working, then done. */
export async function longTask(agent: string, id: string, project: string): Promise<void> {
  await event({ agent, id, status: 'working', project, detail: 'Applying changes', ago: 400 });
}

export async function finishTask(agent: string, id: string, project: string): Promise<void> {
  await event({ agent, id, status: 'done', project, detail: 'All changes applied' });
}
