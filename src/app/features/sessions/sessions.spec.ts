import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fakeState, session, snapshot, view } from '../../testing/fixtures';
import { Sessions } from './sessions';
import { SessionsFeed } from './sessions-feed';

describe('Sessions', () => {
  let state: ReturnType<typeof fakeState>;

  function render() {
    state = fakeState();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionsFeed, useValue: { state } }],
    });
    const fixture = TestBed.createComponent(Sessions);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, update: () => fixture.detectChanges() };
  }

  const load = (count: number, total = count) => {
    const sessions = Array.from({ length: count }, (_, i) =>
      session({ session_id: `s${i}`, project: `p${i}` }),
    );
    state.snapshot.set(snapshot(sessions, { total_count: total }));
    state.views.set(sessions.map((s) => view(s)));
  };

  it('says it is connecting before the first response', () => {
    const { root } = render();
    state.status.set('connecting');
    expect(root.textContent).toContain('Connecting…');
  });

  it('lists every session in the server order', () => {
    const { root, update } = render();
    load(3);
    update();
    expect(
      Array.from(root.querySelectorAll('.row-project')).map((p) => p.textContent?.trim()),
    ).toEqual(['p0', 'p1', 'p2']);
    expect(root.textContent).not.toContain('not listed');
  });

  it('says when the server has more sessions than it lists', () => {
    const { root, update } = render();
    load(40, 43);
    update();
    expect(root.textContent).toContain('3 more session(s) are not listed');
  });

  it('says there are no sessions when the server lists none', () => {
    const { root, update } = render();
    state.snapshot.set(snapshot([]));
    update();
    expect(root.textContent).toContain('No active sessions.');
  });

  it('keeps the last list and a warning when the server goes away', () => {
    const { root, update } = render();
    load(2);
    state.status.set('offline');
    update();
    expect(root.querySelectorAll('.row-project')).toHaveLength(2);
    expect(root.querySelector('.banner')?.textContent).toContain('Server unreachable.');
  });

  it('asks for a refresh from the button', () => {
    const { root } = render();
    const refresh = vi.spyOn(state, 'refresh');
    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
