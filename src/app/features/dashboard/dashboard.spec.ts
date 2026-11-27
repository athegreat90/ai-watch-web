import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConnectionState } from '../../core/connection-state/connection-state';
import { fakeState, session, snapshot, view } from '../../testing/fixtures';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let state: ReturnType<typeof fakeState>;

  function render() {
    state = fakeState();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ConnectionState, useValue: state }],
    });
    const fixture = TestBed.createComponent(Dashboard);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const update = () => fixture.detectChanges();
    return { root, update };
  }

  const tiles = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('.tile')).map((t) => [
      t.querySelector('dt')?.textContent?.trim(),
      t.querySelector('dd')?.textContent?.trim(),
    ]);

  it('says it is connecting, and shows no counts, before the first response', () => {
    const { root } = render();
    state.status.set('connecting');
    expect(root.textContent).toContain('Connecting…');
    expect(tiles(root)).toEqual([
      ['Working', '–'],
      ['Needs you', '–'],
      ['Sessions', '–'],
    ]);
    expect(root.querySelector('.banner')).toBeNull();
  });

  it('shows the counters the server sent', () => {
    const { root, update } = render();
    state.snapshot.set(snapshot([], { active_count: 3, attention_count: 2, total_count: 9 }));
    update();
    expect(tiles(root)).toEqual([
      ['Working', '3'],
      ['Needs you', '2'],
      ['Sessions', '9'],
    ]);
    expect(root.querySelector('.tile-attention')).not.toBeNull();
  });

  it('does not highlight "Needs you" when nobody is waiting', () => {
    const { root, update } = render();
    state.snapshot.set(snapshot([], { attention_count: 0 }));
    update();
    expect(root.querySelector('.tile-attention')).toBeNull();
  });

  it('lists the sessions in the order the server sent them', () => {
    const { root, update } = render();
    const sessions = [
      session({ session_id: 'b', project: 'second', status: 'needs_attention' }),
      session({ session_id: 'a', project: 'first', status: 'working' }),
    ];
    state.snapshot.set(snapshot(sessions));
    state.views.set(sessions.map((s) => view(s)));
    update();
    const projects = Array.from(root.querySelectorAll('.row-project')).map((p) =>
      p.textContent?.trim(),
    );
    expect(projects).toEqual(['second', 'first']);
  });

  it('points to the full list when the counter covers more sessions than the dashboard shows', () => {
    const { root, update } = render();
    const sessions = [session({ session_id: 'a' }), session({ session_id: 'b' })];
    state.snapshot.set(snapshot(sessions, { total_count: 11 }));
    state.views.set(sessions.map((s) => view(s)));
    update();
    expect(root.textContent).toContain('9 more session(s).');
    expect(root.querySelector('a[href="/sessions"]')?.textContent).toContain('See all sessions');
  });

  it('does not point to the full list when everything is shown', () => {
    const { root, update } = render();
    const sessions = [session()];
    state.snapshot.set(snapshot(sessions));
    state.views.set(sessions.map((s) => view(s)));
    update();
    expect(root.querySelector('a[href="/sessions"]')).toBeNull();
  });

  it('says there are no sessions when the server lists none', () => {
    const { root, update } = render();
    state.snapshot.set(snapshot([]));
    update();
    expect(root.textContent).toContain('No active sessions.');
  });

  it('keeps showing the last data when the server goes away, and says so', () => {
    const { root, update } = render();
    const sessions = [session({ project: 'kept' })];
    state.snapshot.set(snapshot(sessions));
    state.views.set(sessions.map((s) => view(s)));
    state.lastSyncAt.set(1700000000000);
    state.status.set('offline');
    update();
    expect(root.querySelector('.row-project')?.textContent?.trim()).toBe('kept');
    expect(root.querySelector('.banner')?.textContent).toMatch(
      /Server unreachable\. Showing the last data from \d{2}:\d{2}:\d{2}\./,
    );
  });

  it('does not invent data when there is none and the server is unreachable', () => {
    const { root, update } = render();
    state.status.set('offline');
    update();
    expect(root.textContent).toContain('No data yet.');
    expect(root.querySelector('.row-project')).toBeNull();
    expect(root.querySelector('.banner')?.textContent).toContain('Server unreachable.');
  });

  it('shows how long ago it synced', () => {
    const { root, update } = render();
    state.lastSyncAt.set(1700000000000);
    state.elapsedSec.set(125);
    update();
    expect(root.querySelector('.sync-text')?.textContent).toBe('Synced 2m 05s ago');
  });

  it('shows no sync time before the first sync', () => {
    expect(render().root.querySelector('.sync-text')).toBeNull();
  });

  it('asks for a refresh from the button', () => {
    const { root } = render();
    const refresh = vi.spyOn(state, 'refresh');
    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
