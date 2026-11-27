import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ApiErrorKind, classifyError } from '../../core/api/errors';
import { StatusApi } from '../../core/api/status-api';
import { RuntimeConfig } from '../../core/config/runtime-config';
import { Notifier, NotificationState } from '../../core/notify/notifier';
import { StatusPoller } from '../../core/polling/status-poller';
import { POLL_OPTIONS_MS, SettingsStore } from '../../core/settings/settings-store';
import { THEME_CHOICES, ThemeChoice, ThemeService } from '../../core/theme/theme';

/** Reloads the page. A token so tests can replace it. */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  providedIn: 'root',
  factory: () => {
    const win = inject(DOCUMENT).defaultView;
    return () => win?.location.reload();
  },
});

const THEME_TEXT: Record<ThemeChoice, { label: string; hint: string }> = {
  amoled: { label: 'AMOLED', hint: 'True black. The default.' },
  dark: { label: 'Dark', hint: 'Dark grey.' },
  light: { label: 'Light', hint: 'Light background.' },
  system: { label: 'System', hint: 'Follows the operating system, dark or light.' },
};

const CHECK_TEXT: Record<ApiErrorKind, string> = {
  offline: 'The server cannot be reached.',
  config: 'The proxy does not allow this request. Check its configuration.',
  'login-required': 'The dashboard asked for a login.',
  'token-rejected': 'The server refused the token.',
  unexpected: 'The server answered with something this app does not understand.',
};

interface Check {
  readonly state: 'idle' | 'running' | 'ok' | 'failed';
  readonly text: string;
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly themeService = inject(ThemeService);
  protected readonly store = inject(SettingsStore);
  protected readonly notifier = inject(Notifier);
  private readonly api = inject(StatusApi);
  private readonly config = inject(RuntimeConfig);
  private readonly poller = inject(StatusPoller);
  private readonly reloadPage = inject(RELOAD_PAGE);

  protected readonly themes = THEME_CHOICES.map((value) => ({ value, ...THEME_TEXT[value] }));

  /** The interval in use right now, and the one chosen. They differ until the page reloads. */
  protected readonly selectedMs = computed(
    () => this.store.pollIntervalMs() ?? this.config.value().pollIntervalMs,
  );
  protected readonly needsReload = computed(() => this.selectedMs() !== this.poller.intervalMs);
  protected readonly pollOptions = computed(() => {
    const values = new Set<number>([...POLL_OPTIONS_MS, this.selectedMs(), this.poller.intervalMs]);
    return [...values].sort((a, b) => a - b).map((ms) => ({ ms, label: `${ms / 1000} seconds` }));
  });

  protected readonly notificationState = signal<NotificationState>(
    this.notifier.notificationState(),
  );
  protected readonly notificationText = computed(() => {
    switch (this.notificationState()) {
      case 'unsupported':
        return 'Not available here. Desktop notifications need HTTPS or localhost.';
      case 'denied':
        return 'Blocked. Allow notifications for this site in the browser settings.';
      case 'granted':
        return 'Allowed.';
      default:
        return 'The browser will ask for permission.';
    }
  });

  protected readonly check = signal<Check>({ state: 'idle', text: '' });

  protected chooseTheme(choice: ThemeChoice): void {
    this.themeService.set(choice);
  }

  protected choosePoll(value: string): void {
    this.store.setPollIntervalMs(Number(value));
  }

  protected reload(): void {
    this.reloadPage();
  }

  protected async toggleSound(box: HTMLInputElement): Promise<void> {
    // The click lets the browser allow sound, so prepare the audio before turning it on.
    if (box.checked) await this.notifier.enableAudio();
    this.store.setSound(box.checked);
  }

  protected testTone(): void {
    this.notifier.testTone();
  }

  protected async toggleNotifications(box: HTMLInputElement): Promise<void> {
    if (!box.checked) {
      this.store.setNotifications(false);
      return;
    }
    const state = await this.notifier.requestNotifications();
    this.notificationState.set(state);
    const granted = state === 'granted';
    this.store.setNotifications(granted);
    box.checked = granted;
  }

  /** Switching reloads the page, so example data and real data are never mixed on screen. */
  protected toggleDemo(box: HTMLInputElement): void {
    this.store.setDemo(box.checked);
    this.reloadPage();
  }

  protected testConnection(): void {
    this.check.set({ state: 'running', text: 'Checking…' });
    this.api.health().subscribe({
      next: (ok) =>
        this.check.set(
          ok
            ? { state: 'ok', text: 'The server answers.' }
            : { state: 'failed', text: 'The server answered, but not as expected.' },
        ),
      error: (error: unknown) =>
        this.check.set({ state: 'failed', text: CHECK_TEXT[classifyError(error)] }),
    });
  }
}
