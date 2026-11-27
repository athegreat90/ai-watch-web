import { TestBed } from '@angular/core/testing';
import { ReplaySubject } from 'rxjs';
import { Snapshot } from '../api/models';
import { PollEvent } from '../polling/poll';
import { StatusPoller } from '../polling/status-poller';
import { SettingsStore } from '../settings/settings-store';
import { snapshot } from '../../testing/fixtures';
import { ConnectionState } from './connection-state';

describe('ConnectionState in demo mode', () => {
  let events$: ReplaySubject<PollEvent<Snapshot>>;
  let state: ConnectionState;
  let settings: SettingsStore;

  beforeEach(() => {
    sessionStorage.clear();
    events$ = new ReplaySubject(1);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: StatusPoller,
          useValue: { events$, intervalMs: 3000, refresh: () => undefined },
        },
      ],
    });
    settings = TestBed.inject(SettingsStore);
    state = TestBed.inject(ConnectionState);
  });

  afterEach(() => sessionStorage.clear());

  it('says demo, not live, while demo mode is on', () => {
    settings.setDemo(true);
    events$.next({ ok: true, data: snapshot([]), at: 1 });
    expect(state.status()).toBe('demo');
  });

  it('says demo even when the example data was not delivered yet', () => {
    settings.setDemo(true);
    expect(state.status()).toBe('demo');
  });

  it('goes back to the real state when demo mode is off', () => {
    events$.next({ ok: true, data: snapshot([]), at: 1 });
    settings.setDemo(true);
    settings.setDemo(false);
    expect(state.status()).toBe('live');
  });

  it('reports a real outage as an outage when demo mode is off', () => {
    events$.next({ ok: false, error: 'offline', at: 1 });
    expect(state.status()).toBe('offline');
  });
});
