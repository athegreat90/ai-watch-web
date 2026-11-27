import { compose } from './support/stack';

export default function globalTeardown(): void {
  if (process.env['E2E_NO_STACK'] === '1' || process.env['E2E_KEEP'] === '1') return;
  compose(['down', '-v', '--remove-orphans']);
}
