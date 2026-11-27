import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { SessionView } from '../api/session-view';
import { SettingsStore } from '../settings/settings-store';

export type NotificationState = NotificationPermission | 'unsupported';

/**
 * An optional tone and an optional desktop notification, both off until the user turns them on.
 * A browser only plays sound after the user has touched the page, so the audio is prepared from
 * the Settings click, or from the first touch or key after a reload. Desktop notifications need
 * the user's permission and a secure page (HTTPS or localhost).
 */
@Injectable({ providedIn: 'root' })
export class Notifier {
  private readonly settings = inject(SettingsStore);
  private readonly win = inject(DOCUMENT).defaultView;
  private audio: AudioContext | null = null;

  readonly soundSupported = typeof this.win?.AudioContext === 'function';
  readonly notificationsSupported =
    typeof this.win?.Notification === 'function' && this.win.isSecureContext === true;

  constructor() {
    // After a reload the choice is saved but the browser wants a fresh touch before it allows sound.
    const doc = inject(DOCUMENT);
    if (this.settings.sound() && this.soundSupported) {
      const unlock = () => {
        void this.enableAudio();
        for (const type of ['pointerdown', 'keydown']) doc.removeEventListener(type, unlock, true);
      };
      for (const type of ['pointerdown', 'keydown']) doc.addEventListener(type, unlock, true);
    }
  }

  /** Call it from a click or key press, so the browser allows sound afterwards. */
  async enableAudio(): Promise<void> {
    if (!this.soundSupported || !this.win) return;
    try {
      this.audio ??= new this.win.AudioContext();
      if (this.audio.state === 'suspended') await this.audio.resume();
    } catch {
      // The browser refused. The tone stays off.
    }
  }

  notificationState(): NotificationState {
    return this.notificationsSupported && this.win
      ? this.win.Notification.permission
      : 'unsupported';
  }

  /** Asks the browser for permission. Call it from a click. */
  async requestNotifications(): Promise<NotificationState> {
    if (!this.notificationsSupported || !this.win) return 'unsupported';
    try {
      return await this.win.Notification.requestPermission();
    } catch {
      return this.win.Notification.permission;
    }
  }

  /** Sessions that need you. It speaks up only when the user turned it on. */
  attention(sessions: readonly SessionView[]): void {
    const first = sessions[0];
    if (!first) return;
    const more = sessions.length > 1 ? ` and ${sessions.length - 1} more` : '';
    this.beep();
    this.show(
      'Needs you',
      `${first.project} (${first.agent})${more} is waiting for you.`,
      'aiw-attention',
    );
  }

  /** The tone only, so the user can hear what it sounds like. */
  testTone(): void {
    this.beep();
  }

  focusComplete(): void {
    this.beep();
    this.show('Focus complete', 'Your 25 minutes are up.', 'aiw-focus');
  }

  private beep(): void {
    const audio = this.audio;
    if (!this.settings.sound() || !audio || audio.state !== 'running') return;
    [660, 880].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(audio.destination);
      const start = audio.currentTime + index * 0.2;
      oscillator.start(start);
      oscillator.stop(start + 0.15);
    });
  }

  private show(title: string, body: string, tag: string): void {
    if (!this.settings.notifications() || this.notificationState() !== 'granted' || !this.win)
      return;
    try {
      new this.win.Notification(title, { body, tag });
    } catch {
      // Some browsers only allow notifications from a service worker. Nothing else to do.
    }
  }
}
