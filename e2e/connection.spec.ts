import { event, startServer, stopServer } from './support/server';
import { ports } from './support/stack';
import { connection, hideAlert, open, projects } from './support/ui';
import { expect, test } from './support/fixtures';

const banner = (page: import('@playwright/test').Page) => page.locator('.banner');

test.describe('connection states', () => {
  test('goes stale then offline when the server stops, keeps the last data, and recovers', async ({
    page,
    problems,
  }) => {
    await event({ agent: 'Codex', id: 'c1', status: 'working', project: 'kept-on-screen' });
    await open(page, '/dashboard');
    await expect(connection(page)).toHaveText('Live');

    await stopServer();
    // Three missed intervals make it stale, and the proxy answers 502 until the server is back.
    await expect(connection(page)).toHaveText(/^(Stale|Offline)$/, { timeout: 30_000 });
    await expect(banner(page)).toContainText(/Showing the last data from \d\d:\d\d:\d\d/);
    await expect(projects(page)).toHaveText(['kept-on-screen']);
    // A failing server is the one place the browser reports failed requests on purpose.
    problems.length = 0;

    await startServer();
    await expect(connection(page)).toHaveText('Live', { timeout: 45_000 });
    await expect(banner(page)).toBeHidden();
  });

  test('says "Offline" with no data when the server was never there', async ({
    page,
    problems,
  }) => {
    await stopServer();
    await page.goto('/dashboard');
    await expect(connection(page)).toHaveText('Offline', { timeout: 30_000 });
    await expect(banner(page)).toHaveText('Server unreachable.');
    await expect(projects(page)).toHaveCount(0);
    problems.length = 0;
    await startServer();
  });

  test('stops asking while the tab is hidden', async ({ page }) => {
    await open(page, '/dashboard');
    let asked = 0;
    await page.route('**/api/status', async (route) => {
      asked++;
      await route.continue();
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    asked = 0;
    await page.waitForTimeout(8_000);
    expect(asked).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => asked, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('asks about every 3 seconds while visible', async ({ page }) => {
    await open(page, '/dashboard');
    const times: number[] = [];
    await page.route('**/api/status', async (route) => {
      times.push(Date.now());
      await route.continue();
    });
    await page.waitForTimeout(13_000);
    // 13 s at 3 s apart is 4 or 5 requests. The proxy's cache does not change what the page sends.
    expect(times.length).toBeGreaterThanOrEqual(3);
    expect(times.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(2_000);
  });
});

test.describe('how many requests a page makes', () => {
  test('the Sessions page asks for the list half as often as the status: 30 a minute, not 40', async ({
    page,
  }) => {
    await open(page, '/sessions');
    const seen = { status: 0, list: 0 };
    await page.route('**/api/status', async (route) => {
      seen.status++;
      await route.continue();
    });
    await page.route('**/api/sessions', async (route) => {
      seen.list++;
      await route.continue();
    });
    await page.waitForTimeout(24_000);
    // In 24 seconds: the status about every 3 s (8), the list about every 6 s (4). Not 8 and 8.
    expect(seen.status).toBeGreaterThanOrEqual(6);
    expect(seen.status).toBeLessThanOrEqual(9);
    expect(seen.list).toBeGreaterThanOrEqual(3);
    expect(seen.list).toBeLessThanOrEqual(5);
    expect(seen.status + seen.list).toBeLessThanOrEqual(13);
  });

  test('every other page still asks every 3 seconds, and only for the status', async ({ page }) => {
    await open(page, '/limits');
    let asked = 0;
    await page.route('**/api/**', async (route) => {
      asked++;
      await route.continue();
    });
    await page.waitForTimeout(12_000);
    expect(asked).toBeGreaterThanOrEqual(3);
    expect(asked).toBeLessThanOrEqual(5); // 12 s at 3 s apart: 4, and only /api/status
  });
});

test.describe('the proxy token is refused by the server', () => {
  test.use({ baseURL: `http://127.0.0.1:${ports.badToken}` });

  test('says so, and says it is the proxy secret, not a login', async ({ page, problems }) => {
    await page.goto('/dashboard');
    await expect(connection(page)).toHaveText('Server token rejected', { timeout: 20_000 });
    await expect(banner(page)).toContainText('The server refused the token the proxy sends.');
    await hideAlert(page);
    problems.length = 0; // the 401s are the point of this test
  });
});
