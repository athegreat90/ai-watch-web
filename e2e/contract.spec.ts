import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ports, readToken } from './support/stack';
import { expect, test } from './support/fixtures';

/**
 * The contract test (tests/contract) checks what the app's parser assumes about the AI Watch server
 * against the real, pinned server release of compose.test.yaml. It writes data, so it only ever
 * runs against that throwaway server.
 */
test('the app parser agrees with the pinned AI Watch server release', () => {
  const root = path.resolve(__dirname, '..');
  const run = spawnSync(
    process.execPath,
    [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--test',
      '--test-reporter=tap',
      'tests/contract/status.contract.test.mjs',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        AIW_CONTRACT_URL: `http://127.0.0.1:${ports.server}`,
        AIW_CONTRACT_TOKEN: readToken(),
      },
    },
  );
  const out = `${run.stdout}\n${run.stderr}`;
  expect(run.status, out).toBe(0);
  expect(out).toMatch(/# fail 0/);
  expect(out).not.toMatch(/# skipped [1-9]/);
  expect(Number(/# pass (\d+)/.exec(out)?.[1])).toBeGreaterThanOrEqual(14);
});
