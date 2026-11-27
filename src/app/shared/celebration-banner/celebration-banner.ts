import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { formatDuration } from '../../core/api/session-view';
import { CelebrationService } from '../../core/celebration/celebration';

/**
 * "Task done!" for a few seconds. It is not modal, so it never blocks the NEEDS YOU alert. With
 * reduced motion it is the same message without the confetti animation.
 */
@Component({
  selector: 'app-celebration-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './celebration-banner.html',
  styleUrl: './celebration-banner.scss',
})
export class CelebrationBanner {
  private readonly celebration = inject(CelebrationService);

  protected readonly current = this.celebration.current;
  protected readonly confetti = Array.from({ length: 14 }, (_, i) => i);

  protected readonly summary = computed(() => {
    const current = this.current();
    return current ? `${current.project} · ${formatDuration(current.durationSec)}` : '';
  });

  protected dismiss(): void {
    this.celebration.dismiss();
  }
}
