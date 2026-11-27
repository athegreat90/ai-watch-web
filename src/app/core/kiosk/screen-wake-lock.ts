import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/**
 * Asks the browser to keep the screen on. It only works on a secure page (HTTPS or localhost), and
 * the browser drops it when the tab is hidden, so ask again when the tab shows. A browser that
 * cannot or will not is not an error: the operating system's own setting still applies.
 */
@Injectable({ providedIn: 'root' })
export class ScreenWakeLock {
  private readonly navigator = inject(DOCUMENT).defaultView?.navigator;
  private sentinel: WakeLockSentinel | null = null;
  private readonly heldState = signal(false);

  readonly supported = this.navigator !== undefined && 'wakeLock' in this.navigator;
  readonly held = this.heldState.asReadonly();

  async acquire(): Promise<void> {
    const wakeLock = this.navigator?.wakeLock;
    if (!wakeLock || this.sentinel) return;
    try {
      const sentinel = await wakeLock.request('screen');
      this.sentinel = sentinel;
      this.heldState.set(true);
      sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.heldState.set(false);
      });
    } catch {
      this.heldState.set(false);
    }
  }

  release(): void {
    const sentinel = this.sentinel;
    this.sentinel = null;
    this.heldState.set(false);
    void sentinel?.release().catch(() => undefined);
  }
}
