import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Snapshot } from '../api/models';
import { RuntimeConfig } from '../config/runtime-config';
import { SettingsStore } from '../settings/settings-store';
import { PAGE_VISIBLE } from './page-visibility';
import { PollEvent } from './poll';
import { StatusPoller } from './status-poller';

describe('StatusPoller with settings', () => {
  let http: HttpTestingController;
  let settings: SettingsStore;
  let poller: StatusPoller;
  let events: PollEvent<Snapshot>[];

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PAGE_VISIBLE, useValue: of(true) },
        { provide: RuntimeConfig, useValue: { value: () => ({ pollIntervalMs: 3000 }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(SettingsStore);
  }

  const start = () => {
    poller = TestBed.inject(StatusPoller);
    events = [];
    poller.events$.subscribe((event) => events.push(event));
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('demo mode', () => {
    it('shows example data and never asks the server', () => {
      create();
      settings.setDemo(true);
      start();
      http.expectNone('/api/status');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ ok: true });
      const data = (events[0] as { data: Snapshot }).data;
      expect(data.sessions.map((s) => s.session_id)).toContain('demo-checkout');
    });

    it('asks the server when demo mode is off, and shows what it says', () => {
      create();
      start();
      http.expectOne('/api/status').flush({ sessions: [], limits: {} });
      expect(events[0]).toMatchObject({ ok: true });
      expect((events[0] as { data: Snapshot }).data.sessions).toEqual([]);
    });

    it('shows a server that is down as down, never as example data', () => {
      create();
      start();
      http.expectOne('/api/status').flush('', { status: 503, statusText: 'Unavailable' });
      expect(events[0]).toMatchObject({ ok: false, error: 'offline' });
    });
  });

  describe('update interval', () => {
    it('is the deployment default when the user chose nothing', () => {
      create();
      expect(TestBed.inject(StatusPoller).intervalMs).toBe(3000);
    });

    it("is the user's own choice when there is one", () => {
      create();
      settings.setPollIntervalMs(10_000);
      expect(TestBed.inject(StatusPoller).intervalMs).toBe(10_000);
    });

    it('is the saved choice after a reload', () => {
      localStorage.setItem('aiw.settings', '{"pollIntervalMs":5000}');
      create();
      expect(TestBed.inject(StatusPoller).intervalMs).toBe(5000);
    });
  });
});
