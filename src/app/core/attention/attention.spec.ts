import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionView } from '../api/session-view';
import { ConnectionState } from '../connection-state/connection-state';
import { MeetingMode } from '../meeting/meeting-mode';
import { Clock } from '../time/clock';
import { view } from '../../testing/fixtures';
import { AttentionService, ackKey } from './attention';

describe('AttentionService', () => {
  let views: WritableSignal<SessionView[]>;
  let service: AttentionService;
  let meeting: MeetingMode;
  let now: number;
  const tick = signal(0);

  const needs = (id = 'a', updated = 1700000000) =>
    view({ session_id: id, status: 'needs_attention', updated, waiting: 30 });

  function setup(savedAcks?: unknown) {
    sessionStorage.clear();
    if (savedAcks !== undefined) sessionStorage.setItem('aiw.acks', JSON.stringify(savedAcks));
    now = 0;
    tick.set(0);
    views = signal<SessionView[]>([]);
    TestBed.configureTestingModule({
      providers: [
        { provide: ConnectionState, useValue: { views } },
        { provide: Clock, useValue: { tick, monotonic: () => now, wallNow: () => 0 } },
      ],
    });
    service = TestBed.inject(AttentionService);
    meeting = TestBed.inject(MeetingMode);
    TestBed.tick();
  }

  /** Moves the clock on and lets the service look again. */
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
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('is quiet when nothing needs you', () => {
    setup();
    show(view({ status: 'working' }), view({ session_id: 'x', status: 'done' }));
    expect(service.visible()).toBe(false);
    expect(service.pending()).toEqual([]);
  });

  it('shows the alert as soon as a session needs you', () => {
    setup();
    show(needs());
    expect(service.visible()).toBe(true);
    expect(service.pending().map((v) => v.sessionId)).toEqual(['a']);
  });

  it('lists every session that needs you, in the server order', () => {
    setup();
    show(needs('b'), needs('a'));
    expect(service.pending().map((v) => v.sessionId)).toEqual(['b', 'a']);
  });

  it('hides when dismissed, and comes back after two minutes', () => {
    setup();
    show(needs());
    service.dismiss();
    TestBed.tick();
    expect(service.visible()).toBe(false);
    advance(119_000);
    expect(service.visible()).toBe(false);
    advance(1000);
    expect(service.visible()).toBe(true);
  });

  it('does not come back sooner because the same data arrives again and again', () => {
    setup();
    show(needs());
    service.dismiss();
    for (let second = 0; second < 100; second++) {
      views.set([needs()]);
      advance(1000);
    }
    expect(service.visible()).toBe(false);
  });

  it('stops for good when you acknowledge, however long you wait', () => {
    setup();
    show(needs());
    service.acknowledge(needs());
    TestBed.tick();
    expect(service.pending()).toEqual([]);
    expect(service.visible()).toBe(false);
    advance(600_000);
    expect(service.visible()).toBe(false);
  });

  it('asks again at once when an acknowledged session sends a new event', () => {
    setup();
    show(needs('a', 1700000000));
    service.acknowledge(needs('a', 1700000000));
    TestBed.tick();
    show(needs('a', 1700000050));
    expect(service.visible()).toBe(true);
  });

  it('opens at once for a second session, even when the first was dismissed', () => {
    setup();
    show(needs('a'));
    service.dismiss();
    TestBed.tick();
    show(needs('a'), needs('b'));
    expect(service.visible()).toBe(true);
  });

  it('does not reopen for the same session when only its details change', () => {
    setup();
    show(needs('a', 1700000000));
    service.dismiss();
    TestBed.tick();
    show(needs('a', 1700000010));
    expect(service.visible()).toBe(false);
  });

  it('closes when the last session stops needing you', () => {
    setup();
    show(needs());
    show(view({ status: 'working' }));
    expect(service.visible()).toBe(false);
  });

  it('fires at once when attention returns after it cleared', () => {
    setup();
    show(needs());
    service.dismiss();
    TestBed.tick();
    show();
    advance(10_000);
    show(needs());
    expect(service.visible()).toBe(true);
  });

  it('stays quiet in a meeting, and speaks up at once when the meeting ends', () => {
    setup();
    meeting.manual.set(true);
    show(needs());
    advance(300_000);
    expect(service.visible()).toBe(false);
    meeting.manual.set(false);
    TestBed.tick();
    expect(service.visible()).toBe(true);
  });

  it('hides an alert that is on screen when a meeting starts', () => {
    setup();
    show(needs());
    meeting.manual.set(true);
    TestBed.tick();
    expect(service.visible()).toBe(false);
  });

  it('tells whether a state of a session is acknowledged', () => {
    setup();
    const a = needs('a', 1700000000);
    expect(service.isAcknowledged(a)).toBe(false);
    service.acknowledge(a);
    expect(service.isAcknowledged(a)).toBe(true);
    expect(service.isAcknowledged(needs('a', 1700000001))).toBe(false);
    expect(service.isAcknowledged(needs('b', 1700000000))).toBe(false);
  });

  describe('remembering acknowledgements', () => {
    it('keeps them for the tab, so a reload does not alert again', () => {
      setup();
      service.acknowledge(needs('a'));
      expect(JSON.parse(sessionStorage.getItem('aiw.acks') ?? '[]')).toEqual([ackKey(needs('a'))]);
    });

    it('restores them on start', () => {
      setup([ackKey(needs('a'))]);
      show(needs('a'));
      expect(service.pending()).toEqual([]);
      expect(service.visible()).toBe(false);
    });

    it('keeps only the latest 100', () => {
      setup();
      for (let i = 0; i < 105; i++) service.acknowledge(needs(`s${i}`));
      const saved: string[] = JSON.parse(sessionStorage.getItem('aiw.acks') ?? '[]');
      expect(saved).toHaveLength(100);
      expect(saved.at(-1)).toBe(ackKey(needs('s104')));
      expect(service.isAcknowledged(needs('s0'))).toBe(false);
    });

    it.each([['not json'], [{ a: 1 }], [[1, 'x', null]]])(
      'ignores saved data that is %j',
      (saved) => {
        sessionStorage.clear();
        sessionStorage.setItem(
          'aiw.acks',
          typeof saved === 'string' ? saved : JSON.stringify(saved),
        );
        setup();
        show(needs('a'));
        expect(service.visible()).toBe(true);
      },
    );

    it('still works when the browser refuses to store anything', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      setup();
      show(needs());
      expect(() => service.acknowledge(needs())).not.toThrow();
      TestBed.tick();
      expect(service.pending()).toEqual([]);
    });

    it('still starts when the browser refuses to read', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      setup();
      show(needs());
      expect(service.visible()).toBe(true);
    });
  });
});
