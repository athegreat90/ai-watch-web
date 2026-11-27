import { Injectable, computed, inject, signal } from '@angular/core';
import { FocusTimer } from '../focus/focus-timer';

/**
 * Meeting mode: alerts and celebrations stay quiet and the screen is dimmed. It is on when the user
 * turns it on, and also while the focus timer runs. The idle robot is not affected, like the firmware.
 */
@Injectable({ providedIn: 'root' })
export class MeetingMode {
  private readonly focus = inject(FocusTimer);

  readonly manual = signal(false);
  readonly active = computed(() => this.manual() || this.focus.running());

  toggle(): void {
    this.manual.update((on) => !on);
  }
}
