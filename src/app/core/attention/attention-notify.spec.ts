import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionView } from '../api/session-view';
import { ConnectionState } from '../connection-state/connection-state';
import { MeetingMode } from '../meeting/meeting-mode';
import { Notifier } from '../notify/notifier';
import { Clock } from '../time/clock';
import { view } from '../../testing/fixtures';
import { AttentionService } from './attention';

describe('AttentionService and the tone', () => {
  let views: WritableSignal<SessionView[]>;
  let service: AttentionService;
  let now: number;
  const tick = signal(0);
  const notifier = { attention: vi.fn(), focusComplete: vi.fn() };

  const needs = (id = 'a', updated = 1700000000) =>
    view({ session_id: id, status: 'needs_attention', updated });

  function setup() {
    sessionStorage.clear();
    localStorage.clear();
    notifier.attention.mockClear();
    now = 0;
    tick.set(0);
    views = signal<SessionView[]>([]);
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectionState, useValue: { views } },
        { provide: Clock, useValue: { tick, monotonic: () => now, wallNow: () => 0 } },
        { provide: Notifier, useValue: notifier },
      ],
    });
    service = TestBed.inject(AttentionService);
    TestBed.tick();
  }

  const advance = (ms: number) => {
    now += ms;
    tick.set(now);
    TestBed.tick();
  };

  const show = (...list: SessionView[]) => {
    views.set(list);
    TestBed.tick();
  };

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('speaks up once when the alert comes up, with the sessions that need you', () => {
    setup();
    show(needs('a'), needs('b'));
    expect(notifier.attention).toHaveBeenCalledOnce();
    expect(notifier.attention.mock.calls[0]?.[0].map((v: SessionView) => v.sessionId)).toEqual([
      'a',
      'b',
    ]);
  });

  it('stays quiet when nothing needs you', () => {
    setup();
    show(view({ status: 'working' }));
    expect(notifier.attention).not.toHaveBeenCalled();
  });

  it('does not repeat while the alert is on screen, however often the data arrives', () => {
    setup();
    show(needs());
    for (let second = 0; second < 300; second++) {
      views.set([needs()]);
      advance(1000);
    }
    expect(notifier.attention).toHaveBeenCalledOnce();
  });

  it('speaks up again at the two-minute reminder after the alert was dismissed', () => {
    setup();
    show(needs());
    service.dismiss();
    TestBed.tick();
    advance(119_000);
    expect(notifier.attention).toHaveBeenCalledTimes(1);
    advance(1000);
    expect(notifier.attention).toHaveBeenCalledTimes(2);
  });

  it('speaks up for a second session at once', () => {
    setup();
    show(needs('a'));
    service.dismiss();
    TestBed.tick();
    show(needs('a'), needs('b'));
    expect(notifier.attention).toHaveBeenCalledTimes(2);
  });

  it('stays quiet in a meeting, and speaks up when the meeting ends', () => {
    setup();
    const meeting = TestBed.inject(MeetingMode);
    meeting.manual.set(true);
    show(needs());
    advance(300_000);
    expect(notifier.attention).not.toHaveBeenCalled();
    meeting.manual.set(false);
    TestBed.tick();
    expect(notifier.attention).toHaveBeenCalledOnce();
  });

  it('stays quiet for a session you acknowledged', () => {
    setup();
    service.acknowledge(needs());
    show(needs());
    expect(notifier.attention).not.toHaveBeenCalled();
  });
});
