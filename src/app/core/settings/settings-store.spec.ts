import { TestBed } from '@angular/core/testing';
import { SettingsStore } from './settings-store';

describe('SettingsStore', () => {
  const create = () => {
    TestBed.resetTestingModule();
    return TestBed.inject(SettingsStore);
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts with nothing chosen and everything optional off', () => {
    const store = create();
    expect(store.pollIntervalMs()).toBeNull();
    expect(store.sound()).toBe(false);
    expect(store.notifications()).toBe(false);
    expect(store.demo()).toBe(false);
  });

  it('keeps the choices for the next visit', () => {
    const store = create();
    store.setPollIntervalMs(10_000);
    store.setSound(true);
    store.setNotifications(true);
    const next = create();
    expect(next.pollIntervalMs()).toBe(10_000);
    expect(next.sound()).toBe(true);
    expect(next.notifications()).toBe(true);
  });

  it('can go back to the default interval', () => {
    const store = create();
    store.setPollIntervalMs(10_000);
    store.setPollIntervalMs(null);
    expect(create().pollIntervalMs()).toBeNull();
  });

  it.each([
    [500, 1000],
    [1000, 1000],
    [2499.6, 2500],
    [60_000, 60_000],
    [120_000, 60_000],
  ])('keeps an interval of %d ms between 1 s and 60 s (%d)', (given, kept) => {
    const store = create();
    store.setPollIntervalMs(given);
    expect(store.pollIntervalMs()).toBe(kept);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['null', 'null'],
    ['a number', '7'],
    ['an interval that is too short', '{"pollIntervalMs":10}'],
    ['an interval that is too long', '{"pollIntervalMs":600000}'],
    ['an interval that is not a number', '{"pollIntervalMs":"fast"}'],
  ])('falls back to the defaults for saved data that is %s', (_name, saved) => {
    localStorage.setItem('aiw.settings', saved);
    const store = create();
    expect(store.pollIntervalMs()).toBeNull();
    expect(store.sound()).toBe(false);
  });

  it('treats only a real true as on', () => {
    localStorage.setItem('aiw.settings', '{"sound":"true","notifications":1}');
    const store = create();
    expect(store.sound()).toBe(false);
    expect(store.notifications()).toBe(false);
  });

  describe('demo mode', () => {
    it('is for this tab only, so it is not in the saved settings', () => {
      const store = create();
      store.setDemo(true);
      expect(sessionStorage.getItem('aiw.demo')).toBe('1');
      expect(localStorage.getItem('aiw.settings')).toBeNull();
    });

    it('survives a reload of the same tab', () => {
      create().setDemo(true);
      expect(create().demo()).toBe(true);
    });

    it('is off again once turned off', () => {
      const store = create();
      store.setDemo(true);
      store.setDemo(false);
      expect(create().demo()).toBe(false);
    });
  });

  describe('when the browser will not store', () => {
    it('keeps working, for this page', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      const store = create();
      expect(() => {
        store.setSound(true);
        store.setDemo(true);
      }).not.toThrow();
      expect(store.sound()).toBe(true);
      expect(store.demo()).toBe(true);
    });

    it('starts with the defaults when it will not read', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const store = create();
      expect(store.pollIntervalMs()).toBeNull();
      expect(store.demo()).toBe(false);
    });
  });
});
