import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { event } from './support/server';
import { expect, test } from './support/fixtures';
import { alertDialog, hideAlert, open, seedMix } from './support/ui';

const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface Violation {
  id: string;
  impact?: string | null;
  nodes: { target: unknown; failureSummary?: string }[];
}

/** Runs axe in the page. It is evaluated, not added as a script, because the CSP forbids inline scripts. */
async function audit(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(() =>
    (window as unknown as { axe: { run: () => Promise<{ violations: Violation[] }> } }).axe
      .run()
      .then((r) => r.violations),
  );
  return violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => JSON.stringify(n.target)).join(' ')}`,
  );
}

const THEMES = ['amoled', 'dark', 'light'] as const;
const PAGES = ['/dashboard', '/sessions', '/limits', '/focus', '/settings', '/kiosk'] as const;

for (const theme of THEMES) {
  test.describe(`accessibility on ${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('aiw.theme', t), theme);
      await seedMix();
    });

    for (const path of PAGES) {
      test(`${path} has no axe violations`, async ({ page }) => {
        await open(page, path);
        await hideAlert(page);
        expect(await audit(page)).toEqual([]);
      });
    }

    test('a session detail has no axe violations', async ({ page }) => {
      await open(page, '/sessions/Codex/docs');
      await hideAlert(page);
      expect(await audit(page)).toEqual([]);
    });

    test('the NEEDS YOU alert has no axe violations', async ({ page }) => {
      await open(page, '/dashboard');
      await expect(alertDialog(page)).toBeVisible();
      expect(await audit(page)).toEqual([]);
    });

    test('the page is readable while meeting mode dims it', async ({ page }) => {
      await open(page, '/focus');
      await hideAlert(page);
      await page.getByRole('checkbox', { name: 'Meeting mode' }).check();
      // Axe must read the settled colours, not the middle of the dimming transition.
      await expect(page.locator('.shell-main')).toHaveClass(/dimmed/);
      await page.waitForTimeout(700);
      expect(await audit(page)).toEqual([]);
    });
  });
}

test.describe('keyboard and structure', () => {
  test('the skip link is the first stop and jumps to the content', async ({ page }) => {
    await event({ agent: 'Codex', id: 'x', status: 'working', project: 'p' });
    await open(page, '/dashboard');
    await page.keyboard.press('Tab');
    const link = page.getByRole('link', { name: 'Skip to content' });
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('every page has one main landmark and one h1', async ({ page }) => {
    await seedMix();
    for (const path of PAGES) {
      await open(page, path);
      await hideAlert(page);
      expect(await page.locator('main').count(), path).toBe(1);
      expect(await page.locator('h1').count(), path).toBe(1);
    }
  });

  test('the connection state is announced', async ({ page }) => {
    await open(page, '/dashboard');
    await expect(page.locator('.shell-status')).toHaveAttribute('role', 'status');
  });

  test('moving is optional: animations stop when the system asks for reduced motion', async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await open(page, '/dashboard');
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    );
    expect(running).toBe(0);
    await context.close();
  });
});
