import { TestBed } from '@angular/core/testing';
import { SessionStatus } from '../../core/api/models';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it.each<[SessionStatus, string]>([
    ['needs_attention', 'Needs you'],
    ['working', 'Working'],
    ['done', 'Completed'],
    ['error', 'Error'],
    ['notice', 'Notification'],
    ['idle', 'Idle'],
  ])('shows %s as "%s", in words and not only in colour', (status, label) => {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('.badge-status');
    expect(badge?.textContent?.trim()).toBe(label);
    expect(badge?.getAttribute('data-status')).toBe(status);
  });
});
