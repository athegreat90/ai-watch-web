import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SessionStatus } from '../../core/api/models';

/** The firmware's wording for each status. */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  needs_attention: 'Needs you',
  working: 'Working',
  done: 'Completed',
  error: 'Error',
  notice: 'Notification',
  idle: 'Idle',
};

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge-status" [attr.data-status]="status()">{{ label() }}</span>`,
  styles: `
    .badge-status {
      display: inline-block;
      padding: 0.0625rem 0.5rem;
      border: 1px solid currentColor;
      border-radius: 4px;
      font-size: 0.75rem;
      line-height: 1.5;
      white-space: nowrap;
      color: var(--aiw-muted);
    }
    [data-status='needs_attention'] {
      color: var(--aiw-attention);
    }
    [data-status='working'] {
      color: var(--aiw-working);
    }
    [data-status='done'] {
      color: var(--aiw-done);
    }
    [data-status='error'] {
      color: var(--aiw-error);
    }
  `,
})
export class StatusBadge {
  readonly status = input.required<SessionStatus>();
  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
