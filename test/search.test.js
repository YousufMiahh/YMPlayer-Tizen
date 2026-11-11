// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({ streams: vi.fn(), categories: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { searchView } from '../js/views/search.js';
import { orderCategories } from '../js/favourites.js';

const LIVE = [
  { type: 'live', id: '1', name: 'BBC One' }, { type: 'live', id: '2', name: 'Sky News' },
  { type: 'live', id: '3', name: 'bbc Two' },
];
const MOVIES = [{ type: 'movie', id: '9', name: 'The Bourne Identity' }, { type: 'movie', id: '8', name: 'Heat' }];
const SERIES = [{ type: 'series', id: '5', name: 'Breaking Bad' }];
const LISTS = { live: LIVE, movie: MOVIES, series: SERIES };

let root; let go;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const input = () => root.querySelector('input');
const names = () => [...root.querySelectorAll('[data-result] .name')].map((n) => n.textContent);
async function type(q) { input().value = q; input().dispatchEvent(new Event('input', { bubbles: true })); await tick(300); }
const section = (s) => root.querySelector(`[data-section="${s}"]`);

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  vi.clearAllMocks();
  api.streams.mockImplementation(async (t) => LISTS[t]);
  router.init(root);
  router.register('search', searchView);
  go = vi.spyOn(router, 'go');
  router.register('player-live', () => ({ mount() {}, unmount() {} }));
  router.register('movie-detail', () => ({ mount() {}, unmount() {} }));
  router.register('series-detail', () => ({ mount() {}, unmount() {} }));
  go.mockClear();
  router.go('search');
  await tick();
  go.mockClear();
});
afterEach(() => { router.reset(); go.mockRestore(); });

describe('search', () => {
  it('shows a prompt for an empty query', () => {
    expect(names()).toEqual([]);
    expect(root.querySelector('.empty').textContent).toMatch(/type/i);
  });

  it('filters the current section case-insensitively by name', async () => {
    await type('BBC');
    expect(names()).toEqual(['BBC One', 'bbc Two']);
    await type('sky');
    expect(names()).toEqual(['Sky News']);
    expect(api.streams).toHaveBeenCalledWith('live', null);
  });

  it('shows a no-results state', async () => {
    await type('zzz');
    expect(names()).toEqual([]);
    expect(root.querySelector('.empty').textContent).toMatch(/no results/i);
  });

  it('switching section re-filters the same query against that section', async () => {
    await type('b');
    expect(names()).toEqual(['BBC One', 'bbc Two']);
    section('movie').click(); await tick();
    expect(names()).toEqual(['The Bourne Identity']);
    section('series').click(); await tick();
    expect(names()).toEqual(['Breaking Bad']);
  });

  it('caches each section list (one api call per section)', async () => {
    await type('b'); await type('bb');
    section('movie').click(); await tick();
    section('live').click(); await tick();
    expect(api.streams.mock.calls.filter((c) => c[0] === 'live')).toHaveLength(1);
  });

  it('opens a live result in player-live with the result list and index', async () => {
    await type('bbc');
    root.querySelectorAll('[data-result]')[1].click();
    expect(go).toHaveBeenCalledWith('player-live', { channels: [LIVE[0], LIVE[2]], index: 1 });
  });

  it('opens movie and series results in their detail views', async () => {
    section('movie').click(); await tick();
    await type('heat');
    root.querySelector('[data-result]').click();
    expect(go).toHaveBeenCalledWith('movie-detail', { item: MOVIES[1] });
    router.go('search'); await tick(); go.mockClear();
    section('series').click(); await tick();
    await type('break');
    root.querySelector('[data-result]').click();
    expect(go).toHaveBeenCalledWith('series-detail', { item: SERIES[0] });
  });

  it('Menu toggles favourite on the focused result', async () => {
    await type('heat'); // live has no match; switch
    section('movie').click(); await tick();
    const el = root.querySelector('[data-result]');
    el.focus();
    const e = new KeyboardEvent('keydown', { keyCode: 10133, cancelable: true });
    expect(router.onKey(e)).toBe(true);
    expect(store.isFav(MOVIES[1])).toBe(true);
    expect(el.classList.contains('fav')).toBe(true);
  });
});

describe('favourites helper', () => {
  it('pins favourite categories to the top of the rail, keeping order otherwise', () => {
    const cats = [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }];
    store.toggleFavCategory('live', '3');
    expect(orderCategories('live', cats).map((c) => c.id)).toEqual(['3', '1', '2']);
    store.toggleFavCategory('live', '2');
    expect(orderCategories('live', cats).map((c) => c.id)).toEqual(['2', '3', '1']);
  });
});
