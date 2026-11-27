import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionView, formatDuration } from '../../core/api/session-view';
import { AttentionService } from '../../core/attention/attention';
import { ALERT_REPEAT_MS } from '../../core/attention/alert-timer';

/**
 * The NEEDS YOU alert. A native modal dialog, so the browser keeps focus inside it, closes it
 * with Escape, and the page behind it cannot be used until you answer.
 */
@Component({
  selector: 'app-attention-overlay',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './attention-overlay.html',
  styleUrl: './attention-overlay.scss',
})
export class AttentionOverlay {
  private readonly attention = inject(AttentionService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly pending = this.attention.pending;
  protected readonly repeatMinutes = ALERT_REPEAT_MS / 60000;

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.attention.visible()) {
        if (!element.open) {
          // Older browsers and test DOMs may lack showModal. The open attribute still shows it.
          if (typeof element.showModal === 'function') element.showModal();
          else element.setAttribute('open', '');
        }
      } else if (element.open) {
        if (typeof element.close === 'function') element.close();
        else element.removeAttribute('open');
      }
    });
  }

  protected waiting(view: SessionView): string {
    return formatDuration(view.waitingSec);
  }

  protected link(view: SessionView): string[] {
    return ['/sessions', view.agent, view.sessionId];
  }

  protected acknowledge(view: SessionView): void {
    this.attention.acknowledge(view);
  }

  protected dismiss(): void {
    this.attention.dismiss();
  }
}
