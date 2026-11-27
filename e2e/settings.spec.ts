import { event } from './support/server';
import { expect, test } from './support/fixtures';
import { hideAlert, open, projects } from './support/ui';

const theme = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.dataset['theme']);
const bodyBg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('themes', () => {
  test('AMOLED is the default: a true black page on the first visit', async ({ page }) => {
    await open(page, '/dashboard');
    expect(await theme(page)).toBe('amoled');
    expect(await bodyBg(page)).toBe('rgb(0, 0, 0)');
  });

  test('AMOLED stays the default even when the system prefers a light theme', async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await open(page, '/dashboard');
    expect(await theme(page)).toBe('amoled');
    expect(await bodyBg(page)).toBe('rgb(0, 0, 0)');
    await context.close();
  });

  test('is right before the app starts: the saved theme is applied with scripts off', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('aiw.theme', 'light'));
    const page = await context.newPage();
    await page.route('**/*.js', (route) =>
      route.request().url().endsWith('theme-init.js') ? route.continue() : route.abort(),
    );
    await page.goto('/dashboard');
    expect(await theme(page)).toBe('light');
    await context.close();
  });

  for (const [choice, expected] of [
    ['amoled', 'rgb(0, 0, 0)'],
    ['dark', 'rgb(15, 17, 20)'],
    ['light', 'rgb(246, 247, 248)'],
  ] as const) {
    test(`switching to ${choice} changes the page and survives a reload`, async ({ page }) => {
      await open(page, '/settings');
      await page.locator(`input[name=theme][value=${choice}]`).check();
      await expect.poll(() => theme(page)).toBe(choice);
      await expect.poll(() => bodyBg(page)).toBe(expected);
      await page.reload();
      await expect.poll(() => theme(page)).toBe(choice);
    });
  }

  test('"system" follows the system and is never AMOLED', async ({ browser }) => {
    for (const [scheme, expected] of [
      ['dark', 'dark'],
      ['light', 'light'],
    ] as const) {
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();
      await open(page, '/settings');
      await page.locator('input[name=theme][value=system]').check();
      await expect.poll(() => theme(page)).toBe(expected);
      expect(await bodyBg(page)).not.toBe('rgb(0, 0, 0)');
      await context.close();
    }
  });

  test('uses no shadows or gradients on AMOLED', async ({ page }) => {
    await event({ agent: 'Codex', id: 'x', status: 'working', project: 'flat' });
    await open(page, '/dashboard');
    const offenders = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((el) => {
          const s = getComputedStyle(el);
          return (
            s.boxShadow !== 'none' || s.backgroundImage.includes('gradient') || s.filter !== 'none'
          );
        })
        .map((el) => `${el.tagName}.${el.className}`),
    );
    expect(offenders).toEqual([]);
  });
});

test.describe('settings', () => {
  test('the update interval changes how often the page asks, and is kept', async ({ page }) => {
    await open(page, '/settings');
    await page.locator('#poll').selectOption({ label: '10 seconds' });
    await page.getByRole('button', { name: /Apply|Reload/ }).click();
    await page.waitForLoadState();
    await open(page, '/dashboard');
    const times: number[] = [];
    await page.route('**/api/status', async (route) => {
      times.push(Date.now());
      await route.continue();
    });
    await page.waitForTimeout(25_000);
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.length).toBeLessThanOrEqual(3);
  });

  test('"Test connection" says the server answers', async ({ page }) => {
    await open(page, '/settings');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.locator('.result')).toHaveText('The server answers.');
  });

  test('keeps nothing secret in the browser', async ({ page }) => {
    await event({ agent: 'Codex', id: 'x', status: 'working', project: 'p' });
    await open(page, '/settings');
    await page.locator('input[name=theme][value=dark]').check();
    const stored = await page.evaluate(
      () =>
        JSON.stringify({ ...localStorage }) +
        JSON.stringify({ ...sessionStorage }) +
        document.cookie,
    );
    expect(stored).not.toMatch(/monitor|token|key/i);
    const config = await (await page.request.get('/config.json')).text();
    expect(config).not.toMatch(/token|key|secret/i);
  });
});

test.describe('demo mode', () => {
  test('shows example data with a clear banner, and never mixes it with real data', async ({
    page,
  }) => {
    await event({ agent: 'Codex', id: 'real', status: 'working', project: 'my-real-project' });
    await open(page, '/settings');
    await page.getByRole('checkbox', { name: /Show example data/ }).check();
    await page.waitForLoadState();
    await open(page, '/dashboard');
    await hideAlert(page);
    await expect(
      page.getByText('Demo mode: this is example data, not your sessions.'),
    ).toBeVisible();
    await expect(page.locator('.shell-status')).toHaveText('Demo data');
    await expect(page.getByText('my-real-project')).toHaveCount(0);
    expect(await projects(page).count()).toBeGreaterThan(0);
  });

  test('is per tab and off again for a new one', async ({ page, context }) => {
    await open(page, '/settings');
    await page.getByRole('checkbox', { name: /Show example data/ }).check();
    const other = await context.newPage();
    await open(other, '/dashboard');
    await expect(other.getByText('Demo mode:')).toHaveCount(0);
  });
});
