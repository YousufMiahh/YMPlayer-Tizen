// @vitest-environment jsdom
// Setup screen (SetupActivity.java): texts, progress rows, continue/retry/all set, routing, Back.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (orig) => ({ ...(await orig()), categories: vi.fn(), streams: vi.fn(), progress: vi.fn(() => 0) }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as repo from '../js/repo.js';
import { router } from '../js/router.js';
import { setupView, DONE_MS, TICK_MS } from '../js/views/setup.js';

let root; let gates;
const $ = (s) => root.querySelector(s);
const row = (t) => $(`.setup-row[data-type="${t}"]`);
const countOf = (t) => row(t).querySelector('.setup-count').textContent;
const markOf = (t) => row(t).querySelector('.setup-mark').textContent;
const spinning = (t) => !row(t).querySelector('.setup-spin').hidden;
const flush = () => vi.advanceTimersByTimeAsync(0);
const N = { live: 12345, movie: 2, series: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
  store.saveAccount({ id: '', server: 'http://a.tv', user: 'ann', pass: 'p', ok: true });
  gates = {};
  api.categories.mockResolvedValue([]);
  api.streams.mockImplementation((t) => new Promise((res, rej) => {
    gates[t] = { ok: () => res(Array.from({ length: N[t] }, (_, i) => ({ type: t, id: String(i) }))), fail: rej };
  }));
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  router.init(root);
  router.register('setup', setupView);
  router.register('home', () => ({ mount(r) { r.innerHTML = '<p id="home"></p>'; }, unmount() {} }));
});
afterEach(() => { router.reset(); vi.useRealTimers(); });

describe('setup screen', () => {
  it('shows the Android text and three rows, all "Waiting"', () => {
    router.go('setup');
    expect($('.setup-logo').getAttribute('src')).toBe('assets/logo.png');
    expect($('.setup-title').textContent).toBe('Getting everything ready');
    expect($('.setup-sub').textContent).toBe('This only happens when you add a playlist. After this, everything opens instantly.');
    expect([...root.querySelectorAll('.setup-name')].map((n) => n.textContent)).toEqual(['Live TV', 'Movies', 'Series']);
    expect(['live', 'movie', 'series'].map(countOf)).toEqual(['Waiting', 'Waiting', 'Waiting']);
  });

  it('progress: spinner, "Waiting for your provider…", "N so far…" every 300 ms, then the total with ✓', async () => {
    router.go('setup');
    await flush();
    expect(spinning('live')).toBe(true);
    expect(countOf('live')).toBe('Waiting for your provider…');
    expect(spinning('movie')).toBe(false); // Live TV goes first
    api.progress.mockImplementation((t) => (t === 'live' ? 4321 : 0));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(countOf('live')).toBe('4,321 channels so far…');
    gates.live.ok(); await flush();
    expect(spinning('live')).toBe(false);
    expect(markOf('live')).toBe('✓');
    expect(countOf('live')).toBe('12,345 channels');
    expect(spinning('movie') && spinning('series')).toBe(true); // both at once
  });

  it('once Live TV is ready, offers "Start Watching" (focused), which goes Home', async () => {
    router.go('setup');
    await flush();
    gates.live.ok(); await flush();
    const go = $('[data-action=continue]');
    expect(go.textContent).toBe('Start Watching — Movies & Series will finish in the background');
    expect(document.activeElement).toBe(go);
    go.click();
    expect(router.current().name).toBe('home');
    expect(router.stackDepth()).toBe(1);
    gates.movie.ok(); gates.series.ok(); await flush(); // carries on in the background
    expect(repo.hasLibrary()).toBe(true);
  });

  it('all done: "All set", then Home after 700 ms', async () => {
    router.go('setup');
    await flush();
    gates.live.ok(); await flush();
    gates.movie.ok(); gates.series.ok(); await flush();
    expect($('.setup-status').textContent).toBe('All set');
    expect($('.setup-actions').children).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DONE_MS - 1);
    expect(router.current().name).toBe('setup');
    await vi.advanceTimersByTimeAsync(1);
    expect(router.current().name).toBe('home');
  });

  it('a failure: ✕, "Didn\'t load", the reason, then "Try Again" (failed only) and "Continue Anyway"', async () => {
    router.go('setup');
    await flush();
    gates.live.ok(); await flush();
    gates.movie.fail(new Error('Server returned HTTP 502')); gates.series.ok(); await flush();
    expect(markOf('movie')).toBe('✕');
    expect(countOf('movie')).toBe("Didn't load");
    expect($('.setup-status').textContent).toBe("Couldn't download Movies: Server returned HTTP 502");
    const btns = [...root.querySelectorAll('.setup-actions button')].map((b) => b.textContent);
    expect(btns).toEqual(['Try Again', 'Continue Anyway']);
    expect(document.activeElement.textContent).toBe('Try Again');
    api.streams.mockClear();
    $('[data-action=retry]').click();
    expect(countOf('movie')).toBe('Waiting');
    expect(countOf('live')).toBe('12,345 channels'); // untouched
    await flush();
    expect(api.streams.mock.calls.map((c) => c[0])).toEqual(['movie']);
    gates.movie.ok(); await flush();
    expect($('.setup-status').textContent).toBe('All set');
  });

  it('a network failure reads like Android\'s message', async () => {
    router.go('setup');
    await flush();
    gates.live.fail(new TypeError('Failed to fetch')); await flush();
    expect($('.setup-status').textContent).toBe("Couldn't download Live TV: Couldn't connect to the server");
  });

  it('"Continue Anyway" goes Home', async () => {
    router.go('setup');
    await flush();
    gates.live.fail(new Error('x')); await flush();
    gates.movie.ok(); gates.series.ok(); await flush();
    $('[data-action=skip]').click();
    expect(router.current().name).toBe('home');
  });

  it('Back is ignored, and leaving stops the screen but not the download', async () => {
    router.go('setup');
    expect(router.current().view.onBack()).toBe(true);
    await flush();
    router.resetTo('home');
    gates.live.ok(); await flush();
    gates.movie.ok(); gates.series.ok(); await flush();
    expect(repo.hasLibrary()).toBe(true);
    expect(store.lastRefresh()).toBeGreaterThan(0);
  });
});
