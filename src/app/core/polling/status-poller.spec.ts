import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { RuntimeConfig } from '../config/runtime-config';
import { PAGE_VISIBLE } from './page-visibility';
import { PollEvent } from './poll';
import { StatusPoller } from './status-poller';
import { Snapshot } from '../api/models';

describe('StatusPoller', () => {
  let poller: StatusPoller;
  let http: HttpTestingController;
  let received: PollEvent<Snapshot>[];

  const body = { sessions: [], limits: {} };
  const requests = () => http.match('/api/status');
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PAGE_VISIBLE, useValue: of(true) },
        { provide: RuntimeConfig, useValue: { value: () => ({ pollIntervalMs: 5000 }) } },
      ],
    });
    poller = TestBed.inject(StatusPoller);
    http = TestBed.inject(HttpTestingController);
    received = [];
  });

  afterEach(() => vi.useRealTimers());

  it('makes one request for every subscriber', () => {
    poller.events$.subscribe((event) => received.push(event));
    poller.events$.subscribe((event) => received.push(event));
    const first = requests();
    expect(first).toHaveLength(1);
    first[0]?.flush(body);
    expect(received).toHaveLength(2);
    expect(received.every((event) => event.ok)).toBe(true);
  });

  it('waits the configured interval, not a fixed one', async () => {
    poller.events$.subscribe();
    requests()[0]?.flush(body);
    await advance(4999);
    expect(requests()).toHaveLength(0);
    await advance(1);
    expect(requests()).toHaveLength(1);
  });

  it('asks at once when refresh is called between requests', async () => {
    poller.events$.subscribe();
    requests()[0]?.flush(body);
    await advance(1000);
    poller.refresh();
    await advance(0);
    expect(requests()).toHaveLength(1);
  });

  it('stops asking when nobody listens any more', async () => {
    const subscription = poller.events$.subscribe();
    requests()[0]?.flush(body);
    subscription.unsubscribe();
    await advance(60000);
    expect(requests()).toHaveLength(0);
  });
});
