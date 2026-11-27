import { Routes } from '@angular/router';
import { Shell } from './layout/shell';
import { SessionsFeed } from './features/sessions/sessions-feed';

const TITLE = 'AI Watch';

export const routes: Routes = [
  {
    path: 'kiosk',
    title: `Kiosk · ${TITLE}`,
    loadComponent: () => import('./features/kiosk/kiosk').then((m) => m.Kiosk),
  },
  {
    path: '',
    component: Shell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: `Dashboard · ${TITLE}`,
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        // The list and the detail page share one `/api/sessions` poll, which stops when both close.
        path: 'sessions',
        providers: [SessionsFeed],
        children: [
          {
            path: '',
            title: `Sessions · ${TITLE}`,
            loadComponent: () => import('./features/sessions/sessions').then((m) => m.Sessions),
          },
          {
            path: ':agent/:sessionId',
            title: `Session · ${TITLE}`,
            loadComponent: () =>
              import('./features/sessions/session-detail').then((m) => m.SessionDetail),
          },
        ],
      },
      {
        path: 'limits',
        title: `Limits · ${TITLE}`,
        loadComponent: () => import('./features/limits/limits').then((m) => m.Limits),
      },
      {
        path: 'focus',
        title: `Focus · ${TITLE}`,
        loadComponent: () => import('./features/focus/focus').then((m) => m.Focus),
      },
      {
        path: 'settings',
        title: `Settings · ${TITLE}`,
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
