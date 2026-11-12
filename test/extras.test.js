// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({ streams: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { ambientView, collectArtwork } from '../js/views/ambient.js';
import * as homeRows from '../js/home-rows.js';
import { views } from '../js/app.js';

let root;
const tick = () => new Promise((r) => setTimeout(r, 0));
const stub = () => ({ mount() {}, unmount() {} });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  vi.clearAllMocks();
  api.streams.mockResolvedValue([]);
  router.init(root);
  router.register('home', stub);
  router.register('ambient', ambientView);
});
afterEach(() => { router.reset(); vi.useRealTimers(); });

describe('no key gates', () => {
  it('the remote rows need no key (Top 10 is the Netflix file; trailers are the keyless embed)', () => {
    expect(homeRows.REMOTE_ROWS.map((r) => r.key)).toEqual(['top_movies', 'top_series', 'new_movies', 'new_series']);
  });
});

describe('ambient', () => {
  const seed = () => {
    store.toggleFav({ type: 'movie', id: '1', name: 'A', icon: 'http://x/a.jpg' });
    store.toggleFav({ type: 'series', id: '2', name: 'B', icon: 'http://x/b.jpg' });
    store.addHistory({ type: 'movie', id: '3', name: 'C', icon: 'http://x/c.jpg' });
    store.addHistory({ type: 'live', id: '4', name: 'L', icon: 'http://x/live.png' });
  };

  it('collects de-duplicated artwork from owned items only (no live logos)', () => {
    seed();
    store.toggleFav({ type: 'movie', id: '9', name: 'Dup', icon: 'http://x/a.jpg' });
    expect(collectArtwork().sort()).toEqual(['http://x/a.jpg', 'http://x/b.jpg', 'http://x/c.jpg']);
  });

  it('cycles through the artwork on a timer and needs no key or extra api', async () => {
    seed();
    vi.useFakeTimers();
    router.go('home'); router.go('ambient', { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const img = () => root.querySelector('.ambient img').getAttribute('src');
    const seen = [img()];
    for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(1000); seen.push(img()); }
    expect(new Set(seen).size).toBe(3);
    expect(seen[3]).toBe(seen[0]); // wraps around
    expect(seen.every((s) => s.startsWith('http://x/'))).toBe(true);
    expect(api.streams).not.toHaveBeenCalled(); // enough cached artwork
  });

  it('falls back to Xtream streams only when nothing is cached', async () => {
    api.streams.mockImplementation(async (t) => (t === 'movie' ? [{ type: 'movie', id: '1', icon: 'http://x/m.jpg' }] : []));
    router.go('home'); router.go('ambient');
    await tick();
    expect(api.streams.mock.calls.every((c) => c[1] === null)).toBe(true);
    expect(root.querySelector('.ambient img').getAttribute('src')).toBe('http://x/m.jpg');
  });

  it('any key exits and stops the timer', async () => {
    seed();
    vi.useFakeTimers();
    router.go('home'); router.go('ambient', { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(router.onKey({ key: 'ArrowRight' })).toBe(true);
    expect(router.current().name).toBe('home');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('phone link (outbound QR removed)', () => {
  it('only Ambient is registered; the outbound-QR phonelink view is gone', () => {
    expect(typeof views.ambient).toBe('function');
    expect(views.phonelink).toBeUndefined();
  });
});
