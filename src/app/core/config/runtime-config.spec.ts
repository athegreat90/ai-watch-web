import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_CONFIG, RuntimeConfig, parseConfig } from './runtime-config';

describe('parseConfig', () => {
  it('reads the poll interval', () => {
    expect(parseConfig({ pollIntervalMs: 5000 })).toEqual({ pollIntervalMs: 5000 });
  });

  it('keeps the interval between 1 s and 60 s', () => {
    expect(parseConfig({ pollIntervalMs: 10 }).pollIntervalMs).toBe(1000);
    expect(parseConfig({ pollIntervalMs: 600000 }).pollIntervalMs).toBe(60000);
  });

  it.each([undefined, null, 'fast', NaN, Infinity, {}, []])('uses the default for %s', (value) => {
    expect(parseConfig({ pollIntervalMs: value })).toEqual(DEFAULT_CONFIG);
  });

  it.each([null, 'text', 7, undefined])('uses the default when the file is %s', (raw) => {
    expect(parseConfig(raw)).toEqual(DEFAULT_CONFIG);
  });
});

describe('RuntimeConfig', () => {
  let config: RuntimeConfig;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    config = TestBed.inject(RuntimeConfig);
    http = TestBed.inject(HttpTestingController);
  });

  it('starts with the defaults', () => {
    expect(config.value()).toEqual(DEFAULT_CONFIG);
  });

  it('loads /config.json', async () => {
    const loaded = config.load();
    http.expectOne('/config.json').flush({ pollIntervalMs: 4000 });
    await loaded;
    expect(config.value().pollIntervalMs).toBe(4000);
  });

  it('keeps the defaults when the file is missing', async () => {
    const loaded = config.load();
    http.expectOne('/config.json').flush('', { status: 404, statusText: 'Not Found' });
    await loaded;
    expect(config.value()).toEqual(DEFAULT_CONFIG);
  });

  it('keeps the defaults when the file is not JSON', async () => {
    const loaded = config.load();
    http.expectOne('/config.json').error(new ProgressEvent('error'));
    await loaded;
    expect(config.value()).toEqual(DEFAULT_CONFIG);
  });
});
