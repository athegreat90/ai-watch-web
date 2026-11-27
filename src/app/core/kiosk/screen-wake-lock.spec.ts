import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ScreenWakeLock } from './screen-wake-lock';

describe('ScreenWakeLock', () => {
  function sentinel() {
    const listeners = new Map<string, () => void>();
    return {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      fire: (type: string) => listeners.get(type)?.(),
    };
  }

  function create(navigator: unknown) {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: { navigator } } }],
    });
    return TestBed.inject(ScreenWakeLock);
  }

  it('is supported only where the browser has a wake lock', () => {
    expect(create({ wakeLock: { request: vi.fn() } }).supported).toBe(true);
  });

  it('is not supported without one, for example on a page that is not secure', () => {
    const service = create({});
    expect(service.supported).toBe(false);
  });

  it('asks the browser to keep the screen on', async () => {
    const s = sentinel();
    const request = vi.fn().mockResolvedValue(s);
    const service = create({ wakeLock: { request } });
    await service.acquire();
    expect(request).toHaveBeenCalledWith('screen');
    expect(service.held()).toBe(true);
  });

  it('does not ask twice while it holds the lock', async () => {
    const request = vi.fn().mockResolvedValue(sentinel());
    const service = create({ wakeLock: { request } });
    await service.acquire();
    await service.acquire();
    expect(request).toHaveBeenCalledOnce();
  });

  it('notices when the browser takes the lock away, and can ask again', async () => {
    const first = sentinel();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(sentinel());
    const service = create({ wakeLock: { request } });
    await service.acquire();
    first.fire('release');
    expect(service.held()).toBe(false);
    await service.acquire();
    expect(request).toHaveBeenCalledTimes(2);
    expect(service.held()).toBe(true);
  });

  it('is not an error when the browser refuses', async () => {
    const service = create({
      wakeLock: { request: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(service.acquire()).resolves.toBeUndefined();
    expect(service.held()).toBe(false);
  });

  it('does nothing where it is not supported', async () => {
    const service = create({});
    await expect(service.acquire()).resolves.toBeUndefined();
    expect(service.held()).toBe(false);
  });

  it('lets go when released', async () => {
    const s = sentinel();
    const service = create({ wakeLock: { request: vi.fn().mockResolvedValue(s) } });
    await service.acquire();
    service.release();
    expect(s.release).toHaveBeenCalledOnce();
    expect(service.held()).toBe(false);
  });

  it('can be released when it holds nothing', () => {
    expect(() => create({}).release()).not.toThrow();
  });
});
