import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { UnexpectedResponseError } from './errors';
import { Snapshot } from './models';
import { parseSnapshot } from './parse';

/** The three read endpoints. All paths are relative, so the browser only talks to the Nginx proxy. */
@Injectable({ providedIn: 'root' })
export class StatusApi {
  private readonly http = inject(HttpClient);

  /** Dashboard data: counters, limits and up to 8 sessions. */
  status(): Observable<Snapshot> {
    return this.snapshot('/api/status');
  }

  /** The full session list, up to 40 sessions. */
  sessions(): Observable<Snapshot> {
    return this.snapshot('/api/sessions');
  }

  /** Public route, used only by "Test connection". */
  health(): Observable<boolean> {
    return this.http.get<{ ok?: unknown } | null>('/health').pipe(map((body) => body?.ok === true));
  }

  private snapshot(url: string): Observable<Snapshot> {
    return this.http.get<unknown>(url).pipe(
      map((body) => {
        const snapshot = parseSnapshot(body);
        if (!snapshot) throw new UnexpectedResponseError();
        return snapshot;
      }),
    );
  }
}
