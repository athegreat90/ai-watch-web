import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SessionView } from '../../core/api/session-view';
import { AttentionService } from '../../core/attention/attention';
import { view } from '../../testing/fixtures';
import { AttentionOverlay } from './attention-overlay';

describe('AttentionOverlay', () => {
  const pending = signal<SessionView[]>([]);
  const visible = signal(false);
  const attention = { pending, visible, dismiss: vi.fn(), acknowledge: vi.fn() };

  const waiting = (over = {}) =>
    view({
      status: 'needs_attention',
      project: 'checkout',
      detail: 'Approve the migration?',
      waiting: 252,
      ...over,
    });

  function render() {
    pending.set([]);
    visible.set(false);
    attention.dismiss.mockClear();
    attention.acknowledge.mockClear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AttentionService, useValue: attention }],
    });
    const fixture = TestBed.createComponent(AttentionOverlay);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      root,
      dialog: root.querySelector('dialog') as HTMLDialogElement,
      update: () => fixture.detectChanges(),
    };
  }

  it('is closed until the alert is due', () => {
    expect(render().dialog.open).toBe(false);
  });

  it('opens when the alert is due and closes when it is not', () => {
    const { dialog, update } = render();
    pending.set([waiting()]);
    visible.set(true);
    update();
    expect(dialog.open).toBe(true);
    visible.set(false);
    update();
    expect(dialog.open).toBe(false);
  });

  it('shows who needs you, what they said and how long they have waited', () => {
    const { root, update } = render();
    pending.set([waiting()]);
    visible.set(true);
    update();
    const text = (root.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Needs you');
    expect(text).toContain('checkout');
    expect(text).toContain('Claude Code');
    expect(text).toContain('Approve the migration?');
    expect(text).toContain('Waiting 4m 12s');
  });

  it('lists every session that needs you', () => {
    const { root, update } = render();
    pending.set([
      waiting({ session_id: 'a', project: 'one' }),
      waiting({ session_id: 'b', project: 'two' }),
    ]);
    visible.set(true);
    update();
    expect(
      Array.from(root.querySelectorAll('.alert-item strong')).map((e) => e.textContent),
    ).toEqual(['one', 'two']);
  });

  it('acknowledges the session whose button you press', () => {
    const { root, update } = render();
    const second = waiting({ session_id: 'b', project: 'two' });
    pending.set([waiting({ session_id: 'a' }), second]);
    visible.set(true);
    update();
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.alert-actions button'));
    buttons[1]?.click();
    expect(attention.acknowledge).toHaveBeenCalledOnce();
    expect(attention.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'b' }));
    expect(attention.dismiss).not.toHaveBeenCalled();
  });

  it('only hides it when you dismiss, and says it will come back', () => {
    const { root, update } = render();
    pending.set([waiting()]);
    visible.set(true);
    update();
    const dismiss = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Dismiss',
    );
    dismiss?.click();
    expect(attention.dismiss).toHaveBeenCalledOnce();
    expect(attention.acknowledge).not.toHaveBeenCalled();
    expect(root.textContent).toContain('comes back in 2 minutes');
  });

  it('treats the browser closing the dialog (Escape) as a dismiss', () => {
    const { dialog } = render();
    dialog.dispatchEvent(new Event('close'));
    expect(attention.dismiss).toHaveBeenCalledOnce();
  });

  it('links to the session and hides itself when you follow the link', () => {
    const { root, update } = render();
    pending.set([waiting({ agent: 'Claude Code', session_id: 's1' })]);
    visible.set(true);
    update();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const link = root.querySelector<HTMLAnchorElement>('a');
    expect(link?.getAttribute('href')).toBe('/sessions/Claude%20Code/s1');
    link?.click();
    expect(navigate).toHaveBeenCalled();
    expect(attention.dismiss).toHaveBeenCalled();
  });

  it('is labelled for screen readers', () => {
    const { dialog } = render();
    expect(dialog.getAttribute('aria-labelledby')).toBe('alert-title');
    expect(dialog.querySelector('#alert-title')?.textContent).toBe('Needs you');
  });
});
