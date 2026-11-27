import { connectionMessage } from './messages';
import { ConnectionStatus } from './snapshot-state';

describe('connectionMessage', () => {
  it.each<ConnectionStatus>(['connecting', 'live'])('says nothing while %s', (status) => {
    expect(connectionMessage(status, '22:14:06')).toBeNull();
  });

  it.each<[ConnectionStatus, string]>([
    ['stale', 'out of date'],
    ['offline', 'unreachable'],
    ['token-rejected', 'refused the token'],
    ['login-required', 'Sign in'],
    ['config-error', 'proxy blocks a route'],
  ])('explains %s', (status, part) => {
    expect(connectionMessage(status, null)).toContain(part);
  });

  it('says nothing in demo mode, because the shell shows a banner for it', () => {
    expect(connectionMessage('demo', '22:14:06')).toBeNull();
  });

  it('adds the time of the last data when there is some', () => {
    expect(connectionMessage('offline', '22:14:06')).toBe(
      'Server unreachable. Showing the last data from 22:14:06.',
    );
  });

  it('does not claim there is data when there is none', () => {
    expect(connectionMessage('offline', null)).toBe('Server unreachable.');
  });
});
