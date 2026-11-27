import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Celebration, CelebrationService } from '../../core/celebration/celebration';
import { CelebrationBanner } from './celebration-banner';

describe('CelebrationBanner', () => {
  const current = signal<Celebration | null>(null);
  const celebration = { current, dismiss: vi.fn() };

  function render() {
    current.set(null);
    celebration.dismiss.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: CelebrationService, useValue: celebration }],
    });
    const fixture = TestBed.createComponent(CelebrationBanner);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, update: () => fixture.detectChanges() };
  }

  it('shows nothing until a task finishes', () => {
    expect(render().root.querySelector('.celebrate')).toBeNull();
  });

  it('says the task is done, with the project and how long it took', () => {
    const { root, update } = render();
    current.set({ project: 'docs-site', agent: 'Codex', durationSec: 395 });
    update();
    expect(root.querySelector('.celebrate-title')?.textContent).toBe('Task done!');
    expect(root.querySelector('.celebrate-sub')?.textContent).toBe('docs-site · 6m 35s');
  });

  it('is a status message and is not modal, so it cannot block the alert', () => {
    const { root, update } = render();
    current.set({ project: 'p', agent: 'a', durationSec: 1 });
    update();
    expect(root.querySelector('.celebrate')?.getAttribute('role')).toBe('status');
    expect(root.querySelector('dialog')).toBeNull();
  });

  it('keeps the confetti out of the accessibility tree', () => {
    const { root, update } = render();
    current.set({ project: 'p', agent: 'a', durationSec: 1 });
    update();
    const confetti = root.querySelector('.confetti');
    expect(confetti?.getAttribute('aria-hidden')).toBe('true');
    expect(confetti?.querySelectorAll('i')).toHaveLength(14);
  });

  it('can be dismissed early', () => {
    const { root, update } = render();
    current.set({ project: 'p', agent: 'a', durationSec: 1 });
    update();
    root.querySelector('button')?.click();
    expect(celebration.dismiss).toHaveBeenCalledOnce();
  });
});
