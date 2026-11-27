import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { StatusApi } from '../../core/api/status-api';
import { RuntimeConfig } from '../../core/config/runtime-config';
import { Notifier } from '../../core/notify/notifier';
import { StatusPoller } from '../../core/polling/status-poller';
import { SettingsStore } from '../../core/settings/settings-store';
import { ThemeService } from '../../core/theme/theme';
import { RELOAD_PAGE, Settings } from './settings';

describe('Settings page', () => {
  const reload = vi.fn();
  const notifier = {
    soundSupported: true,
    notificationsSupported: true,
    notificationState: vi.fn(() => 'default'),
    enableAudio: vi.fn(async () => undefined),
    requestNotifications: vi.fn(async () => 'granted'),
    testTone: vi.fn(),
  };
  let health: () => unknown;
  let runningInterval: number;

  function render(
    options: {
      configMs?: number;
      running?: number;
      sound?: boolean;
      notifications?: boolean;
    } = {},
  ) {
    localStorage.clear();
    sessionStorage.clear();
    reload.mockClear();
    notifier.soundSupported = options.sound ?? true;
    notifier.notificationsSupported = options.notifications ?? true;
    notifier.notificationState.mockReturnValue(
      options.notifications === false ? 'unsupported' : 'default',
    );
    notifier.enableAudio.mockClear();
    notifier.requestNotifications.mockClear();
    notifier.requestNotifications.mockResolvedValue('granted');
    notifier.testTone.mockClear();
    health = () => of(true);
    runningInterval = options.running ?? options.configMs ?? 3000;
    TestBed.configureTestingModule({
      providers: [
        { provide: Notifier, useValue: notifier },
        { provide: StatusApi, useValue: { health: () => health() } },
        {
          provide: RuntimeConfig,
          useValue: { value: () => ({ pollIntervalMs: options.configMs ?? 3000 }) },
        },
        { provide: StatusPoller, useValue: { intervalMs: runningInterval } },
        { provide: RELOAD_PAGE, useValue: reload },
      ],
    });
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      root,
      update: async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
      },
      store: TestBed.inject(SettingsStore),
      theme: TestBed.inject(ThemeService),
      select: (selector: string) => root.querySelector<HTMLInputElement>(selector),
    };
  }

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  const byLabel = (root: HTMLElement, text: string) =>
    Array.from(root.querySelectorAll<HTMLInputElement>('label.choice'))
      .find((l) => l.textContent?.includes(text))
      ?.querySelector('input') as HTMLInputElement;

  describe('structure for assistive technology', () => {
    it('groups the settings, each group with a legend', () => {
      const { root } = render();
      expect(
        Array.from(root.querySelectorAll('fieldset legend')).map((l) => l.textContent),
      ).toEqual(['Appearance', 'Connection', 'Alerts', 'Demo mode']);
    });

    it('gives every control a label', () => {
      const { root } = render();
      const controls = root.querySelectorAll('input, select');
      expect(controls.length).toBeGreaterThan(5);
      for (const control of Array.from(controls)) {
        const labelled =
          control.closest('label') !== null ||
          (control.id !== '' && root.querySelector(`label[for="${control.id}"]`) !== null);
        expect(labelled, control.outerHTML).toBe(true);
      }
    });
  });

  describe('appearance', () => {
    it('offers the four themes, with AMOLED chosen first', () => {
      const { root } = render();
      const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="theme"]'));
      expect(radios.map((r) => r.value)).toEqual(['amoled', 'dark', 'light', 'system']);
      expect(radios.map((r) => r.checked)).toEqual([true, false, false, false]);
    });

    it('changes the theme when one is chosen', async () => {
      const { root, theme, update } = render();
      root.querySelector<HTMLInputElement>('input[value="light"]')?.click();
      await update();
      expect(theme.choice()).toBe('light');
      expect(root.querySelector<HTMLInputElement>('input[value="light"]')?.checked).toBe(true);
    });
  });

  describe('update interval', () => {
    it('shows the interval in use, from the options', () => {
      const { select } = render();
      const poll = select('#poll') as unknown as HTMLSelectElement;
      expect(Array.from(poll.options).map((o) => o.textContent?.trim())).toEqual([
        '2 seconds',
        '3 seconds',
        '5 seconds',
        '10 seconds',
        '30 seconds',
        '60 seconds',
      ]);
      expect(poll.value).toBe('3000');
    });

    it('adds a deployment default that is not one of the options', () => {
      const { select } = render({ configMs: 1500 });
      const poll = select('#poll') as unknown as HTMLSelectElement;
      expect(poll.value).toBe('1500');
      expect(Array.from(poll.options).map((o) => o.value)).toContain('1500');
    });

    it('saves the choice and asks for a reload, because the running poll keeps its interval', async () => {
      const { root, store, update, select } = render();
      expect(root.textContent).not.toContain('Reload to apply');
      const poll = select('#poll') as unknown as HTMLSelectElement;
      poll.value = '10000';
      poll.dispatchEvent(new Event('change'));
      await update();
      expect(store.pollIntervalMs()).toBe(10_000);
      expect(root.textContent).toContain('Reload to apply');
    });

    it('reloads from the button', async () => {
      const { root, update, select } = render();
      const poll = select('#poll') as unknown as HTMLSelectElement;
      poll.value = '5000';
      poll.dispatchEvent(new Event('change'));
      await update();
      Array.from(root.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Reload to apply'))
        ?.click();
      expect(reload).toHaveBeenCalledOnce();
    });

    it('does not ask for a reload when the choice is what is already running', async () => {
      const { root, update, select } = render({ running: 10_000 });
      const poll = select('#poll') as unknown as HTMLSelectElement;
      poll.value = '10000';
      poll.dispatchEvent(new Event('change'));
      await update();
      expect(root.textContent).not.toContain('Reload to apply');
    });
  });

  describe('test connection', () => {
    const run = async (page: ReturnType<typeof render>) => {
      Array.from(page.root.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Test connection'))
        ?.click();
      await page.update();
      const result = page.root.querySelector('.result');
      return [result?.textContent?.trim(), result?.getAttribute('data-state')];
    };

    it('says the server answers', async () => {
      expect(await run(render())).toEqual(['The server answers.', 'ok']);
    });

    it('says when it answers but not as expected', async () => {
      const page = render();
      health = () => of(false);
      expect(await run(page)).toEqual(['The server answered, but not as expected.', 'failed']);
    });

    it.each([
      [503, 'The server cannot be reached.'],
      [0, 'The server cannot be reached.'],
      [404, 'The proxy does not allow this request. Check its configuration.'],
      [401, 'The dashboard asked for a login.'],
    ])('explains a failure with status %d', async (status, text) => {
      const page = render();
      health = () => throwError(() => new HttpErrorResponse({ status }));
      expect(await run(page)).toEqual([text, 'failed']);
    });

    it('says it is checking while it waits', async () => {
      const page = render();
      const pending = new Subject<boolean>();
      health = () => pending;
      expect(await run(page)).toEqual(['Checking…', 'running']);
      pending.next(true);
      await page.update();
      expect(page.root.querySelector('.result')?.textContent?.trim()).toBe('The server answers.');
    });

    it('says nothing before it is used', () => {
      expect(render().root.querySelector('.result')?.textContent?.trim()).toBe('');
    });
  });

  describe('tone', () => {
    it('is off at first, with no test button', () => {
      const { root } = render();
      expect(byLabel(root, 'Play a tone').checked).toBe(false);
      expect(root.textContent).not.toContain('Play a test tone');
    });

    it('prepares the audio before turning on, since the click is what allows it', async () => {
      const { root, store, update } = render();
      byLabel(root, 'Play a tone').click();
      await update();
      expect(notifier.enableAudio).toHaveBeenCalledOnce();
      expect(store.sound()).toBe(true);
      expect(root.textContent).toContain('Play a test tone');
    });

    it('plays a test tone', async () => {
      const { root, update } = render();
      byLabel(root, 'Play a tone').click();
      await update();
      Array.from(root.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('Play a test tone'))
        ?.click();
      expect(notifier.testTone).toHaveBeenCalledOnce();
    });

    it('turns off without preparing anything', async () => {
      const { root, store, update } = render();
      store.setSound(true);
      await update();
      notifier.enableAudio.mockClear();
      byLabel(root, 'Play a tone').click();
      await update();
      expect(store.sound()).toBe(false);
      expect(notifier.enableAudio).not.toHaveBeenCalled();
    });

    it('is disabled, and says why, in a browser that cannot play sound', () => {
      const { root } = render({ sound: false });
      expect(byLabel(root, 'Play a tone').disabled).toBe(true);
      expect(root.textContent).toContain('This browser cannot play sound.');
    });
  });

  describe('desktop notifications', () => {
    it('says the browser will ask, at first', () => {
      const { root } = render();
      expect(root.textContent).toContain('The browser will ask for permission.');
    });

    it('is disabled, and says why, where the browser cannot show them', () => {
      const { root } = render({ notifications: false });
      expect(byLabel(root, 'Desktop notifications').disabled).toBe(true);
      expect(root.textContent).toContain('need HTTPS or localhost');
    });

    it('turns on once the browser allows it', async () => {
      const { root, store, update } = render();
      byLabel(root, 'Desktop notifications').click();
      await update();
      expect(notifier.requestNotifications).toHaveBeenCalledOnce();
      expect(store.notifications()).toBe(true);
      expect(root.textContent).toContain('Allowed.');
    });

    it('stays off, unchecked, and says why, when the browser says no', async () => {
      const { root, store, update } = render();
      notifier.requestNotifications.mockResolvedValue('denied');
      byLabel(root, 'Desktop notifications').click();
      await update();
      expect(store.notifications()).toBe(false);
      expect(byLabel(root, 'Desktop notifications').checked).toBe(false);
      expect(root.textContent).toContain('Blocked.');
    });

    it('turns off without asking the browser', async () => {
      const { root, store, update } = render();
      store.setNotifications(true);
      await update();
      byLabel(root, 'Desktop notifications').click();
      await update();
      expect(store.notifications()).toBe(false);
      expect(notifier.requestNotifications).not.toHaveBeenCalled();
    });
  });

  describe('demo mode', () => {
    it('is off at first', () => {
      expect(byLabel(render().root, 'Show example data').checked).toBe(false);
    });

    it('turns on and reloads, so example and real data never mix', async () => {
      const { root, store, update } = render();
      byLabel(root, 'Show example data').click();
      await update();
      expect(store.demo()).toBe(true);
      expect(reload).toHaveBeenCalledOnce();
    });

    it('turns off and reloads', async () => {
      const { root, store, update } = render();
      store.setDemo(true);
      await update();
      byLabel(root, 'Show example data').click();
      await update();
      expect(store.demo()).toBe(false);
      expect(reload).toHaveBeenCalledOnce();
    });
  });
});
