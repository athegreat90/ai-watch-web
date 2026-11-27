import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

export const THEME_CHOICES = ['amoled', 'dark', 'light', 'system'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type Theme = 'amoled' | 'dark' | 'light';

/** The same key `public/theme-init.js` reads, so the page is right before the app starts. */
const KEY = 'aiw.theme';

/** The browser bar colour for each theme. */
const BROWSER_COLOR: Record<Theme, string> = {
  amoled: '#000000',
  dark: '#0f1114',
  light: '#f6f7f8',
};

function read(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    return (THEME_CHOICES as readonly string[]).includes(saved ?? '')
      ? (saved as ThemeChoice)
      : 'amoled';
  } catch {
    return 'amoled';
  }
}

/**
 * The colour theme. AMOLED (true black) is the default. "System" follows the operating system and
 * gives dark or light, never AMOLED. The choice is saved and applied to the page.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly choiceState = signal<ThemeChoice>(read());
  private readonly systemLight = signal(false);

  readonly choice = this.choiceState.asReadonly();
  readonly theme = computed<Theme>(() => {
    const choice = this.choiceState();
    return choice === 'system' ? (this.systemLight() ? 'light' : 'dark') : choice;
  });

  constructor() {
    const query = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: light)');
    if (query) {
      this.systemLight.set(query.matches);
      const onChange = (event: MediaQueryListEvent) => this.systemLight.set(event.matches);
      query.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
    }
    effect(() => this.apply(this.theme()));
  }

  set(choice: ThemeChoice): void {
    this.choiceState.set(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
  }

  private apply(theme: Theme): void {
    const root = this.doc.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-bs-theme', theme === 'light' ? 'light' : 'dark');
    this.doc
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', BROWSER_COLOR[theme]);
  }
}
