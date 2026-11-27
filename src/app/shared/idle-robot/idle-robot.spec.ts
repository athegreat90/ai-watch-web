import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IdleService } from '../../core/idle/idle';
import { IdleRobot } from './idle-robot';

describe('IdleRobot', () => {
  const active = signal(false);
  const position = signal(0);

  function render() {
    active.set(false);
    position.set(0);
    TestBed.configureTestingModule({
      providers: [{ provide: IdleService, useValue: { active, position } }],
    });
    const fixture = TestBed.createComponent(IdleRobot);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, update: () => fixture.detectChanges() };
  }

  it('shows nothing while the screen is awake', () => {
    expect(render().root.querySelector('.idle')).toBeNull();
  });

  it('covers the screen with the robot while idle', () => {
    const { root, update } = render();
    active.set(true);
    update();
    expect(root.querySelector('.idle')).not.toBeNull();
    expect(root.querySelector('svg.robot')).not.toBeNull();
    expect(root.querySelectorAll('.eye')).toHaveLength(2);
  });

  it('tells screen readers what it is and how to leave it, without reading the drawing', () => {
    const { root, update } = render();
    active.set(true);
    update();
    const idle = root.querySelector('.idle');
    expect(idle?.getAttribute('role')).toBe('img');
    expect(idle?.getAttribute('aria-label')).toContain('press a key');
    expect(root.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([0, 1, 2, 3])('puts the robot in corner %d', (corner) => {
    const { root, update } = render();
    active.set(true);
    position.set(corner);
    update();
    expect(root.querySelector('svg')?.getAttribute('data-position')).toBe(String(corner));
  });

  it('goes away when the screen wakes', () => {
    const { root, update } = render();
    active.set(true);
    update();
    active.set(false);
    update();
    expect(root.querySelector('.idle')).toBeNull();
  });
});
