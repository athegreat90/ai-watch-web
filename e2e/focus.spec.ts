import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { alertDialog, open } from './support/ui';
import { event } from './support/server';

const clock = (page: import('@playwright/test').Page) => page.locator('.clock');
const state = (page: import('@playwright/test').Page) => page.locator('.state');

test.describe('focus timer', () => {
  test('starts at 25:00, counts down, pauses, resumes and resets', async ({ page }) => {
    await page.clock.install();
    await open(page, '/focus');
    await expect(clock(page)).toHaveText('25:00');
    await expect(state(page)).toHaveText('Ready for 25 minutes');
    await expect(page.getByRole('button', { name: 'Reset' })).toBeDisabled();

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(state(page)).toHaveText('Focus time');
    await page.clock.fastForward(61_000);
    await expect(clock(page)).toHaveText('23:59');

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(state(page)).toHaveText('Paused');
    await page.clock.fastForward(5 * 60_000);
    await expect(clock(page)).toHaveText('23:59');

    await page.getByRole('button', { name: 'Resume' }).click();
    await page.clock.fastForward(60_000);
    await expect(clock(page)).toHaveText('22:59');

    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(clock(page)).toHaveText('25:00');
    await expect(state(page)).toHaveText('Ready for 25 minutes');
  });

  test('finishes after 25 minutes', async ({ page }) => {
    await page.clock.install();
    await open(page, '/focus');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.clock.fastForward(25 * 60_000 + 1000);
    await expect(state(page)).toHaveText('Focus complete');
    await expect(clock(page)).toHaveText('00:00');
  });

  test('is counted from timestamps: it keeps its time over a reload and while the page was away', async ({
    page,
  }) => {
    await page.clock.install();
    await open(page, '/focus');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.clock.fastForward(10 * 60_000);
    await expect(clock(page)).toHaveText('15:00');
    await page.reload();
    await expect(clock(page)).toHaveText(/^1[45]:\d\d$/);
    await expect(state(page)).toHaveText('Focus time');
    await page.clock.fastForward(20 * 60_000);
    await expect(state(page)).toHaveText('Focus complete');
  });

  test('shows the time left in the header on every page while it runs', async ({ page }) => {
    await page.clock.install();
    await open(page, '/focus');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.locator('.shell-timer')).toHaveText(/^\d\d:\d\d$/);
    await expect(page.locator('.shell-meeting')).toHaveText('Meeting');
  });
});

test.describe('meeting mode', () => {
  test('dims the page and shows a badge, and Escape alerts stay quiet', async ({ page }) => {
    await event({
      agent: 'Claude Code',
      id: 'n',
      status: 'needs_attention',
      project: 'asks',
      ago: 5,
    });
    await open(page, '/focus');
    await page.keyboard.press('Escape');
    await page.getByRole('checkbox', { name: 'Meeting mode' }).check();
    await expect(page.getByText('Meeting mode is on.')).toBeVisible();
    await expect(page.locator('.shell-main')).toHaveClass(/dimmed/);
    await expect(page.locator('.shell-meeting')).toBeVisible();
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await page.waitForTimeout(1500);
    await expect(alertDialog(page)).toBeHidden();
  });

  test('turning it off brings the screen back', async ({ page }) => {
    await open(page, '/focus');
    const toggle = page.getByRole('checkbox', { name: 'Meeting mode' });
    await toggle.check();
    await toggle.uncheck();
    await expect(page.locator('.shell-main')).not.toHaveClass(/dimmed/);
    await expect(page.locator('.shell-meeting')).toBeHidden();
  });
});

test.describe('idle robot', () => {
  /**
   * Cuts the server off and lets the connection settle on "Offline". A change of connection state
   * counts as activity (like a change in the sessions), so it must not happen during the jump.
   */
  async function settleOffline(page: Page, problems: string[]): Promise<void> {
    await page.route('**/api/status', (route) => route.abort());
    await page.clock.runFor(40_000);
    await expect(page.locator('.shell-status')).toHaveText('Offline');
    problems.length = 0; // the failed requests were asked for
  }
  const robot = (page: Page) => page.getByRole('img', { name: /Idle screen/ });
  // The aborted requests are the setup of these tests, so the browser's complaints about them are expected.
  test.afterEach(({ problems }) => {
    problems.length = 0;
  });

  test('appears after 15 minutes without touching, and any key wakes it', async ({
    page,
    problems,
  }) => {
    await page.clock.install();
    await open(page, '/dashboard');
    await settleOffline(page, problems);
    await expect(robot(page)).toBeHidden();
    await page.clock.fastForward(14 * 60_000);
    await expect(robot(page)).toBeHidden();
    await page.clock.fastForward(61_000);
    await expect(robot(page)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(robot(page)).toBeHidden();
  });

  test('a touch wakes it without pressing what is under it', async ({ page, problems }) => {
    await page.clock.install();
    await open(page, '/dashboard');
    await settleOffline(page, problems);
    await page.clock.fastForward(16 * 60_000);
    await expect(robot(page)).toBeVisible();
    await page.mouse.click(640, 400);
    await expect(robot(page)).toBeHidden();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
  // A change in the sessions or the connection also wakes it. That is covered by the unit tests of
  // activitySignature: with a fake clock the 4 s request timeout runs out before the real reply arrives.
});
