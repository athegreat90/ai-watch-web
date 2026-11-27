import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ConnectionState } from '../../core/connection-state/connection-state';
import { FullscreenService } from '../../core/kiosk/fullscreen';
import { ScreenWakeLock } from '../../core/kiosk/screen-wake-lock';
import { MeetingMode } from '../../core/meeting/meeting-mode';
import { PAGE_VISIBLE } from '../../core/polling/page-visibility';
import { Clock } from '../../core/time/clock';
import { AttentionOverlay } from '../../shared/attention-overlay/attention-overlay';
import { CelebrationBanner } from '../../shared/celebration-banner/celebration-banner';
import { IdleRobot } from '../../shared/idle-robot/idle-robot';
import { fakeState, session, snapshot, view } from '../../testing/fixtures';
import { CURSOR_HIDE_MS, KIOSK_MAX_ROWS, Kiosk } from './kiosk';

describe('Kiosk', () => {
  let state: ReturnType<typeof fakeState>;
  let visible$: BehaviorSubject<boolean>;
  const tick = signal(0);
  const fullscreen = { supported: true, active: signal(false), toggle: vi.fn() };
  const wakeLock = { supported: true, held: signal(false), acquire: vi.fn(), release: vi.fn() };
  const meetingActive = signal(false);

  function render(options: { fullscreen?: boolean; wake?: boolean } = {}) {
    state = fakeState();
    visible$ = new BehaviorSubject(true);
    tick.set(0);
    fullscreen.supported = options.fullscreen ?? true;
    fullscreen.active.set(false);
    fullscreen.toggle.mockClear();
    wakeLock.supported = options.wake ?? true;
    wakeLock.held.set(false);
    wakeLock.acquire.mockClear();
    wakeLock.release.mockClear();
    meetingActive.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ConnectionState, useValue: state },
        { provide: Clock, useValue: { tick, monotonic: () => 0 } },
        { provide: FullscreenService, useValue: fullscreen },
        { provide: ScreenWakeLock, useValue: wakeLock },
        { provide: MeetingMode, useValue: { active: meetingActive } },
        { provide: PAGE_VISIBLE, useValue: visible$ },
      ],
    });
    // The overlays have their own tests. Here they are left out.
    TestBed.overrideComponent(Kiosk, {
      remove: { imports: [AttentionOverlay, CelebrationBanner, IdleRobot] },
      add: { schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(Kiosk);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { fixture, root, update: () => fixture.detectChanges() };
  }

  const load = (count: number, total = count) => {
    const sessions = Array.from({ length: count }, (_, i) =>
      session({
        session_id: `s${i}`,
        project: `p${i}`,
        status: i === 0 ? 'needs_attention' : 'working',
      }),
    );
    state.snapshot.set(
      snapshot(sessions, { total_count: total, attention_count: 1, active_count: count - 1 }),
    );
    state.views.set(sessions.map((s) => view(s)));
  };

  const counts = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('.k-counts div')).map((d) => [
      d.querySelector('dt')?.textContent?.trim(),
      d.querySelector('dd')?.textContent?.trim(),
    ]);

  afterEach(() => vi.useRealTimers());

  describe('what it shows', () => {
    it('says it is connecting and shows no counts before the first response', () => {
      const { root } = render();
      state.status.set('connecting');
      expect(root.textContent).toContain('Connecting…');
      expect(counts(root)).toEqual([
        ['Working', '–'],
        ['Needs you', '–'],
        ['Sessions', '–'],
      ]);
    });

    it('shows the counters the server sent, with "Needs you" lit when someone is waiting', () => {
      const { root, update } = render();
      load(3);
      update();
      expect(counts(root)).toEqual([
        ['Working', '2'],
        ['Needs you', '1'],
        ['Sessions', '3'],
      ]);
      expect(root.querySelector('.k-attention dt')?.textContent).toContain('Needs you');
    });

    it('lists each session with its agent, status and what it is doing', () => {
      const { root, update } = render();
      load(2);
      update();
      const row = (index: number) => {
        const element = root.querySelectorAll('.k-row')[index];
        return [
          element?.querySelector('.k-project')?.textContent,
          element?.querySelector('.k-agent')?.textContent,
          element?.querySelector('.badge-status')?.textContent?.trim(),
          element?.querySelector('.k-activity')?.textContent,
        ];
      };
      expect(row(0)).toEqual(['p0', 'Claude Code', 'Needs you', 'Waiting 0s']);
      expect(row(1)).toEqual(['p1', 'Claude Code', 'Working', 'Running 1m 40s']);
    });

    it(`shows at most ${KIOSK_MAX_ROWS} sessions so nothing scrolls, and says how many more`, () => {
      const { root, update } = render();
      load(9);
      update();
      expect(root.querySelectorAll('.k-row')).toHaveLength(KIOSK_MAX_ROWS);
      expect(root.textContent).toContain('+ 3 more');
    });

    it('says there are no sessions when the server lists none', () => {
      const { root, update } = render();
      state.snapshot.set(snapshot([]));
      update();
      expect(root.textContent).toContain('No active sessions.');
    });

    it('shows usage bars for the agents that have data, and none for the others', () => {
      const { root, update } = render();
      state.snapshot.set(
        snapshot([], {
          limits: {
            Codex: {
              five_hour: { used_pct: 93, resets_at: 1, resets_in: 600 },
              weekly: { used_pct: 55.5, resets_at: 1, resets_in: 86400 },
            },
          },
        }),
      );
      update();
      const agents = Array.from(root.querySelectorAll('.k-limit-agent')).map((a) => a.textContent);
      expect(agents).toEqual(['Codex']);
      const texts = (selector: string) =>
        Array.from(root.querySelectorAll(selector)).map((e) => e.textContent);
      expect(texts('.k-bar-label')).toEqual(['5h', '7d']);
      expect(texts('.k-pct')).toEqual(['93%', '55.5%']);
      expect(root.querySelector('.k-pct[data-level="critical"]')).not.toBeNull();
    });

    it('says there is no usage data when there is none', () => {
      const { root, update } = render();
      state.snapshot.set(snapshot([]));
      update();
      expect(root.textContent).toContain('No usage data.');
    });

    it('shows the connection state and warns when it is not healthy', () => {
      const { root, update } = render();
      state.status.set('offline');
      update();
      expect(root.querySelector('.k-status')?.textContent?.trim()).toBe('Offline');
      expect(root.querySelector('.banner')?.textContent).toContain('Server unreachable.');
    });

    it('shows a Meeting label during a meeting', () => {
      const { root, update } = render();
      expect(root.textContent).not.toContain('Meeting');
      meetingActive.set(true);
      update();
      expect(root.textContent).toContain('Meeting');
    });
  });

  describe('controls', () => {
    const buttons = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLElement>('.k-button'));

    it('offers full screen, and toggles it', () => {
      const { root, update } = render();
      const button = buttons(root)[0];
      expect(button?.textContent?.trim()).toBe('Full screen');
      button?.click();
      expect(fullscreen.toggle).toHaveBeenCalledOnce();
      fullscreen.active.set(true);
      update();
      expect(buttons(root)[0]?.textContent?.trim()).toBe('Exit full screen');
    });

    it('leaves the full screen button out when the browser cannot', () => {
      const { root } = render({ fullscreen: false });
      expect(buttons(root).map((b) => b.textContent?.trim())).toEqual(['Close kiosk']);
    });

    it('links back to the dashboard', () => {
      const { root } = render();
      expect(root.querySelector('a.k-button')?.getAttribute('href')).toBe('/dashboard');
    });

    it('keeps every button at least 48 px tall', () => {
      const { root } = render();
      for (const button of buttons(root)) expect(button.classList.contains('k-button')).toBe(true);
    });
  });

  describe('screen on', () => {
    it('says so when the screen is held on', () => {
      const { root, update } = render();
      wakeLock.held.set(true);
      update();
      expect(root.querySelector('.k-foot')?.textContent).toContain('stays on');
    });

    it('says the browser has not allowed it', () => {
      const { root } = render();
      expect(root.querySelector('.k-foot')?.textContent).toContain('may turn off');
    });

    it('explains how to keep the screen on when the browser cannot', () => {
      const { root } = render({ wake: false });
      expect(root.querySelector('.k-foot')?.textContent).toMatch(/HTTPS or localhost/);
    });

    it('asks for it when the page shows, and again every time it shows', () => {
      render();
      expect(wakeLock.acquire).toHaveBeenCalledTimes(1);
      visible$.next(false);
      expect(wakeLock.acquire).toHaveBeenCalledTimes(1);
      visible$.next(true);
      expect(wakeLock.acquire).toHaveBeenCalledTimes(2);
    });

    it('lets go when the kiosk closes', () => {
      const { fixture } = render();
      fixture.destroy();
      expect(wakeLock.release).toHaveBeenCalledOnce();
    });
  });

  describe('burn-in care', () => {
    it('moves the picture a few pixels every minute', () => {
      const { root, update } = render();
      // jsdom writes translate(0px, 0px) as translate(0px), so read the numbers, not the text.
      const offset = () => {
        const text = (root.querySelector('.kiosk') as HTMLElement).style.transform;
        const [x = 0, y = 0] = (text.match(/-?\d+/g) ?? []).map(Number);
        return [x, y];
      };
      expect(offset()).toEqual([0, 0]);
      tick.set(60_000);
      update();
      expect(offset()).toEqual([3, 0]);
      tick.set(120_000);
      update();
      expect(offset()).toEqual([3, 3]);
    });

    it('hides the pointer after a few seconds, and brings it back when it moves', async () => {
      vi.useFakeTimers();
      const { root, update } = render();
      const kiosk = root.querySelector('.kiosk');
      await vi.advanceTimersByTimeAsync(CURSOR_HIDE_MS - 1);
      update();
      expect(kiosk?.classList.contains('cursor-hidden')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      update();
      expect(kiosk?.classList.contains('cursor-hidden')).toBe(true);
      document.dispatchEvent(new Event('pointermove'));
      update();
      expect(kiosk?.classList.contains('cursor-hidden')).toBe(false);
    });
  });
});
