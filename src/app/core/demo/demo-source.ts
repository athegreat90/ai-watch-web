import { Injectable, inject } from '@angular/core';
import { Observable, defer, of } from 'rxjs';
import { Snapshot } from '../api/models';
import { SettingsStore } from '../settings/settings-store';
import { Clock } from '../time/clock';
import { demoSnapshot } from './demo-data';

/**
 * Example data, used only while the user has turned demo mode on. It stands in for the server's
 * answer, so the rest of the app works unchanged. It is never used for any other reason: a
 * server that is down shows as down.
 */
@Injectable({ providedIn: 'root' })
export class DemoSource {
  private readonly clock = inject(Clock);
  private readonly anchorSec = this.clock.wallNow() / 1000;

  readonly enabled = inject(SettingsStore).demo;

  snapshot(): Observable<Snapshot> {
    return defer(() => of(demoSnapshot(this.anchorSec, this.clock.wallNow() / 1000)));
  }
}
