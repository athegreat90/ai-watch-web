import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RuntimeConfig } from '../../core/config/runtime-config';
import { PAGE_VISIBLE } from '../../core/polling/page-visibility';
import { SettingsStore } from '../../core/settings/settings-store';
import { SessionsFeed } from './sessions-feed';

describe('SessionsFeed', () => {
  let http: HttpTestingController;
  let settings: SettingsStore;

  function create() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SessionsFeed,
        { provide: PAGE_VISIBLE, useValue: of(true) },
        { provide: RuntimeConfig, useValue: { value: () => ({ pollIntervalMs: 3000 }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    settings = TestBed.inject(SettingsStore);
  }

  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('reads the full list from /api/sessions', () => {
    create();
    const feed = TestBed.inject(SessionsFeed);
    http.expectOne('/api/sessions').flush({
      sessions: [{ session_id: 's1', agent: 'Codex', status: 'working' }],
      limits: {},
    });
    expect(feed.state.views().map((v) => v.sessionId)).toEqual(['s1']);
  });

  it('shows the example sessions in demo mode, without asking the server', () => {
    create();
    settings.setDemo(true);
    const feed = TestBed.inject(SessionsFeed);
    http.expectNone('/api/sessions');
    expect(feed.state.views().map((v) => v.sessionId)).toContain('demo-checkout');
  });

  describe('how often it asks', () => {
    const body = { sessions: [], limits: {} };
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // The shell already asks /api/status every interval, so with this list open a page makes two requests per
    // interval. The list asks half as often, which keeps a client at 30 requests a minute and not 40.
    it('asks again after twice the interval, not after one', async () => {
      create();
      TestBed.inject(SessionsFeed);
      http.expectOne('/api/sessions').flush(body);
      await vi.advanceTimersByTimeAsync(5999);
      http.expectNone('/api/sessions');
      await vi.advanceTimersByTimeAsync(1);
      http.expectOne('/api/sessions').flush(body);
    });

    it('doubles the interval the user chose in Settings too', async () => {
      create();
      settings.setPollIntervalMs(5000);
      TestBed.inject(SessionsFeed);
      http.expectOne('/api/sessions').flush(body);
      await vi.advanceTimersByTimeAsync(9999);
      http.expectNone('/api/sessions');
      await vi.advanceTimersByTimeAsync(1);
      http.expectOne('/api/sessions').flush(body);
    });

    it('calls the list stale after three of its own intervals, not three of the status poll', async () => {
      create();
      const feed = TestBed.inject(SessionsFeed);
      http.expectOne('/api/sessions').flush(body);
      expect(feed.state.status()).toBe('live');
      // The next request (at 6 s) never answers. Nine seconds is three status intervals, and must not be enough.
      await vi.advanceTimersByTimeAsync(9000);
      expect(feed.state.status()).toBe('live');
      await vi.advanceTimersByTimeAsync(9000);
      expect(feed.state.status()).not.toBe('live');
    });
  });

  it('shows a server that is down as down', () => {
    create();
    const feed = TestBed.inject(SessionsFeed);
    http.expectOne('/api/sessions').flush('', { status: 502, statusText: 'Bad Gateway' });
    expect(feed.state.status()).toBe('offline');
    expect(feed.state.views()).toEqual([]);
  });
});
