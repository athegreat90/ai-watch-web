import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { Observable, defer, distinctUntilChanged, fromEvent, map, startWith } from 'rxjs';

/** Emits whether the tab is visible: the current value on subscribe, then every change. */
export const PAGE_VISIBLE = new InjectionToken<Observable<boolean>>('PAGE_VISIBLE', {
  providedIn: 'root',
  factory: () => {
    const doc = inject(DOCUMENT);
    const visible = () => doc.visibilityState === 'visible';
    return defer(() =>
      fromEvent(doc, 'visibilitychange').pipe(
        map(visible),
        startWith(visible()),
        distinctUntilChanged(),
      ),
    );
  },
});
