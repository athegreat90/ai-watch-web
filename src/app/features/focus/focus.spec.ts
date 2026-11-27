import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FOCUS_MS, FocusPhase, FocusTimer } from '../../core/focus/focus-timer';
import { MeetingMode } from '../../core/meeting/meeting-mode';
import { Focus } from './focus';

describe('Focus page', () => {
  const phase = signal<FocusPhase>('idle');
  const remainingMs = signal(FOCUS_MS);
  const focus = {
    phase,
    remainingMs,
    running: computed(() => phase() === 'running'),
    toggle: vi.fn(),
    reset: vi.fn(),
  };
  let meeting: MeetingMode;

  function render() {
    phase.set('idle');
    remainingMs.set(FOCUS_MS);
    focus.toggle.mockClear();
    focus.reset.mockClear();
    TestBed.configureTestingModule({ providers: [{ provide: FocusTimer, useValue: focus }] });
    meeting = TestBed.inject(MeetingMode);
    const fixture = TestBed.createComponent(Focus);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
      root,
      update: () => fixture.detectChanges(),
      primary: () => root.querySelector<HTMLButtonElement>('.buttons button:first-child'),
      reset: () => root.querySelector<HTMLButtonElement>('.buttons button:last-child'),
      checkbox: () => root.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    };
  }

  it('shows 25:00 and is ready to start', () => {
    const { root, primary } = render();
    expect(root.querySelector('.clock')?.textContent).toBe('25:00');
    expect(root.querySelector('.state')?.textContent).toBe('Ready for 25 minutes');
    expect(primary()?.textContent?.trim()).toBe('Start');
  });

  it.each<[FocusPhase, string, string]>([
    ['idle', 'Start', 'Ready for 25 minutes'],
    ['running', 'Pause', 'Focus time'],
    ['paused', 'Resume', 'Paused'],
    ['done', 'Start', 'Focus complete'],
  ])('in the %s state the button says %s and the text says "%s"', (state, label, text) => {
    const { root, primary, update } = render();
    phase.set(state);
    update();
    expect(primary()?.textContent?.trim()).toBe(label);
    expect(root.querySelector('.state')?.textContent).toBe(text);
  });

  it('shows the time that is left', () => {
    const { root, update } = render();
    phase.set('running');
    remainingMs.set(4 * 60_000 + 7000);
    update();
    expect(root.querySelector('.clock')?.textContent).toBe('04:07');
  });

  it('starts, pauses and resumes with the one button', () => {
    const { primary } = render();
    primary()?.click();
    expect(focus.toggle).toHaveBeenCalledOnce();
  });

  it('resets, but only once there is something to reset', () => {
    const { reset, update } = render();
    expect(reset()?.disabled).toBe(true);
    phase.set('paused');
    update();
    expect(reset()?.disabled).toBe(false);
    reset()?.click();
    expect(focus.reset).toHaveBeenCalledOnce();
  });

  describe('meeting mode', () => {
    it('is off at first', () => {
      const { checkbox, root } = render();
      expect(checkbox()?.checked).toBe(false);
      expect(root.querySelector('.on')).toBeNull();
    });

    it('switches on and off by hand', () => {
      const { checkbox, update, root } = render();
      checkbox()?.click();
      update();
      expect(meeting.manual()).toBe(true);
      expect(root.querySelector('.on')?.textContent).toContain('Meeting mode is on');
      checkbox()?.click();
      update();
      expect(meeting.manual()).toBe(false);
    });

    it('says it is on while the timer runs, even though the switch is off', () => {
      const { checkbox, update, root } = render();
      phase.set('running');
      update();
      expect(checkbox()?.checked).toBe(false);
      expect(root.querySelector('.on')?.textContent).toContain('Meeting mode is on');
    });
  });
});
