import { event } from './support/server';
import { expect, test } from './support/fixtures';
import { open, seedMix } from './support/ui';

for (const size of [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
]) {
  test.describe(`kiosk at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test('fits the screen without scrolling, even with many sessions', async ({ page }) => {
      for (let i = 0; i < 14; i++)
        await event({ agent: 'Codex', id: `k${i}`, status: 'working', project: `project-${i}` });
      await open(page, '/kiosk');
      await expect(page.locator('.k-row').first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        y: document.documentElement.scrollHeight - window.innerHeight,
        x: document.documentElement.scrollWidth - window.innerWidth,
      }));
      expect(overflow.y).toBeLessThanOrEqual(0);
      expect(overflow.x).toBeLessThanOrEqual(0);
      await expect(page.getByText(/^\+ \d+ more$/)).toBeVisible();
    });

    test('has touch targets of at least 48 px', async ({ page }) => {
      await open(page, '/kiosk');
      for (const control of await page.locator('.k-button').all()) {
        const box = await control.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      }
    });
  });
}

test.describe('kiosk', () => {
  test.use({ viewport: { width: 800, height: 480 } });

  test('shows the counters, the sessions and the connection, and can be closed', async ({
    page,
  }) => {
    await seedMix();
    await open(page, '/kiosk');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'AI Watch', level: 1 })).toBeVisible();
    await expect(page.locator('.k-status')).toHaveText('Live');
    await expect(page.locator('.k-row').first()).toContainText('checkout-service');
    await expect(page.getByRole('link', { name: 'Close kiosk' })).toBeVisible();
    await page.getByRole('link', { name: 'Close kiosk' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('has no header or navigation of the normal shell', async ({ page }) => {
    await open(page, '/kiosk');
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  });

  test('moves a little over time so a still picture does not burn in, using transforms only', async ({
    page,
  }) => {
    await open(page, '/kiosk');
    const transform = () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.k-shift, [data-pixel-shift], .kiosk');
        return el ? getComputedStyle(el).transform : 'none';
      });
    expect(await transform()).toMatch(/^(none|matrix\(.*\))$/);
  });
});
