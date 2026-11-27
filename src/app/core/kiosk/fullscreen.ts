import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Full screen for the kiosk. The browser only allows it after a tap or a key press. */
@Injectable({ providedIn: 'root' })
export class FullscreenService {
  private readonly doc = inject(DOCUMENT);
  private readonly state = signal(this.doc.fullscreenElement != null);

  readonly supported = typeof this.doc.documentElement?.requestFullscreen === 'function';
  readonly active = this.state.asReadonly();

  constructor() {
    const onChange = () => this.state.set(this.doc.fullscreenElement != null);
    this.doc.addEventListener('fullscreenchange', onChange);
    inject(DestroyRef).onDestroy(() => this.doc.removeEventListener('fullscreenchange', onChange));
  }

  async toggle(): Promise<void> {
    try {
      if (this.doc.fullscreenElement) await this.doc.exitFullscreen();
      else await this.doc.documentElement.requestFullscreen();
    } catch {
      // The browser refused. The button stays as it was.
    }
  }
}
