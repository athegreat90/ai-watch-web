import { event } from './support/server';
import { expect, test } from './support/fixtures';
import { acknowledgeAlert, alertDialog, open } from './support/ui';

const needsYou = (id: string, project: string, ago = 30) =>
  event({
    agent: 'Claude Code',
    id,
    status: 'needs_attention',
    project,
    detail: 'Approve the plan?',
    ago,
  });

test.describe('NEEDS YOU alert', () => {
  test('opens on its own when a session needs you, and says which one', async ({ page }) => {
    await open(page, '/dashboard');
    await expect(alertDialog(page)).toBeHidden();
    await needsYou('a1', 'checkout-service');
    await expect(alertDialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(alertDialog(page).getByRole('heading', { name: 'Needs you' })).toBeVisible();
    await expect(alertDialog(page)).toContainText('checkout-service');
    await expect(alertDialog(page)).toContainText('Claude Code');
    await expect(alertDialog(page)).toContainText('Approve the plan?');
    await expect(alertDialog(page)).toContainText(/Waiting \d+s/);
  });

  test('lists every session that needs you', async ({ page }) => {
    await needsYou('a1', 'first-project');
    await needsYou('a2', 'second-project');
    await open(page, '/dashboard');
    await expect(alertDialog(page).locator('.alert-item')).toHaveCount(2);
  });

  test('Escape only hides it: the session still needs you and it comes back', async ({ page }) => {
    await page.clock.install();
    await needsYou('a1', 'checkout-service');
    await open(page, '/dashboard');
    await expect(alertDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(alertDialog(page)).toBeHidden();
    // The hint promises two minutes.
    await page.clock.fastForward(60_000);
    await expect(alertDialog(page)).toBeHidden();
    await page.clock.fastForward(61_000);
    await expect(alertDialog(page)).toBeVisible();
  });

  test('Acknowledge stops it for good, and a new update of the session brings it back', async ({
    page,
  }) => {
    await page.clock.install();
    await needsYou('a1', 'checkout-service');
    await open(page, '/dashboard');
    await expect(alertDialog(page)).toBeVisible();
    await acknowledgeAlert(page);
    await expect(alertDialog(page)).toBeHidden();
    await page.clock.fastForward(5 * 60_000);
    await expect(alertDialog(page)).toBeHidden();
    // The same session asks again: a new `updated`, so a new alert.
    await needsYou('a1', 'checkout-service', 0);
    await page.clock.fastForward(10_000);
    await expect(alertDialog(page)).toBeVisible();
  });

  test('keeps an acknowledgement after a reload', async ({ page }) => {
    await needsYou('a1', 'checkout-service');
    await open(page, '/dashboard');
    await acknowledgeAlert(page);
    await page.reload();
    await expect(page.locator('.shell-status')).toHaveText('Live');
    await expect(alertDialog(page)).toBeHidden();
  });

  test('Open goes to the session', async ({ page }) => {
    await needsYou('a1', 'checkout-service');
    await open(page, '/dashboard');
    await alertDialog(page).getByRole('link', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/sessions\/Claude%20Code\/a1$/);
    await expect(alertDialog(page)).toBeHidden();
  });

  test('keeps the keyboard out of the page behind while it is open', async ({ page }) => {
    await needsYou('a1', 'checkout-service');
    await open(page, '/dashboard');
    await expect(alertDialog(page)).toBeVisible();
    // A modal dialog lets focus pass through the document once per lap, but never to a control behind it.
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      seen.add(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return 'document';
          return el.closest('dialog.alert') ? 'dialog' : 'BEHIND:' + el.tagName;
        }),
      );
    }
    expect([...seen].sort()).toEqual(['dialog', 'document']);
  });

  test('is not shown for a session that is only working', async ({ page }) => {
    await event({ agent: 'Codex', id: 'w', status: 'working', project: 'busy' });
    await open(page, '/dashboard');
    await page.waitForTimeout(1500);
    await expect(alertDialog(page)).toBeHidden();
  });
});
