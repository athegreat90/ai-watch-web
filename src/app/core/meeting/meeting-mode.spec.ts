import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FocusTimer } from '../focus/focus-timer';
import { MeetingMode } from './meeting-mode';

describe('MeetingMode', () => {
  const timerRunning = signal(false);
  let meeting: MeetingMode;

  beforeEach(() => {
    timerRunning.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: FocusTimer, useValue: { running: computed(() => timerRunning()) } }],
    });
    meeting = TestBed.inject(MeetingMode);
  });

  it('starts off', () => {
    expect(meeting.active()).toBe(false);
  });

  it('turns on and off by hand', () => {
    meeting.toggle();
    expect(meeting.active()).toBe(true);
    meeting.toggle();
    expect(meeting.active()).toBe(false);
  });

  it('is on while the focus timer runs, without being switched on by hand', () => {
    timerRunning.set(true);
    expect(meeting.active()).toBe(true);
    expect(meeting.manual()).toBe(false);
  });

  it('ends when the timer stops, unless it was switched on by hand', () => {
    timerRunning.set(true);
    timerRunning.set(false);
    expect(meeting.active()).toBe(false);
    meeting.toggle();
    timerRunning.set(true);
    timerRunning.set(false);
    expect(meeting.active()).toBe(true);
  });
});
