import { expect, test as base } from '@playwright/test';
import { resetServer } from './server';

interface Fixtures {
  /** Starts every test from an empty server. Automatic. */
  cleanServer: void;
  /**
   * What the browser complained about during the test: script errors, console errors and Content
   * Security Policy violations. A test fails if any are left at the end. A test that causes one on
   * purpose, such as asking for a blocked route, clears the list.
   */
  problems: string[];
}

export const test = base.extend<Fixtures>({
  cleanServer: [
    async ({}, use) => {
      await resetServer();
      await use();
    },
    { auto: true },
  ],

  problems: [
    async ({ page }, use) => {
      const list: string[] = [];
      page.on('pageerror', (error) => list.push(`script error: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') list.push(`console: ${message.text()}`);
      });
      await page.addInitScript(() => {
        const w = window as unknown as { __csp: string[] };
        w.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) =>
          w.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`),
        );
      });
      await use(list);
      const csp = await page
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => [] as string[]);
      list.push(...csp.map((c) => `CSP: ${c}`));
      expect(list, 'the browser reported problems').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
