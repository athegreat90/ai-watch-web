import { event } from './support/server';
import { expect, test } from './support/fixtures';
import { connection, hideAlert, open, pairs, projects, seedMix, texts } from './support/ui';

test.describe('dashboard', () => {
  test('shows the sessions in the order the server sends them, with the counters', async ({
    page,
  }) => {
    await seedMix();
    await open(page, '/dashboard');
    await hideAlert(page);

    // needs_attention, error, working, notice, done, idle, newest first within a status.
    expect(await texts(projects(page))).toEqual([
      'checkout-service',
      'billing-api',
      'ai-watch-web',
      'docs-site',
      'notes',
      'infra-scripts',
      'sandbox',
    ]);
    expect(await pairs(page.locator('.tile'))).toEqual(['Working 2', 'Needs you 1', 'Sessions 7']);
    await expect(connection(page)).toHaveText('Live');
  });

  test('says what each session is doing, and who is doing it', async ({ page }) => {
    await seedMix();
    await open(page, '/dashboard');
    await hideAlert(page);
    const first = page.locator('app-session-row').first();
    await expect(first).toContainText('Claude Code');
    await expect(first).toContainText('Approve running the migration?');
    await expect(first).toContainText('Needs you');
    await expect(first).toContainText(/Waiting \d+m \d+s/);
    await expect(page.locator('app-session-row').nth(2)).toContainText('Working');
    await expect(page.locator('app-session-row').nth(2)).toContainText(/Running \d+m \d+s/);
    await expect(page.locator('app-session-row').nth(5)).toContainText('Completed');
    await expect(page.locator('app-session-row').nth(5)).toContainText(/Took \d+s/);
  });

  test('says there are no sessions when the server has none', async ({ page }) => {
    await open(page, '/dashboard');
    await expect(page.getByText('No active sessions.')).toBeVisible();
    expect(await pairs(page.locator('.tile'))).toEqual(['Working 0', 'Needs you 0', 'Sessions 0']);
  });

  test('shows a session that starts after the page opened', async ({ page }) => {
    await open(page, '/dashboard');
    await event({ agent: 'Codex', id: 'late', status: 'working', project: 'late-project' });
    await expect(projects(page)).toHaveText(['late-project'], { timeout: 15_000 });
  });

  test('keeps counting the running time between answers from the server', async ({ page }) => {
    await event({ agent: 'Codex', id: 'long', status: 'working', project: 'counting', ago: 100 });
    await open(page, '/dashboard');
    const running = page.locator('.row-activity').first();
    const seconds = async () => {
      const m = /(\d+)m (\d+)s/.exec((await running.textContent()) ?? '');
      return Number(m?.[1]) * 60 + Number(m?.[2]);
    };
    const before = await seconds();
    // The server sends whole seconds, so a new answer can move the count back by up to one.
    await page.waitForTimeout(3500);
    expect(await seconds()).toBeGreaterThanOrEqual(before + 2);
  });

  test('shows how long ago it synced, and the refresh button asks again', async ({ page }) => {
    await open(page, '/dashboard');
    await expect(page.locator('.sync-text')).toHaveText(/^Synced \d+s ago$/);
    await event({ agent: 'Codex', id: 'x', status: 'working', project: 'after-refresh' });
    await expect(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(projects(page)).toHaveText(['after-refresh'], { timeout: 1500 });
    }).toPass({ timeout: 15_000 });
  });

  test('lists at most 8 sessions, says how many more there are, and links to the full list', async ({
    page,
  }) => {
    for (let i = 0; i < 11; i++)
      await event({ agent: 'Codex', id: `many-${i}`, status: 'working', project: `project-${i}` });
    await open(page, '/dashboard');
    await expect(projects(page)).toHaveCount(8);
    await expect(page.locator('.tile').nth(2)).toContainText('11');
    await expect(page.getByText('3 more session(s).')).toBeVisible();
    await page.getByRole('link', { name: 'See all sessions' }).click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(projects(page)).toHaveCount(11);
  });

  test('is what the server says, not what the browser sends: the write routes are closed', async ({
    page,
    problems,
  }) => {
    await open(page, '/dashboard');
    const status = await page.evaluate(async () => [
      (await fetch('/api/events', { method: 'POST', body: '{}' })).status,
      (await fetch('/api/event', { method: 'POST', body: '{}' })).status,
      (await fetch('/api/limits', { method: 'POST', body: '{}' })).status,
    ]);
    expect(status).toEqual([404, 404, 404]);
    problems.length = 0; // the three 404s were asked for on purpose
  });
});
