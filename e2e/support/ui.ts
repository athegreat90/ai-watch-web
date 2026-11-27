import type { Locator, Page } from '@playwright/test';
import { event, limits } from './server';

export const alertDialog = (page: Page): Locator => page.locator('dialog.alert');
export const connection = (page: Page): Locator => page.locator('.shell-status');
export const projects = (page: Page): Locator => page.locator('.row-project');
export const celebration = (page: Page): Locator => page.locator('.celebrate');

/** A normal mix: one session waiting for you, one failure, two running, one finished. */
export async function seedMix(): Promise<void> {
  await event({
    agent: 'Claude Code',
    id: 'checkout',
    status: 'needs_attention',
    project: 'checkout-service',
    detail: 'Approve running the migration?',
    ago: 250,
  });
  await event({
    agent: 'Claude Code',
    id: 'billing',
    status: 'error',
    project: 'billing-api',
    detail: 'Command failed with exit code 2',
    ago: 40,
  });
  await event({
    agent: 'Codex',
    id: 'docs',
    status: 'working',
    project: 'docs-site',
    detail: 'Running the test suite',
    ago: 760,
  });
  await event({
    agent: 'Antigravity',
    id: 'web',
    status: 'working',
    project: 'ai-watch-web',
    detail: 'Editing the dashboard',
    ago: 95,
  });
  await event({
    agent: 'Gemini CLI',
    id: 'notes',
    status: 'notice',
    project: 'notes',
    detail: 'Waiting for the build',
    ago: 30,
  });
  await event({
    agent: 'Codex',
    id: 'infra',
    status: 'done',
    project: 'infra-scripts',
    detail: 'All changes applied',
    ago: 8,
  });
  await event({ agent: 'Claude Code', id: 'sandbox', status: 'idle', project: 'sandbox', ago: 12 });
  await limits('Claude Code', 72.5, 10);
  await limits('Codex', 93, 55.5, 1200);
}

/** Closes the NEEDS YOU alert with Escape, if it is open. It only hides it. */
export async function hideAlert(page: Page): Promise<void> {
  if (await alertDialog(page).isVisible()) await page.keyboard.press('Escape');
}

export async function acknowledgeAlert(page: Page): Promise<void> {
  await alertDialog(page).getByRole('button', { name: 'Acknowledge' }).first().click();
}

/** Opens a page and waits until the app has its first answer from the server. */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.locator('.shell-status, .k-status').first().waitFor();
  await page.waitForFunction(() => {
    const chip = document.querySelector('.shell-status, .k-status');
    const text = chip?.textContent?.trim() ?? '';
    // Empty is the moment before the first render, not an answer from the server.
    return text !== '' && text !== 'Connecting…';
  });
}

/** Label and value pairs of a `dl`, as "Label value" (the markup has no space between them). */
export const pairs = (rows: Locator): Promise<string[]> =>
  rows.evaluateAll((els) =>
    els.map(
      (e) =>
        `${e.querySelector('dt')?.textContent?.trim()} ${e.querySelector('dd')?.textContent?.trim()}`,
    ),
  );

/** Text of a list of elements, trimmed. */
export const texts = (locator: Locator): Promise<string[]> =>
  locator.allTextContents().then((all) => all.map((t) => t.replace(/\s+/g, ' ').trim()));
