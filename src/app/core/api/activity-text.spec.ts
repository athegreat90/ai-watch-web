import { view } from '../../testing/fixtures';
import { activityText } from './session-view';

describe('activityText', () => {
  it('says how long a session that needs you has waited', () => {
    expect(activityText(view({ status: 'needs_attention', waiting: 125 }))).toBe('Waiting 2m 05s');
  });

  it('says how long a running session has run, moved on by the time since the response', () => {
    expect(activityText(view({ status: 'working', duration: 185 }, 5))).toBe('Running 3m 10s');
  });

  it('says how long a finished session took, and does not move it on', () => {
    expect(activityText(view({ status: 'done', duration: 395 }, 60))).toBe('Took 6m 35s');
  });

  it.each(['idle', 'notice', 'error', 'sleeping'])('says nothing for a %s session', (status) => {
    expect(activityText(view({ status }))).toBeNull();
  });
});
