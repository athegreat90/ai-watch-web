import { event, finishTask, longTask } from './support/server';
import { expect, test } from './support/fixtures';
import { celebration, open } from './support/ui';

test.describe('task done celebration', () => {
  test('celebrates when a long task finishes while you watch', async ({ page }) => {
    await longTask('Codex', 't1', 'big-refactor');
    await open(page, '/dashboard');
    await expect(page.locator('.row-activity').first()).toContainText('Running');
    await expect(celebration(page)).toBeHidden();
    await finishTask('Codex', 't1', 'big-refactor');
    await expect(celebration(page)).toBeVisible({ timeout: 15_000 });
    await expect(celebration(page)).toContainText('Task done!');
    await expect(celebration(page)).toContainText(/big-refactor · \d+m \d+s/);
  });

  test('goes away by itself after about 4 seconds', async ({ page }) => {
    await longTask('Codex', 't1', 'big-refactor');
    await open(page, '/dashboard');
    await expect(page.locator('.row-activity').first()).toContainText('Running');
    await finishTask('Codex', 't1', 'big-refactor');
    await expect(celebration(page)).toBeVisible({ timeout: 15_000 });
    await expect(celebration(page)).toBeHidden({ timeout: 8_000 });
  });

  test('can be dismissed', async ({ page }) => {
    await longTask('Codex', 't1', 'big-refactor');
    await open(page, '/dashboard');
    await expect(page.locator('.row-activity').first()).toContainText('Running');
    await finishTask('Codex', 't1', 'big-refactor');
    await expect(celebration(page)).toBeVisible({ timeout: 15_000 });
    await celebration(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(celebration(page)).toBeHidden();
  });

  test('stays quiet for a short task: the server only marks tasks of 5 minutes or more', async ({
    page,
  }) => {
    await event({ agent: 'Codex', id: 'short', status: 'working', project: 'quick', ago: 30 });
    await open(page, '/dashboard');
    await expect(page.locator('.row-activity').first()).toContainText('Running');
    await event({ agent: 'Codex', id: 'short', status: 'done', project: 'quick' });
    // The page sees it finish, and the server does not call 30 s a long task.
    await expect(page.locator('.row-activity').first()).toContainText('Took', { timeout: 15_000 });
    await page.waitForTimeout(2_000);
    await expect(celebration(page)).toBeHidden();
  });

  test('does not celebrate a task that was already done when the page opened', async ({ page }) => {
    await longTask('Codex', 't1', 'old-news');
    await finishTask('Codex', 't1', 'old-news');
    await open(page, '/dashboard');
    await page.waitForTimeout(5_000);
    await expect(celebration(page)).toBeHidden();
  });

  test('stays quiet in meeting mode', async ({ page }) => {
    await longTask('Codex', 't1', 'quiet-one');
    await open(page, '/focus');
    await page.getByRole('checkbox', { name: 'Meeting mode' }).check();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.row-activity').first()).toContainText('Running');
    await finishTask('Codex', 't1', 'quiet-one');
    // The page did see the task finish, so the silence below is the meeting mode and not a miss.
    await expect(page.locator('.row-activity').first()).toContainText('Took', { timeout: 15_000 });
    await page.waitForTimeout(2_000);
    await expect(celebration(page)).toBeHidden();
  });
});
