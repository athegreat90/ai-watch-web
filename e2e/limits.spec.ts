import { event, limits } from './support/server';
import { expect, test } from './support/fixtures';
import { open, seedMix } from './support/ui';

const bar = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('progressbar', { name });

test.describe('usage limits', () => {
  test('shows each window with its percentage, the colour level and what is left', async ({
    page,
  }) => {
    await seedMix();
    await open(page, '/limits');
    await expect(page.getByRole('region', { name: 'Claude Code usage' })).toBeVisible();

    const claude5 = bar(page, 'Claude Code 5 hours usage');
    expect(Number(await claude5.getAttribute('aria-valuenow'))).toBeCloseTo(72.5, 0);
    await expect(claude5.locator('i')).toHaveAttribute('data-level', 'warn');
    await expect(bar(page, 'Claude Code Weekly usage').locator('i')).toHaveAttribute(
      'data-level',
      'ok',
    );

    const codex5 = bar(page, 'Codex 5 hours usage');
    expect(Number(await codex5.getAttribute('aria-valuenow'))).toBe(93);
    await expect(codex5.locator('i')).toHaveAttribute('data-level', 'critical');
    await expect(page.getByRole('region', { name: 'Codex usage' })).toContainText('7 % left');
  });

  test('says there is no data for an agent that has not reported', async ({ page }) => {
    await limits('Claude Code', 10, 20);
    await open(page, '/limits');
    await expect(page.getByRole('region', { name: 'Antigravity usage' })).toContainText(
      'No usage data.',
    );
    await expect(page.getByRole('region', { name: 'Claude Code usage' })).not.toContainText(
      'No usage data.',
    );
  });

  test('shows the window as due once its reset time passes', async ({ page }) => {
    await limits('Claude Code', 50, 10, 6);
    await open(page, '/limits');
    const foot = page
      .getByRole('region', { name: 'Claude Code usage' })
      .locator('.window-foot')
      .first();
    await expect(foot).toContainText('Resets in under 1m');
    await expect(foot).toContainText('Reset due. Waiting for new data.', { timeout: 15_000 });
  });

  test('updates when the agent reports again', async ({ page }) => {
    await limits('Codex', 20, 5);
    await open(page, '/limits');
    expect(Number(await bar(page, 'Codex 5 hours usage').getAttribute('aria-valuenow'))).toBe(20);
    await limits('Codex', 95, 5);
    await expect(async () => {
      expect(Number(await bar(page, 'Codex 5 hours usage').getAttribute('aria-valuenow'))).toBe(95);
    }).toPass({ timeout: 15_000 });
  });

  test('lists the agents that have sessions but no limits as well', async ({ page }) => {
    await event({ agent: 'Codex', id: 'x', status: 'working', project: 'p' });
    await open(page, '/limits');
    for (const agent of ['Claude Code', 'Codex', 'Antigravity'])
      await expect(page.getByRole('region', { name: `${agent} usage` })).toBeVisible();
  });
});
