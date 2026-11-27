import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UnexpectedResponseError } from './errors';
import { StatusApi } from './status-api';

describe('StatusApi', () => {
  let api: StatusApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(StatusApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const body = { sessions: [{ session_id: 's', agent: 'Codex', status: 'done' }], limits: {} };

  it('reads /api/status with a plain GET', () => {
    let result: unknown;
    api.status().subscribe((snapshot) => (result = snapshot));
    const request = http.expectOne('/api/status');
    expect(request.request.method).toBe('GET');
    request.flush(body);
    expect(result).toMatchObject({ sessions: [{ session_id: 's' }] });
  });

  it('reads /api/sessions for the full list', () => {
    api.sessions().subscribe();
    http.expectOne('/api/sessions').flush(body);
  });

  it('never sends the monitor key itself', () => {
    api.status().subscribe();
    const request = http.expectOne('/api/status');
    expect(request.request.headers.has('X-Monitor-Key')).toBe(false);
    request.flush(body);
  });

  it('fails with UnexpectedResponseError when the body is not a snapshot', () => {
    let error: unknown;
    api.status().subscribe({ error: (e: unknown) => (error = e) });
    http.expectOne('/api/status').flush({ nothing: true });
    expect(error).toBeInstanceOf(UnexpectedResponseError);
  });

  it('passes HTTP errors through for classification', () => {
    let status = 0;
    api.status().subscribe({ error: (e: { status: number }) => (status = e.status) });
    http.expectOne('/api/status').flush('no', { status: 503, statusText: 'Unavailable' });
    expect(status).toBe(503);
  });

  it('reports health from the ok flag', () => {
    const seen: boolean[] = [];
    api.health().subscribe((ok) => seen.push(ok));
    http.expectOne('/health').flush({ ok: true });
    api.health().subscribe((ok) => seen.push(ok));
    http.expectOne('/health').flush({ ok: false });
    expect(seen).toEqual([true, false]);
  });
});
