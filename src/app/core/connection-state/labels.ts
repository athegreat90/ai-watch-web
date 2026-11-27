import { ConnectionStatus } from './snapshot-state';

/** How each connection state is named on screen. */
export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  stale: 'Stale',
  offline: 'Offline',
  'token-rejected': 'Server token rejected',
  'login-required': 'Login required',
  'config-error': 'Proxy configuration error',
  demo: 'Demo data',
};
