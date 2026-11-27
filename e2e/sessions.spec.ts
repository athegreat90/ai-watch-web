import { event } from './support/server';
import { expect, test } from './support/fixtures';
import { hideAlert, open, pairs, projects, seedMix, texts } from './support/ui';

test.describe('sessions', () => {
  test('lists every session and opens the detail of one', async ({ page }) => {
    await seedMix();
    await open(page, '/sessions');
    await hideAlert(page);
    await expect(projects(page)).toHaveCount(7);

    await page.locator('app-session-row', { hasText: 'docs-site' }).click();
    await expect(page).toHaveURL(/\/sessions\/Codex\/docs$/);
    await expect(page.getByRole('heading', { name: 'docs-site' })).toBeVisible();
    await expect(page.getByText('Running the test suite')).toBeVisible();
    const facts = await pairs(page.locator('.facts > div'));
    expect(facts.some((f) => /^Running for \d+m \d+s$/.test(f))).toBe(true);
    expect(facts).toContain('Session ID docs');
    expect(facts.some((f) => /^Last update \d\d:\d\d:\d\d/.test(f))).toBe(true);

    await page.getByRole('link', { name: '← All sessions' }).click();
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test('opens a detail page directly from its address', async ({ page }) => {
    await event({ agent: 'Claude Code', id: 'abc123', status: 'working', project: 'direct' });
    await page.goto('/sessions/Claude%20Code/abc123');
    await expect(page.getByRole('heading', { name: 'direct' })).toBeVisible();
    await expect(page).toHaveTitle('Session · AI Watch');
  });

  test('tells the same session id under two agents apart', async ({ page }) => {
    await event({ agent: 'Claude Code', id: 'same', status: 'working', project: 'from-claude' });
    await event({ agent: 'Codex', id: 'same', status: 'idle', project: 'from-codex' });
    await open(page, '/sessions');
    await expect(projects(page)).toHaveCount(2);
    await page.goto('/sessions/Codex/same');
    await expect(page.getByRole('heading', { name: 'from-codex' })).toBeVisible();
    await page.goto('/sessions/Claude%20Code/same');
    await expect(page.getByRole('heading', { name: 'from-claude' })).toBeVisible();
  });

  test('goes back to the list when the session is not there', async ({ page }) => {
    await event({ agent: 'Codex', id: 'there', status: 'working', project: 'still-here' });
    await page.goto('/sessions/Codex/not-there');
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(projects(page)).toHaveText(['still-here']);
  });

  test('shows at most 40 sessions: the server drops the least recently updated beyond that', async ({
    page,
  }) => {
    // The server keeps 40 (MaxSessions) and lists 40, so "N more are not listed" cannot happen against it.
    for (let i = 0; i < 45; i++)
      await event({ agent: 'Codex', id: `s-${i}`, status: 'working', project: `p-${i}` });
    await open(page, '/sessions');
    await expect(projects(page)).toHaveCount(40);
    const names = await texts(projects(page));
    for (let i = 0; i < 5; i++) expect(names).not.toContain(`p-${i}`);
    expect(names).toContain('p-44');
    await expect(page.getByText('are not listed')).toHaveCount(0);
  });

  test('keeps the server order and the status words on the list', async ({ page }) => {
    await seedMix();
    await open(page, '/sessions');
    await hideAlert(page);
    const badges = await texts(page.locator('.badge-status'));
    expect(badges).toEqual([
      'Needs you',
      'Error',
      'Working',
      'Working',
      'Notification',
      'Completed',
      'Idle',
    ]);
  });
});
