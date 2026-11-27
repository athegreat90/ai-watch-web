import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme';

describe('ThemeService', () => {
  const root = document.documentElement;
  let meta: HTMLMetaElement;
  let listener: ((event: { matches: boolean }) => void) | undefined;
  let removed: boolean;

  /** A browser whose colour scheme preference is `light` or not. */
  function systemPrefers(light: boolean | null) {
    removed = false;
    listener = undefined;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value:
        light === null
          ? undefined
          : () => ({
              matches: light,
              addEventListener: (_: string, fn: typeof listener) => (listener = fn),
              removeEventListener: () => (removed = true),
            }),
    });
  }

  function create() {
    TestBed.resetTestingModule();
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
    root.removeAttribute('data-bs-theme');
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '';
    document.head.appendChild(meta);
    systemPrefers(null);
  });

  afterEach(() => {
    meta.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const applied = () => [
    root.getAttribute('data-theme'),
    root.getAttribute('data-bs-theme'),
    meta.getAttribute('content'),
  ];

  it('is AMOLED by default, whatever the system prefers', () => {
    systemPrefers(true);
    const service = create();
    expect(service.choice()).toBe('amoled');
    expect(applied()).toEqual(['amoled', 'dark', '#000000']);
  });

  it.each([
    ['dark', ['dark', 'dark', '#0f1114']],
    ['light', ['light', 'light', '#f6f7f8']],
    ['amoled', ['amoled', 'dark', '#000000']],
  ] as const)('applies %s to the page and the browser bar', (choice, expected) => {
    const service = create();
    service.set(choice);
    TestBed.tick();
    expect(applied()).toEqual(expected);
  });

  it('saves the choice under the key the start-up script reads', () => {
    create().set('light');
    expect(localStorage.getItem('aiw.theme')).toBe('light');
  });

  it('opens with the saved choice', () => {
    localStorage.setItem('aiw.theme', 'dark');
    expect(create().choice()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it.each(['purple', '', 'AMOLED'])('ignores a saved value of "%s"', (saved) => {
    localStorage.setItem('aiw.theme', saved);
    expect(create().choice()).toBe('amoled');
  });

  describe('system', () => {
    it('is light when the system prefers light', () => {
      systemPrefers(true);
      const service = create();
      service.set('system');
      TestBed.tick();
      expect(service.theme()).toBe('light');
      expect(root.getAttribute('data-bs-theme')).toBe('light');
    });

    it('is dark, never AMOLED, when the system prefers dark', () => {
      systemPrefers(false);
      const service = create();
      service.set('system');
      TestBed.tick();
      expect(service.theme()).toBe('dark');
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('follows the system when it changes while the app is open', () => {
      systemPrefers(false);
      const service = create();
      service.set('system');
      TestBed.tick();
      listener?.({ matches: true });
      TestBed.tick();
      expect(service.theme()).toBe('light');
      expect(root.getAttribute('data-theme')).toBe('light');
    });

    it('ignores a system change when another theme is chosen', () => {
      systemPrefers(false);
      create().set('amoled');
      listener?.({ matches: true });
      TestBed.tick();
      expect(root.getAttribute('data-theme')).toBe('amoled');
    });

    it('is dark in a browser that cannot say', () => {
      const service = create();
      service.set('system');
      expect(service.theme()).toBe('dark');
    });

    it('stops listening when the app closes', () => {
      systemPrefers(false);
      create();
      TestBed.resetTestingModule();
      expect(removed).toBe(true);
    });
  });

  it('copes with a page that has no theme-color tag', () => {
    meta.remove();
    expect(() => create().set('light')).not.toThrow();
  });

  it('still works when the browser will not store or read', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const service = create();
    expect(service.choice()).toBe('amoled');
    expect(() => service.set('dark')).not.toThrow();
    expect(service.choice()).toBe('dark');
  });
});
