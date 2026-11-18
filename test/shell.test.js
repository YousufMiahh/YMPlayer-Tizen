// @vitest-environment jsdom
// App shell: splash timing/routing and leaving the app with Back on Home.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, views, exitApp } from '../js/app.js';
import { router } from '../js/router.js';
import { splashView, SHOW_MS, MAX_WAIT_MS } from '../js/views/splash.js';
import { _reset as resetBar } from '../js/ui/topbar.js';
import { seedLibrary } from './helpers.js';

const appender = (name) => () => ({
  mount(r) { const d = document.createElement('div'); d.textContent = name; r.appendChild(d); },
  unmount() {},
});
const account = (library = true) => {
  localStorage.setItem('accounts', JSON.stringify([{ id: '', server: 'http://h', user: 'u', pass: 'p', ua: '', ok: true }]));
  if (library) seedLibrary();
};
const back = () => document.dispatchEvent(new CustomEvent('back', { bubbles: true }));

let dispose; let saved;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetBar();
  document.body.innerHTML = '<div id="root"></div>';
  saved = { home: views.home, login: views.login, live: views.live, setup: views.setup };
  views.home = appender('home'); views.login = appender('login'); views.live = appender('live'); views.setup = appender('setup');
});
afterEach(() => {
  if (dispose) dispose();
  dispose = null;
  Object.assign(views, saved);
  delete globalThis.tizen;
  vi.useRealTimers();
});

describe('splash', () => {
  it('shows the logo, name and credit', () => {
    dispose = boot(document.getElementById('root'));
    const root = document.getElementById('root');
    expect(root.querySelector('.splash-logo .sl-y').textContent).toBe('Y');
    expect(root.querySelector('.splash-logo .sl-m').textContent).toBe('M');
    expect(root.querySelector('.splash-name').textContent).toBe('YM Player');
    expect(root.querySelector('.splash-by').textContent).toBe('Developed by Yousuf Miah');
    expect(root.querySelector('.splash').classList.contains('go')).toBe(true);
  });

  it('stays for the whole intro, then replaces itself (not on the back stack)', async () => {
    account();
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(SHOW_MS - 1);
    expect(router.current().name).toBe('splash');
    await vi.advanceTimersByTimeAsync(1);
    expect(router.current().name).toBe('home');
    expect(router.stackDepth()).toBe(1);
  });

  it('goes to Setup when signed in but no library is saved yet (LoginActivity.java:52-60)', async () => {
    account(false);
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(SHOW_MS);
    expect(router.current().name).toBe('setup');
    expect(router.stackDepth()).toBe(1);
  });

  it('warms the saved library while the logo shows (Live TV list + every category list)', async () => {
    account();
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(SHOW_MS);
    const repo = await import('../js/repo.js');
    expect(repo.cached('live')).toEqual([]);
    expect(router.current().name).toBe('home');
  });

  it('goes to Login when there is no account', async () => {
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(SHOW_MS);
    expect(router.current().name).toBe('login');
    expect(router.stackDepth()).toBe(1);
  });

  it('waits for the library warm-up, but never longer than 6000 ms', async () => {
    account();
    let finish;
    const prev = views.splash;
    views.splash = splashView({ warmUp: () => new Promise((r) => { finish = r; }) });
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(SHOW_MS + 500);
    expect(router.current().name).toBe('splash');
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(router.current().name).toBe('home');

    dispose(); dispose = null;
    views.splash = splashView({ warmUp: () => new Promise(() => {}) }); // never finishes
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS - 1);
    expect(router.current().name).toBe('splash');
    await vi.advanceTimersByTimeAsync(1);
    expect(router.current().name).toBe('home');
    views.splash = prev;
  });

  it('ignores Back', () => {
    const exit = vi.fn();
    globalThis.tizen = { application: { getCurrentApplication: () => ({ exit }) } };
    dispose = boot(document.getElementById('root'));
    back();
    expect(router.current().name).toBe('splash');
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('Back on Home exits the app', () => {
  it('calls tizen.application.getCurrentApplication().exit() with no confirm', async () => {
    const exit = vi.fn();
    globalThis.tizen = { application: { getCurrentApplication: () => ({ exit }) } };
    account();
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(SHOW_MS);
    expect(router.current().name).toBe('home');
    back();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dialog')).toBeNull(); // Android Home has no exit prompt
  });

  it('Back from a section goes to Home first, then exits', async () => {
    const exit = vi.fn();
    globalThis.tizen = { application: { getCurrentApplication: () => ({ exit }) } };
    account();
    dispose = boot(document.getElementById('root'));
    await vi.advanceTimersByTimeAsync(SHOW_MS);
    router.go('live');
    back();
    expect(router.current().name).toBe('home');
    expect(exit).not.toHaveBeenCalled();
    back();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exitApp is safe without tizen', () => {
    expect(() => exitApp()).not.toThrow();
  });
});
