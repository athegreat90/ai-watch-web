import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IdleService } from '../../core/idle/idle';

/**
 * The screensaver: a small robot on black that moves to another corner every 30 seconds. Any touch,
 * key or mouse move wakes the screen. With reduced motion it keeps its place and does not blink.
 */
@Component({
  selector: 'app-idle-robot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './idle-robot.html',
  styleUrl: './idle-robot.scss',
})
export class IdleRobot {
  protected readonly idle = inject(IdleService);
}
