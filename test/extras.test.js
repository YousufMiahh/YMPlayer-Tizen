// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({ streams: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as keys from '../js/keys.js';
import { router } from '../js/router.js';
import { ambientView, collectArtwork } from '../js/views/ambient.js';
import { phonelinkView, accountPayload } from '../js/views/phonelink.js';
import { encode, toSvg } from '../js/vendor/qr.js';
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
  router.register('phonelink', phonelinkView);
});
afterEach(() => { router.reset(); vi.useRealTimers(); });

describe('keys gate', () => {
  it('has no TMDB/YouTube keys in v1', () => {
    expect(keys.hasTmdb()).toBe(false);
    expect(keys.hasYoutube()).toBe(false);
  });
  it('home shares the gate: Top 10 stays hidden', async () => {
    expect(homeRows.hasTmdb).toBe(keys.hasTmdb);
    store.toggleFav({ type: 'movie', id: 'f', name: 'F' });
    const rows = await homeRows.buildRows();
    expect(rows.map((r) => r.key)).not.toContain('top_movies');
    expect(rows.map((r) => r.key)).not.toContain('top_series');
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
    expect(keys.hasTmdb()).toBe(false);
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

describe('qr + phonelink', () => {
  it('encode produces a square matrix with finder patterns', () => {
    const { size, modules } = encode('http://s.example:8080');
    expect(size).toBe(modules.length);
    expect((size - 17) % 4).toBe(0);
    expect(modules[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(modules[3][3]).toBe(true);
  });
  it('toSvg is non-empty', () => {
    const svg = toSvg('hello');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
  });

  it('payload encodes server, user and pass', () => {
    const p = accountPayload({ server: 'http://s.example:8080', user: 'u s', pass: 'p&1' });
    expect(p).toContain('http://s.example:8080');
    expect(p).toContain('username=u%20s');
    expect(p).toContain('password=p%261');
  });

  it('phonelink renders the QR for the current account', () => {
    store.saveAccount({ id: '', server: 'http://s.example:8080', user: 'bob', pass: 'pw', ok: true });
    router.go('phonelink');
    const qr = root.querySelector('.phonelink svg');
    expect(qr).not.toBeNull();
    expect(qr.querySelector('path').getAttribute('d').length).toBeGreaterThan(50);
    expect(root.querySelector('.phonelink').dataset.payload).toContain('http://s.example:8080');
    expect(root.querySelector('.phonelink').dataset.payload).toContain('bob');
  });

  it('phonelink shows a message with no account', () => {
    router.go('phonelink');
    expect(root.querySelector('svg')).toBeNull();
    expect(root.querySelector('.phonelink').textContent).toMatch(/account/i);
  });

  it('is registered in the app view registry', () => {
    expect(typeof views.ambient).toBe('function');
    expect(typeof views.phonelink).toBe('function');
  });
});
