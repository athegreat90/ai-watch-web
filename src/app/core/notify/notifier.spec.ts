import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { view } from '../../testing/fixtures';
import { SettingsStore } from '../settings/settings-store';
import { Notifier } from './notifier';

describe('Notifier', () => {
  let oscillators: { frequency: { value: number } }[] = [];
  const freqs = () => oscillators.map((o) => o.frequency.value);
  let contexts: FakeAudio[];
  let shown: { title: string; options: unknown }[];
  let permission: NotificationPermission;
  let listeners: Map<string, (() => void)[]>;

  class FakeAudio {
    state: 'suspended' | 'running' = 'suspended';
    currentTime = 0;
    destination = {};
    constructor() {
      contexts.push(this);
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return { gain: { value: 0 }, connect: vi.fn() };
    }
  }

  function create(
    options: { sound?: boolean; notifications?: boolean; secure?: boolean; win?: object } = {},
  ) {
    const fakeNotification = Object.assign(
      function (this: unknown, title: string, opts: unknown) {
        shown.push({ title, options: opts });
      },
      {
        get permission() {
          return permission;
        },
        requestPermission: vi.fn(async () => permission),
      },
    );
    const win = options.win ?? {
      AudioContext: FakeAudio,
      Notification: fakeNotification,
      isSecureContext: options.secure ?? true,
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOCUMENT,
          useValue: {
            defaultView: win,
            addEventListener: (type: string, fn: () => void) =>
              listeners.set(type, [...(listeners.get(type) ?? []), fn]),
            removeEventListener: (type: string, fn: () => void) =>
              listeners.set(
                type,
                (listeners.get(type) ?? []).filter((f) => f !== fn),
              ),
          },
        },
      ],
    });
    const settings = TestBed.inject(SettingsStore);
    settings.setSound(options.sound ?? true);
    settings.setNotifications(options.notifications ?? true);
    return { notifier: TestBed.inject(Notifier), settings, fakeNotification };
  }

  const waiting = (over = {}) => view({ status: 'needs_attention', project: 'checkout', ...over });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    oscillators = [];
    contexts = [];
    shown = [];
    permission = 'granted';
    listeners = new Map();
  });

  afterEach(() => localStorage.clear());

  describe('what the browser can do', () => {
    it('can play sound and show notifications on a secure page', () => {
      const { notifier } = create();
      expect(notifier.soundSupported).toBe(true);
      expect(notifier.notificationsSupported).toBe(true);
    });

    it('cannot show notifications on a page that is not secure', () => {
      const { notifier } = create({ secure: false });
      expect(notifier.notificationsSupported).toBe(false);
      expect(notifier.notificationState()).toBe('unsupported');
    });

    it('can do neither in a browser without them', () => {
      const { notifier } = create({ win: {} });
      expect(notifier.soundSupported).toBe(false);
      expect(notifier.notificationsSupported).toBe(false);
    });
  });

  describe('the tone', () => {
    it('plays two tones when a session needs you, once the audio is ready', async () => {
      const { notifier } = create();
      await notifier.enableAudio();
      notifier.attention([waiting()]);
      expect(freqs()).toEqual([660, 880]);
    });

    it('stays silent until the user has allowed audio with a click', () => {
      const { notifier } = create();
      notifier.attention([waiting()]);
      expect(freqs()).toEqual([]);
      expect(contexts).toHaveLength(0);
    });

    it('stays silent when the user has not turned the tone on', async () => {
      const { notifier } = create({ sound: false });
      await notifier.enableAudio();
      notifier.attention([waiting()]);
      expect(freqs()).toEqual([]);
    });

    it('stays silent when the browser keeps the audio suspended', async () => {
      const { notifier } = create();
      await notifier.enableAudio();
      contexts[0]!.state = 'suspended';
      notifier.attention([waiting()]);
      expect(freqs()).toEqual([]);
    });

    it('prepares the audio once, however often it is asked', async () => {
      const { notifier } = create();
      await notifier.enableAudio();
      await notifier.enableAudio();
      expect(contexts).toHaveLength(1);
    });

    it('can play a test tone', async () => {
      const { notifier } = create();
      await notifier.enableAudio();
      notifier.testTone();
      expect(freqs()).toEqual([660, 880]);
    });

    it('also plays when the focus timer ends', async () => {
      const { notifier } = create();
      await notifier.enableAudio();
      notifier.focusComplete();
      expect(freqs()).toEqual([660, 880]);
    });

    it('does nothing in a browser without audio', async () => {
      const { notifier } = create({ win: {} });
      await expect(notifier.enableAudio()).resolves.toBeUndefined();
    });

    it('is not an error when the browser refuses the audio', async () => {
      class Refusing extends FakeAudio {
        override resume() {
          return Promise.reject(new Error('blocked'));
        }
      }
      const { notifier } = create({ win: { AudioContext: Refusing, isSecureContext: true } });
      await expect(notifier.enableAudio()).resolves.toBeUndefined();
      notifier.attention([waiting()]);
      expect(freqs()).toEqual([]);
    });

    it('is prepared by the first touch after a reload, then stops listening', () => {
      create();
      expect(listeners.get('pointerdown')).toHaveLength(1);
      listeners.get('pointerdown')?.[0]?.();
      expect(contexts).toHaveLength(1);
      expect(listeners.get('pointerdown')).toHaveLength(0);
      expect(listeners.get('keydown')).toHaveLength(0);
    });

    it('does not listen for a touch when the tone is off', () => {
      create({ sound: false });
      expect(listeners.get('pointerdown')).toBeUndefined();
    });
  });

  describe('desktop notifications', () => {
    it('shows who is waiting', () => {
      const { notifier } = create();
      notifier.attention([waiting({ agent: 'Codex' })]);
      expect(shown).toEqual([
        {
          title: 'Needs you',
          options: { body: 'checkout (Codex) is waiting for you.', tag: 'aiw-attention' },
        },
      ]);
    });

    it('says how many more are waiting', () => {
      const { notifier } = create();
      notifier.attention([waiting(), waiting({ session_id: 'b' }), waiting({ session_id: 'c' })]);
      expect((shown[0]?.options as { body: string }).body).toContain('and 2 more');
    });

    it('says the focus time is up', () => {
      const { notifier } = create();
      notifier.focusComplete();
      expect(shown[0]).toMatchObject({ title: 'Focus complete' });
    });

    it('says nothing when no session is waiting', () => {
      const { notifier } = create();
      notifier.attention([]);
      expect(shown).toEqual([]);
    });

    it('says nothing when the user has not turned it on', () => {
      const { notifier } = create({ notifications: false });
      notifier.attention([waiting()]);
      expect(shown).toEqual([]);
    });

    it.each<NotificationPermission>(['default', 'denied'])(
      'says nothing when permission is %s',
      (value) => {
        permission = value;
        const { notifier } = create();
        notifier.attention([waiting()]);
        expect(shown).toEqual([]);
      },
    );

    it('is not an error when the browser refuses to show one', () => {
      const { notifier } = create({
        win: {
          Notification: Object.assign(
            function () {
              throw new Error('only from a service worker');
            },
            { permission: 'granted', requestPermission: vi.fn() },
          ),
          isSecureContext: true,
        },
      });
      expect(() => notifier.attention([waiting()])).not.toThrow();
    });

    it('asks the browser for permission', async () => {
      permission = 'denied';
      const { notifier, fakeNotification } = create();
      await expect(notifier.requestNotifications()).resolves.toBe('denied');
      expect(fakeNotification.requestPermission).toHaveBeenCalledOnce();
    });

    it('says it is unsupported where it cannot ask', async () => {
      const { notifier } = create({ secure: false });
      await expect(notifier.requestNotifications()).resolves.toBe('unsupported');
    });

    it('gives the current permission when asking fails', async () => {
      permission = 'default';
      const { notifier, fakeNotification } = create();
      fakeNotification.requestPermission.mockRejectedValueOnce(new Error('no'));
      await expect(notifier.requestNotifications()).resolves.toBe('default');
    });
  });
});
