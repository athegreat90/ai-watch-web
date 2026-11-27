import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AttentionService } from '../../core/attention/attention';
import { fakeState, session, snapshot, view } from '../../testing/fixtures';
import { SessionDetail } from './session-detail';
import { SessionsFeed } from './sessions-feed';

describe('SessionDetail', () => {
  let state: ReturnType<typeof fakeState>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let acknowledged: ReturnType<typeof signal<boolean>>;
  const attention = { isAcknowledged: () => acknowledged(), acknowledge: vi.fn() };

  function render(agent = 'Claude Code', sessionId = 's1') {
    state = fakeState();
    acknowledged = signal(false);
    attention.acknowledge.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SessionsFeed, useValue: { state } },
        { provide: AttentionService, useValue: attention },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SessionDetail);
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('sessionId', sessionId);
    fixture.detectChanges();
    return {
      root: fixture.nativeElement as HTMLElement,
      update: async () => {
        fixture.detectChanges();
        await fixture.whenStable();
      },
    };
  }

  const load = (...sessions: ReturnType<typeof session>[]) => {
    state.snapshot.set(snapshot(sessions));
    state.views.set(sessions.map((s) => view(s)));
  };

  const facts = (root: HTMLElement) =>
    Object.fromEntries(
      Array.from(root.querySelectorAll('.facts > div')).map((f) => [
        f.querySelector('dt')?.textContent?.trim(),
        f.querySelector('dd')?.textContent?.trim(),
      ]),
    );

  it('shows the session the route names', async () => {
    const { root, update } = render();
    load(session({ project: 'shop', detail: 'running tests', duration: 185 }));
    await update();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('shop');
    expect(root.textContent).toContain('Claude Code');
    expect(root.querySelector('.detail')?.textContent).toBe('running tests');
    expect(root.querySelector('.badge-status')?.textContent?.trim()).toBe('Working');
    expect(facts(root)).toMatchObject({ 'Running for': '3m 05s', 'Session ID': 's1' });
    expect(facts(root)['Waiting']).toBeUndefined();
  });

  it('shows the waiting time only for a session that needs attention', async () => {
    const { root, update } = render();
    load(session({ status: 'needs_attention', waiting: 125 }));
    await update();
    expect(facts(root)['Waiting']).toBe('2m 05s');
  });

  it('calls the time of a finished session "Duration"', async () => {
    const { root, update } = render();
    load(session({ status: 'done', duration: 395 }));
    await update();
    expect(facts(root)).toMatchObject({ Duration: '6m 35s' });
    expect(facts(root)['Running for']).toBeUndefined();
  });

  it('tells the same session id under another agent apart', async () => {
    const { root, update } = render('Codex', 's1');
    load(
      session({ agent: 'Claude Code', project: 'not this one' }),
      session({ agent: 'Codex', project: 'this one' }),
    );
    await update();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('this one');
  });

  it('waits for the first response without going back', async () => {
    const { root, update } = render();
    await update();
    expect(root.textContent).toContain('Loading…');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes back to the list when the session is gone from the data', async () => {
    const { update } = render('Claude Code', 'gone');
    load(session({ session_id: 'other' }));
    await update();
    expect(navigate).toHaveBeenCalledWith(['/sessions'], { replaceUrl: true });
  });

  it('stays when the session is there', async () => {
    const { update } = render();
    load(session());
    await update();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('links back to the list', async () => {
    const { root, update } = render();
    await update();
    expect(root.querySelector('a.back')?.getAttribute('href')).toBe('/sessions');
  });

  describe('acknowledging', () => {
    const acknowledgeButton = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Acknowledge'),
      );

    it('offers Acknowledge for a session that needs you', async () => {
      const { root, update } = render();
      load(session({ status: 'needs_attention' }));
      await update();
      acknowledgeButton(root)?.click();
      expect(attention.acknowledge).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's1' }),
      );
    });

    it('says so, and drops the button, once it is acknowledged', async () => {
      const { root, update } = render();
      load(session({ status: 'needs_attention' }));
      acknowledged.set(true);
      await update();
      expect(acknowledgeButton(root)).toBeUndefined();
      expect(root.querySelector('.ack')?.textContent).toContain('Acknowledged');
    });

    it.each(['working', 'done', 'error', 'idle', 'notice'])(
      'offers nothing to acknowledge for a %s session',
      async (status) => {
        const { root, update } = render();
        load(session({ status }));
        await update();
        expect(acknowledgeButton(root)).toBeUndefined();
        expect(root.querySelector('.ack')).toBeNull();
      },
    );
  });
});
