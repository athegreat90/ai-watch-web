import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { view } from '../../testing/fixtures';
import { SessionRow } from './session-row';
import { Session } from '../../core/api/models';

describe('SessionRow', () => {
  function render(over: Partial<Session> = {}, elapsedSec = 0) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SessionRow);
    fixture.componentRef.setInput('view', view(over, elapsedSec));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows project, agent, detail, status and last update', () => {
    const text = (render().textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('shop');
    expect(text).toContain('Claude Code · running tests');
    expect(text).toContain('Working');
    expect(text).toMatch(/Updated \d{2}:\d{2}:\d{2}/);
  });

  it('shows initials for the agent', () => {
    expect(render().querySelector('.row-initials')?.textContent?.trim()).toBe('CC');
  });

  it('leaves out the separator when there is no detail', () => {
    expect(render({ detail: '' }).querySelector('.row-sub')?.textContent?.trim()).toBe(
      'Claude Code',
    );
  });

  it('links to the detail page by agent and session id, encoded', () => {
    expect(render().querySelector('a')?.getAttribute('href')).toBe('/sessions/Claude%20Code/s1');
  });

  it('says how long a running session has been running, counting on', () => {
    expect(render({ status: 'working', duration: 185 }, 5).textContent).toContain('Running 3m 10s');
  });

  it('says how long a session has been waiting for you', () => {
    expect(render({ status: 'needs_attention', waiting: 125 }).textContent).toContain(
      'Waiting 2m 05s',
    );
  });

  it('says how long a finished session took', () => {
    expect(render({ status: 'done', duration: 395 }, 60).textContent).toContain('Took 6m 35s');
  });

  it.each(['idle', 'notice', 'error'])('has no activity line for a %s session', (status) => {
    expect(render({ status }).querySelector('.row-activity')).toBeNull();
  });
});
