import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FullscreenService } from './fullscreen';

describe('FullscreenService', () => {
  function create(over: Record<string, unknown> = {}) {
    const listeners = new Map<string, () => void>();
    const doc = {
      fullscreenElement: null as unknown,
      documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
      exitFullscreen: vi.fn().mockResolvedValue(undefined),
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      ...over,
    };
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: doc }] });
    return { service: TestBed.inject(FullscreenService), doc, listeners };
  }

  it('is supported when the browser can do it', () => {
    expect(create().service.supported).toBe(true);
  });

  it('is not supported when the browser cannot', () => {
    expect(create({ documentElement: {} }).service.supported).toBe(false);
  });

  it('enters full screen when it is not in it', async () => {
    const { service, doc } = create();
    await service.toggle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('leaves full screen when it is in it', async () => {
    const { service, doc } = create({ fullscreenElement: {} });
    await service.toggle();
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it('follows the browser when full screen starts and ends', () => {
    const { service, doc, listeners } = create();
    expect(service.active()).toBe(false);
    doc.fullscreenElement = {};
    listeners.get('fullscreenchange')?.();
    expect(service.active()).toBe(true);
    doc.fullscreenElement = null;
    listeners.get('fullscreenchange')?.();
    expect(service.active()).toBe(false);
  });

  it('is not an error when the browser refuses', async () => {
    const { service } = create({
      documentElement: { requestFullscreen: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(service.toggle()).resolves.toBeUndefined();
  });

  it('stops listening when the app closes', () => {
    const { listeners } = create();
    TestBed.resetTestingModule();
    expect(listeners.has('fullscreenchange')).toBe(false);
  });
});
