import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AttentionService } from '../core/attention/attention';
import { FocusTimer } from '../core/focus/focus-timer';
import { MeetingMode } from '../core/meeting/meeting-mode';
import { SettingsStore } from '../core/settings/settings-store';
import { view } from '../testing/fixtures';
import { Shell } from './shell';

describe('Shell', () => {
  const pending = signal<ReturnType<typeof view>[]>([]);
  const attention = {
    pending,
    visible: signal(false),
    dismiss: () => undefined,
    acknowledge: () => undefined,
    isAcknowledged: () => false,
  };

  function render() {
    localStorage.clear();
    pending.set([]);
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AttentionService, useValue: attention },
      ],
    });
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, update: () => fixture.detectChanges() };
  }

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('demo mode', () => {
    it('shows no banner when demo mode is off', () => {
      expect(render().root.querySelector('.demo-banner')).toBeNull();
    });

    it('says clearly that the data is example data, and how to turn it off', () => {
      const { root, update } = render();
      TestBed.inject(SettingsStore).setDemo(true);
      update();
      const banner = root.querySelector('.demo-banner');
      expect(banner?.textContent).toContain('example data, not your sessions');
      expect(banner?.getAttribute('role')).toBe('status');
      expect(banner?.querySelector('a')?.getAttribute('href')).toBe('/settings');
    });

    it('shows the connection as demo data, never as live', () => {
      const { root, update } = render();
      TestBed.inject(SettingsStore).setDemo(true);
      update();
      const chip = root.querySelector('.shell-status');
      expect(chip?.textContent?.trim()).toBe('Demo data');
      expect(chip?.getAttribute('data-status')).toBe('demo');
    });
  });

  it('links to every main page, in order', () => {
    const links = Array.from(render().root.querySelectorAll('nav a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Dashboard',
      'Sessions',
      'Limits',
      'Focus',
      'Settings',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard',
      '/sessions',
      '/limits',
      '/focus',
      '/settings',
    ]);
  });

  it('shows the connection state, starting as connecting', () => {
    const status = render().root.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe('Connecting…');
    expect(status?.getAttribute('data-status')).toBe('connecting');
  });

  it('moves focus to the main area from the skip link', () => {
    const { root } = render();
    document.body.appendChild(root);
    const skip = root.querySelector<HTMLAnchorElement>('a.visually-hidden-focusable');
    skip?.click();
    expect(document.activeElement?.id).toBe('main');
    root.remove();
  });

  describe('meeting mode', () => {
    const main = (root: HTMLElement) => root.querySelector('main');

    it('shows nothing and does not dim the page outside a meeting', () => {
      const { root } = render();
      expect(root.querySelector('.shell-meeting')).toBeNull();
      expect(main(root)?.classList.contains('dimmed')).toBe(false);
    });

    it('shows a muted Meeting badge and dims the page', () => {
      const { root, update } = render();
      TestBed.inject(MeetingMode).toggle();
      update();
      const badge = root.querySelector('.shell-meeting');
      expect(badge?.textContent?.trim()).toBe('Meeting');
      expect(badge?.getAttribute('data-attention')).toBe('false');
      expect(main(root)?.classList.contains('dimmed')).toBe(true);
    });

    it('turns the badge amber when a session needs you', () => {
      const { root, update } = render();
      TestBed.inject(MeetingMode).toggle();
      pending.set([view({ status: 'needs_attention' })]);
      update();
      expect(root.querySelector('.shell-meeting')?.getAttribute('data-attention')).toBe('true');
    });

    it('is on while the focus timer runs', () => {
      const { root, update } = render();
      TestBed.inject(FocusTimer).toggle();
      update();
      expect(root.querySelector('.shell-meeting')).not.toBeNull();
    });
  });

  describe('focus timer', () => {
    it('shows no timer until one is started', () => {
      expect(render().root.querySelector('.shell-timer')).toBeNull();
    });

    it('shows the time left, as a link to the Focus page', () => {
      const { root, update } = render();
      TestBed.inject(FocusTimer).toggle();
      update();
      const timer = root.querySelector('.shell-timer');
      expect(timer?.textContent?.trim()).toMatch(/^2[45]:\d{2}$/);
      expect(timer?.getAttribute('href')).toBe('/focus');
      expect(timer?.getAttribute('data-phase')).toBe('running');
    });

    it('keeps showing the paused time', () => {
      const { root, update } = render();
      const focus = TestBed.inject(FocusTimer);
      focus.toggle();
      focus.toggle();
      update();
      expect(root.querySelector('.shell-timer')?.getAttribute('data-phase')).toBe('paused');
    });

    it('goes away when reset', () => {
      const { root, update } = render();
      const focus = TestBed.inject(FocusTimer);
      focus.toggle();
      focus.reset();
      update();
      expect(root.querySelector('.shell-timer')).toBeNull();
    });
  });
});
