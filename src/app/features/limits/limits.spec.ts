import { TestBed } from '@angular/core/testing';
import { AgentLimits, Snapshot } from '../../core/api/models';
import { ConnectionState } from '../../core/connection-state/connection-state';
import { fakeState, snapshot } from '../../testing/fixtures';
import { Limits } from './limits';

const entry = (five: number, week: number, fiveIn = 6480, weekIn = 86400 * 4): AgentLimits => ({
  five_hour: { used_pct: five, resets_at: 1700006480, resets_in: fiveIn },
  weekly: { used_pct: week, resets_at: 1700345600, resets_in: weekIn },
});

describe('Limits', () => {
  let state: ReturnType<typeof fakeState>;

  function render() {
    state = fakeState();
    TestBed.configureTestingModule({ providers: [{ provide: ConnectionState, useValue: state }] });
    const fixture = TestBed.createComponent(Limits);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, update: () => fixture.detectChanges() };
  }

  const load = (limits: Snapshot['limits']) => state.snapshot.set(snapshot([], { limits }));
  const section = (root: HTMLElement, agent: string) =>
    Array.from(root.querySelectorAll('section.agent')).find(
      (s) => s.querySelector('h2')?.textContent === agent,
    );

  it('says it is connecting, and shows no agents, before the first response', () => {
    const { root } = render();
    expect(root.textContent).toContain('Connecting…');
    expect(root.querySelector('section.agent')).toBeNull();
  });

  it('shows a row for each known agent, with data only for those the server reported', () => {
    const { root, update } = render();
    load({ 'Claude Code': entry(72.5, 10), Codex: entry(31, 55.5) });
    update();
    expect(Array.from(root.querySelectorAll('section.agent h2')).map((h) => h.textContent)).toEqual(
      ['Claude Code', 'Codex', 'Antigravity'],
    );
    expect(section(root, 'Antigravity')?.textContent).toContain('No usage data');
    expect(section(root, 'Antigravity')?.querySelector('.bar')).toBeNull();
  });

  it('shows used and remaining quota for both windows', () => {
    const { root, update } = render();
    load({ 'Claude Code': entry(72.5, 10) });
    update();
    const claude = section(root, 'Claude Code');
    const text = (claude?.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('5 hours');
    expect(text).toContain('72.5 %');
    expect(text).toContain('27.5 % left');
    expect(text).toContain('Weekly');
    expect(text).toContain('10 %');
    expect(text).toContain('90 % left');
  });

  it('shows when it resets, as a countdown and a date', () => {
    const { root, update } = render();
    load({ Codex: entry(10, 10, 6480, 86400 * 4 + 3600 * 6) });
    update();
    const text = (section(root, 'Codex')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Resets in 1h 48m');
    expect(text).toContain('Resets in 4d 6h');
  });

  it('counts the reset down as time passes', () => {
    const { root, update } = render();
    load({ Codex: entry(10, 10, 6480) });
    state.elapsedSec.set(480);
    update();
    expect(section(root, 'Codex')?.textContent).toContain('Resets in 1h 40m');
  });

  it('says a reset is due once the countdown reaches zero', () => {
    const { root, update } = render();
    load({ Codex: entry(10, 10, 100) });
    state.elapsedSec.set(100);
    update();
    expect(section(root, 'Codex')?.textContent).toContain('Reset due. Waiting for new data.');
  });

  it('exposes each bar to screen readers with its value', () => {
    const { root, update } = render();
    load({ Codex: entry(31, 55.5) });
    update();
    const bars = Array.from(section(root, 'Codex')?.querySelectorAll('[role="progressbar"]') ?? []);
    expect(
      bars.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-valuenow')]),
    ).toEqual([
      ['Codex 5 hours usage', '31'],
      ['Codex Weekly usage', '55.5'],
    ]);
  });

  it('colours by how full it is', () => {
    const { root, update } = render();
    load({ Codex: entry(69, 70), Antigravity: entry(89, 90) });
    update();
    const levels = (agent: string) =>
      Array.from(section(root, agent)?.querySelectorAll('.pct') ?? []).map((e) =>
        e.getAttribute('data-level'),
      );
    expect(levels('Codex')).toEqual(['ok', 'warn']);
    expect(levels('Antigravity')).toEqual(['warn', 'critical']);
  });

  it('keeps the last data and says so when the server goes away', () => {
    const { root, update } = render();
    load({ Codex: entry(31, 55.5) });
    state.status.set('offline');
    update();
    expect(root.querySelector('.banner')?.textContent).toContain('Server unreachable.');
    expect(section(root, 'Codex')?.textContent).toContain('31 %');
  });

  it('shows how long ago it synced, and refreshes from the button', () => {
    const { root, update } = render();
    load({});
    state.lastSyncAt.set(1700000000000);
    state.elapsedSec.set(7);
    update();
    expect(root.querySelector('.sync-text')?.textContent).toBe('Synced 7s ago');
    const refresh = vi.spyOn(state, 'refresh');
    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
