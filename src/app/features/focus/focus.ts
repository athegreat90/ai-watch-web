import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FocusTimer, formatClock } from '../../core/focus/focus-timer';
import { MeetingMode } from '../../core/meeting/meeting-mode';

@Component({
  selector: 'app-focus',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './focus.html',
  styleUrl: './focus.scss',
})
export class Focus {
  private readonly focus = inject(FocusTimer);
  protected readonly meeting = inject(MeetingMode);

  protected readonly phase = this.focus.phase;
  protected readonly clock = computed(() => formatClock(this.focus.remainingMs()));

  /** The firmware's labels: Pause while running, Resume when paused, otherwise Start. */
  protected readonly primaryLabel = computed(() => {
    switch (this.phase()) {
      case 'running':
        return 'Pause';
      case 'paused':
        return 'Resume';
      default:
        return 'Start';
    }
  });

  protected readonly stateText = computed(() => {
    switch (this.phase()) {
      case 'idle':
        return 'Ready for 25 minutes';
      case 'running':
        return 'Focus time';
      case 'paused':
        return 'Paused';
      case 'done':
        return 'Focus complete';
    }
  });

  protected toggle(): void {
    this.focus.toggle();
  }

  protected reset(): void {
    this.focus.reset();
  }

  protected toggleMeeting(): void {
    this.meeting.toggle();
  }
}
