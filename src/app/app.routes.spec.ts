import { routes } from './app.routes';

const PAGE_PATHS = ['dashboard', 'limits', 'focus', 'settings'];

describe('routes', () => {
  const shell = routes.find((r) => r.path === '');
  const sessions = shell?.children?.find((r) => r.path === 'sessions');

  it('lazy-loads every page inside the shell', async () => {
    for (const path of PAGE_PATHS) {
      const route = shell?.children?.find((r) => r.path === path);
      expect(route?.loadComponent, path).toBeDefined();
      expect(await route?.loadComponent?.(), path).toBeTruthy();
    }
  });

  it('opens the dashboard by default', () => {
    const home = shell?.children?.find((r) => r.path === '');
    expect(home?.redirectTo).toBe('dashboard');
  });

  it('shares one sessions feed between the list and the detail page', async () => {
    expect(sessions?.providers).toHaveLength(1);
    const list = sessions?.children?.find((r) => r.path === '');
    const detail = sessions?.children?.find((r) => r.path === ':agent/:sessionId');
    expect(await list?.loadComponent?.()).toBeTruthy();
    expect(await detail?.loadComponent?.()).toBeTruthy();
  });

  it('serves the kiosk outside the shell, without navigation chrome', async () => {
    const kiosk = routes.find((r) => r.path === 'kiosk');
    expect(shell?.children?.some((r) => r.path === 'kiosk')).toBe(false);
    expect(await kiosk?.loadComponent?.()).toBeTruthy();
  });

  it('sends unknown paths home', () => {
    expect(routes.find((r) => r.path === '**')?.redirectTo).toBe('');
  });
});
