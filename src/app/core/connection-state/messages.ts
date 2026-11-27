import { ConnectionStatus } from './snapshot-state';

/**
 * The line a screen shows above its data when the connection is not healthy, or null when there
 * is nothing to say. `lastSync` is a clock time such as 22:14:06.
 */
export function connectionMessage(
  status: ConnectionStatus,
  lastSync: string | null,
): string | null {
  let message: string;
  switch (status) {
    case 'connecting':
    case 'live':
    case 'demo': // Demo mode has its own banner in the shell.
      return null;
    case 'stale':
      message = 'Data may be out of date.';
      break;
    case 'offline':
      message = 'Server unreachable.';
      break;
    case 'token-rejected':
      message = 'The server refused the token the proxy sends. Check the proxy secret.';
      break;
    case 'login-required':
      message = 'Sign in to the dashboard to see data.';
      break;
    case 'config-error':
      message = 'The proxy blocks a route this page needs. Check the proxy configuration.';
      break;
  }
  return lastSync ? `${message} Showing the last data from ${lastSync}.` : message;
}
