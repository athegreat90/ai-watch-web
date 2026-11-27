import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Snapshot } from '../api/models';
import { AttentionService } from '../attention/attention';
import { ConnectionState } from '../connection-state/connection-state';
import { ConnectionStatus } from '../connection-state/snapshot-state';
import { Clock } from '../time/clock';
import { session, snapshot, view } from '../../testing/fixtures';
import { IDLE_MS, IdleService, ROBOT_MOVE_MS, activitySignature } from './idle';

describe('activitySignature', () => {
  const sig = (snap: Snapshot | null, status: ConnectionStatus = 'live') =>
    activitySignature(status, snap);

  it('is the same for the same sessions, even in a new response', () => {
    expect(sig(snapshot([session()]))).toBe(sig(snapshot([session()])));
  });

  it('ignores times that keep moving and limit values', () => {
    const before = snapshot([session({ duration: 100, waiting: 5 })], { limits: {} });
    const after = snapshot([session({ duration: 160, waiting: 65 })], {
      limits: {
        Codex: {
          five_hour: { used_pct: 5, resets_at: 1, resets_in: 1 },
          weekly: { used_pct: 5, resets_at: 1, resets_in: 1 },
        },
      },
    });
    expect(sig(before)).toBe(sig(after));
  });

  it.each([
    [
      'a session appears',
      snapshot([session()]),
      snapshot([session(), session({ session_id: 'b' })]),
    ],
    ['a session changes', snapshot([session({ updated: 1 })]), snapshot([session({ updated: 2 })])],
    ['a session goes', snapshot([session()]), snapshot([])],
    [
      'the total changes',
      snapshot([session()], { total_count: 1 }),
      snapshot([session()], { total_count: 9 }),
    ],
    [
      'the agent differs',
      snapshot([session({ agent: 'Codex' })]),
      snapshot([session({ agent: 'Claude Code' })]),
    ],
  ])('differs when %s', (_name, a, b) => {
    expect(sig(a)).not.toBe(sig(b));
  });

  it('differs when the connection state changes', () => {
    expect(sig(snapshot([session()]), 'live')).not.toBe(sig(snapshot([session()]), 'offline'));
    expect(sig(null, 'connecting')).not.toBe(sig(null, 'offline'));
  });
});

describe('IdleService', () => {
  const tick = signal(0);
  const status = signal<ConnectionStatus>('live');
  const snap = signal<Snapshot | null>(null);
  const pending = signal<ReturnType<typeof view>[]>([]);
  let now: number;
  let idle: IdleService;

  function create() {
    TestBed.configureTestingModule({
      providers: [
        { provide: Clock, useValue: { tick, monotonic: () => now } },
        { provide: ConnectionState, useValue: { status, snapshot: snap } },
        { provide: AttentionService, useValue: { pending } },
      ],
    });
    idle = TestBed.inject(IdleService);
    TestBed.tick();
  }

  const advance = (ms: number) => {
    now += ms;
    tick.set(now);
    TestBed.tick();
  };

  const fire = (type: string) => {
    const event = new Event(type, { cancelable: true, bubbles: true });
    document.body.dispatchEvent(event);
    TestBed.tick();
    return event;
  };

  beforeEach(() => {
    now = 0;
    tick.set(0);
    status.set('live');
    snap.set(snapshot([session()]));
    pending.set([]);
  });

  it('follows the firmware: idle after 15 minutes, robot moves every 30 seconds', () => {
    expect(IDLE_MS).toBe(15 * 60 * 1000);
    expect(ROBOT_MOVE_MS).toBe(30 * 1000);
  });

  it('is awake at the start', () => {
    create();
    expect(idle.active()).toBe(false);
  });

  it('turns idle after 15 minutes without activity', () => {
    create();
    advance(IDLE_MS - 1000);
    expect(idle.active()).toBe(false);
    advance(1000);
    expect(idle.active()).toBe(true);
  });

  it.each(['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'click'])(
    'a %s counts as activity and pushes the 15 minutes back',
    (type) => {
      create();
      advance(IDLE_MS - 1000);
      fire(type);
      advance(IDLE_MS - 1000);
      expect(idle.active()).toBe(false);
      advance(1000);
      expect(idle.active()).toBe(true);
    },
  );

  it('does not turn idle while a session needs you, and starts counting after', () => {
    create();
    pending.set([view({ status: 'needs_attention' })]);
    advance(IDLE_MS * 3);
    expect(idle.active()).toBe(false);
    pending.set([]);
    TestBed.tick();
    advance(IDLE_MS - 1000);
    expect(idle.active()).toBe(false);
    advance(1000);
    expect(idle.active()).toBe(true);
  });

  it('wakes when a session needs you', () => {
    create();
    advance(IDLE_MS);
    pending.set([view({ status: 'needs_attention' })]);
    TestBed.tick();
    expect(idle.active()).toBe(false);
  });

  it('wakes when the sessions change', () => {
    create();
    advance(IDLE_MS);
    snap.set(snapshot([session(), session({ session_id: 'new' })]));
    TestBed.tick();
    expect(idle.active()).toBe(false);
  });

  it('wakes when the connection changes', () => {
    create();
    advance(IDLE_MS);
    status.set('offline');
    TestBed.tick();
    expect(idle.active()).toBe(false);
  });

  it('stays idle while only times and limits move', () => {
    create();
    advance(IDLE_MS);
    snap.set(snapshot([session({ duration: 9999, waiting: 400 })]));
    advance(5000);
    expect(idle.active()).toBe(true);
  });

  describe('waking by hand', () => {
    it.each(['pointerdown', 'keydown', 'touchstart'])(
      'a %s only wakes the screen and is not passed on',
      (type) => {
        create();
        advance(IDLE_MS);
        let reached = false;
        document.body.addEventListener(type, () => (reached = true), { once: true });
        const event = fire(type);
        expect(idle.active()).toBe(false);
        expect(event.defaultPrevented).toBe(true);
        expect(reached).toBe(false);
      },
    );

    it.each(['pointermove', 'wheel'])('a %s wakes the screen but is left alone', (type) => {
      create();
      advance(IDLE_MS);
      const event = fire(type);
      expect(idle.active()).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    });

    it('swallows the click that follows the waking tap, and no other', () => {
      create();
      advance(IDLE_MS);
      fire('pointerdown');
      advance(100);
      expect(fire('click').defaultPrevented).toBe(true);
      advance(600);
      expect(fire('click').defaultPrevented).toBe(false);
    });

    it('does not swallow clicks when it was awake', () => {
      create();
      expect(fire('click').defaultPrevented).toBe(false);
    });
  });

  it('moves the robot to the next of four corners every 30 seconds', () => {
    create();
    advance(IDLE_MS);
    expect(idle.position()).toBe(0);
    advance(ROBOT_MOVE_MS);
    expect(idle.position()).toBe(1);
    advance(ROBOT_MOVE_MS);
    expect(idle.position()).toBe(2);
    advance(ROBOT_MOVE_MS);
    expect(idle.position()).toBe(3);
    advance(ROBOT_MOVE_MS);
    expect(idle.position()).toBe(0);
  });

  it('stops listening when the app closes', () => {
    create();
    TestBed.resetTestingModule();
    expect(() => fire('pointerdown')).not.toThrow();
  });
});
