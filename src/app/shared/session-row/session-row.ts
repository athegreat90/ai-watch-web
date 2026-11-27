import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionView, activityText, formatTime } from '../../core/api/session-view';
import { StatusBadge } from '../status-badge/status-badge';

/** One session in a list. It links to the session's detail page. */
@Component({
  selector: 'app-session-row',
  imports: [RouterLink, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-row.html',
  styleUrl: './session-row.scss',
})
export class SessionRow {
  readonly view = input.required<SessionView>();

  protected readonly link = computed(() => ['/sessions', this.view().agent, this.view().sessionId]);
  protected readonly activity = computed(() => activityText(this.view()));
  protected readonly updated = computed(() => formatTime(this.view().updatedMs));
}
