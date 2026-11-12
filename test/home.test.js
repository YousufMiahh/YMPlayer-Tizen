// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({ streams: vi.fn(), categories: vi.fn(async () => []) }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { homeView } from '../js/views/home.js';

let root;
const tick = () => new Promise((r) => setTimeout(r, 0));
const rowKeys = () => [...root.querySelectorAll('.home-row')].map((r) => r.dataset.row);
const ids = (k) => [...root.querySelectorAll(`.home-row[data-row="${k}"] [data-tile]`)].map((t) => t.dataset.item);
const stub = () => ({ mount() {}, unmount() {} });

const M = (id, added) => ({ type: 'movie', id, name: `M${id}`, added });

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  vi.clearAllMocks();
  api.streams.mockImplementation(async (type) => (type === 'movie'
    ? [M('1', '100'), M('3', '300'), M('2', '200')]
    : [{ type: 'series', id: 's1', name: 'S1', added: '5' }, { type: 'series', id: 's2', name: 'S2', added: '9' }]));
  router.init(root);
  for (const n of ['live', 'movies', 'series', 'search', 'settings', 'movie-detail', 'series-detail', 'player-vod', 'player-live']) router.register(n, stub);
  router.register('home', homeView);
});
afterEach(() => router.reset());

describe('home listeners', () => {
  it('unmount removes click/activate handlers from the shared root', async () => {
    router.go('home');
    await tick();
    const go = vi.spyOn(router, 'go');
    router.go('settings'); // unmounts home
    go.mockClear();
    const b = document.createElement('button');
    b.dataset.menu = 'live';
    root.appendChild(b);
    b.click();
    b.dispatchEvent(new Event('activate', { bubbles: true }));
    expect(go).not.toHaveBeenCalled();
  });
});

describe('home rows', () => {
  it('renders only non-empty rows whose homeShows is true', async () => {
    store.toggleFav({ type: 'live', id: 'c1', name: 'BBC' });
    store.toggleFav({ type: 'movie', id: 'f1', name: 'Fav' });
    router.go('home');
    await tick();
    expect(rowKeys()).toEqual(['fav_live', 'fav_movie', 'new_movies', 'new_series']);
    store.setHomeShows('fav_movie', false);
    store.setHomeShows('new_series', false);
    router.go('home');
    await tick();
    expect(rowKeys()).toEqual(['fav_live', 'new_movies']);
  });

  it('Continue Watching = history with position>0, newest first', async () => {
    const a = { type: 'movie', id: 'a', name: 'A' }; const b = { type: 'movie', id: 'b', name: 'B' };
    const c = { type: 'movie', id: 'c', name: 'C' };
    store.addHistory(a); store.addHistory(b); store.addHistory(c); // newest first: c, b, a
    store.setPosition(a, 5000); store.setPosition(c, 9000);      // b has no position
    router.go('home');
    await tick();
    expect(ids('continue')).toEqual(['c', 'a']);
  });

  it('Recent Channels come from live history', async () => {
    store.addHistory({ type: 'live', id: 'L1', name: 'One' });
    store.addHistory({ type: 'live', id: 'L2', name: 'Two' });
    router.go('home');
    await tick();
    expect(ids('recent')).toEqual(['L2', 'L1']);
  });

  it('Recently Added is sorted by added desc', async () => {
    router.go('home');
    await tick();
    expect(ids('new_movies')).toEqual(['3', '2', '1']);
    expect(ids('new_series')).toEqual(['s2', 's1']);
    expect(api.streams).toHaveBeenCalledWith('movie', null);
  });

  it('Top 10 rows stay hidden without a TMDB key', async () => {
    router.go('home');
    await tick();
    expect(rowKeys()).not.toContain('top_movies');
    expect(rowKeys()).not.toContain('top_series');
  });
});

describe('home navigation', () => {
  it.each([['live'], ['movies'], ['series'], ['search'], ['settings']])('top-bar tab %s routes there (pushed over Home)', async (name) => {
    router.go('home');
    await tick();
    root.querySelector(`[data-tab="${name}"]`).click();
    expect(router.current().name).toBe(name);
    expect(router.stackDepth()).toBe(2);
  });

  it('has no Ambient/Phone entries on Home (they live in Settings, as on Android)', async () => {
    router.go('home');
    await tick();
    const tabs = [...root.querySelectorAll('[data-tab]')].map((t) => t.textContent);
    expect(tabs).toEqual(['Home', 'Live TV', 'Movies', 'Series', 'Search', 'Settings']);
  });

  it('focus starts on the first card, not the top bar', async () => {
    store.toggleFav({ type: 'live', id: 'c1', name: 'BBC One' });
    router.go('home');
    await tick();
    expect(document.activeElement.dataset.row).toBe('fav_live');
    expect(document.activeElement.dataset.tile).toBe('0');
  });

  it('cards use the Android shape per row and initials for missing channel art', async () => {
    store.toggleFav({ type: 'live', id: 'c1', name: 'bbc one hd' });
    router.go('home');
    await tick();
    const card = root.querySelector('[data-row="fav_live"] [data-tile]');
    expect(card.classList.contains('channel')).toBe(true);
    expect(card.querySelector('.initials').textContent).toBe('BO');
    expect(root.querySelector('[data-row="new_movies"] [data-tile]').classList.contains('poster')).toBe(true);
  });

  it('Continue Watching tile resumes in the VOD player', async () => {
    const a = { type: 'movie', id: 'a', name: 'A' };
    store.addHistory(a); store.setPosition(a, 5000);
    router.go('home');
    await tick();
    root.querySelector('.home-row[data-row="continue"] [data-tile]').click();
    expect(router.current().name).toBe('player-vod');
    expect(router.current().params.item.id).toBe('a');
    expect(router.current().params.startMs).toBe(5000);
  });

  it('tiles open the right target per type', async () => {
    store.toggleFav({ type: 'live', id: 'c1', name: 'BBC' });
    store.toggleFav({ type: 'series', id: 'sx', name: 'SX' });
    router.go('home');
    await tick();
    root.querySelector('[data-row="fav_live"] [data-tile]').click();
    expect(router.current().name).toBe('player-live');
    expect(router.current().params.index).toBe(0);
    router.go('home'); await tick();
    root.querySelector('[data-row="fav_series"] [data-tile]').click();
    expect(router.current().name).toBe('series-detail');
    router.go('home'); await tick();
    root.querySelector('[data-row="new_movies"] [data-tile]').click();
    expect(router.current().name).toBe('movie-detail');
    expect(router.current().params.item.id).toBe('3');
  });
});

describe('home top bar', () => {
  it('shows the clock where Tizen used to show an account chip', async () => {
    router.go('home', { status: 'Active · expires 2027' });
    await tick();
    expect(root.querySelector('.status-chip')).toBeNull();
    expect(root.querySelector('.tb-clock').textContent).toMatch(/^\d\d:\d\d$/);
    expect(root.querySelector('[data-tab="home"]').classList.contains('current')).toBe(true);
  });
});

describe('home library (HomeActivity.startLibrary)', () => {
  const signIn = () => store.saveAccount({ id: '', server: 'http://a.tv', user: 'ann', pass: 'p', ok: true });

  it('first run with nothing saved: shows the "getting ready" note, downloads once, then fills the rows', async () => {
    signIn();
    let release;
    api.categories.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    router.go('home');
    await tick();
    expect(root.querySelector('.home-empty').textContent)
      .toBe('Getting your channels, movies and series ready…\nThis only takes a while the first time.');
    release([]);
    for (let i = 0; i < 5; i++) await tick();
    expect(rowKeys()).toEqual(['new_movies', 'new_series']);
    expect(api.streams.mock.calls.filter((c) => c[0] === 'movie')).toHaveLength(1);
    const repo = await import('../js/repo.js');
    expect(repo.hasLibrary()).toBe(true);
  });

  it('with a saved library it reads it (no download) and reloads rows when a refresh lands', async () => {
    signIn();
    const repo = await import('../js/repo.js');
    const { seedLibrary } = await import('./helpers.js');
    seedLibrary({ movie: [M('7', '700')], series: [] });
    store.setLastRefresh(Date.now()); // not due
    router.go('home');
    await tick(); await tick();
    expect(ids('new_movies')).toEqual(['7']);
    expect(api.streams).not.toHaveBeenCalled();
    api.streams.mockImplementation(async (t) => (t === 'movie' ? [M('8', '800'), M('7', '700')] : []));
    await repo.downloadType('movie');
    await tick();
    expect(ids('new_movies')).toEqual(['8', '7']);
  });
});
