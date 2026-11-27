import { Injectable, inject } from '@angular/core';
import { StatusApi } from '../../core/api/status-api';
import { snapshotState } from '../../core/connection-state/snapshot-state';
import { DemoSource } from '../../core/demo/demo-source';
import { injectPoll } from '../../core/polling/inject-poll';

/**
 * The list asks half as often as the status poll. The shell asks `/api/status` on every page, so
 * with the list open a client would make two requests per interval (40 a minute at 3 s, twice the
 * 20 a minute every other page makes). At twice the interval it makes 30.
 */
export const LIST_INTERVAL_FACTOR = 2;

/**
 * The full session list from `/api/sessions`. It is provided by the sessions route, so it polls
 * only while the Sessions pages are open, and the list and the detail page share one poll.
 */
@Injectable()
export class SessionsFeed {
  private readonly api = inject(StatusApi);
  private readonly demo = inject(DemoSource);
  private readonly source = injectPoll(
    () => (this.demo.enabled() ? this.demo.snapshot() : this.api.sessions()),
    { intervalFactor: LIST_INTERVAL_FACTOR },
  );

  readonly state = snapshotState(this.source);
}
