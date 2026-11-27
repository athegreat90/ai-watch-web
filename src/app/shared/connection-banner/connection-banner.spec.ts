import { TestBed } from '@angular/core/testing';
import { ConnectionStatus } from '../../core/connection-state/snapshot-state';
import { ConnectionBanner } from './connection-banner';

describe('ConnectionBanner', () => {
  function render(status: ConnectionStatus, lastSyncAt: number | null = null) {
    const fixture = TestBed.createComponent(ConnectionBanner);
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('lastSyncAt', lastSyncAt);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it.each<ConnectionStatus>(['connecting', 'live'])('shows nothing while %s', (status) => {
    expect(render(status, 1700000000000).querySelector('.banner')).toBeNull();
  });

  it('explains a problem, with the time of the last data', () => {
    const text = render('offline', 1700000000000).querySelector('.banner')?.textContent;
    expect(text).toMatch(/Server unreachable\. Showing the last data from \d{2}:\d{2}:\d{2}\./);
  });

  it('does not claim there is data when there is none', () => {
    expect(render('offline').querySelector('.banner')?.textContent?.trim()).toBe(
      'Server unreachable.',
    );
  });

  it('is announced to screen readers', () => {
    expect(render('stale').querySelector('.banner')?.getAttribute('role')).toBe('status');
  });
});
