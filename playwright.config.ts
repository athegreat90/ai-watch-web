import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the real image and the real AI Watch server (see compose.test.yaml).
 * They run one at a time: the server holds the state of every session, so tests share it and each
 * one starts from a clean server.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],
  outputDir: 'e2e/.results',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${process.env['E2E_WEB_PORT'] ?? 18080}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
