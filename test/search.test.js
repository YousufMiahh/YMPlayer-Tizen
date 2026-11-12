// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({ streams: vi.fn(), categories: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as filters from '../js/filters.js';
import * as toast from '../js/ui/toast.js';
import * as coach from '../js/ui/coach.js';
import * as match from '../js/match.js';
import { router } from '../js/router.js';
import {
  searchView, heading, gridColumns, statusText, rankSection, MAX, GRID_MAX, IDLE, LOADING, SEARCHING, HINT, CHIPS,
} from '../js/views/search.js';

const L = (id, name, cat = '1') => ({ type: 'live', id, name, categoryId: cat });
const M = (id, name, cat = '10') => ({ type: 'movie', id, name, categoryId: cat });
const S = (id, name) => ({ type: 'series', id, name, categoryId: '20' });
let LIVE; let MOVIES; let SERIES;

let root; let go;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const box = () => root.querySelector('.s-box');
const status = () => root.querySelector('.s-status').textContent;
const chip = (i) => root.querySelectorAll('.s-chip')[i];
const sections = () => [...root.querySelectorAll('.s-slot > section')].map((s) => ({
  slot: Number(s.dataset.slot), grid: s.classList.contains('s-grid'), title: s.querySelector('.shelf-title').textContent,
  names: [...s.querySelectorAll('.card .title')].map((t) => t.textContent),
}));
async function type(q) { box().value = q; box().dispatchEvent(new Event('input', { bubbles: true })); await tick(330); await tick(); }
const key = (k, extra = {}) => { const e = new KeyboardEvent('keydown', { keyCode: k, cancelable: true, ...extra }); return router.onKey(e); };
const keyup = (k) => document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: k }));

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  vi.clearAllMocks();
  LIVE = [L('1', 'BBC One'), L('2', 'Sky News'), L('3', 'bbc Two'), L('4', 'FR: BBC Monde', '2')];
  MOVIES = [M('9', 'The Bourne Identity'), M('8', 'Heat'), M('7', 'Spider-Man'), M('6', 'The Amazing Spider-Man')];
  SERIES = [S('5', 'Breaking Bad'), S('4', 'Spider-Man: The Series')];
  const LISTS = { live: LIVE, movie: MOVIES, series: SERIES };
  api.streams.mockImplementation(async (t) => LISTS[t]);
  api.categories.mockImplementation(async (t) => (t === 'live' ? [{ id: '1', name: 'UK | News' }, { id: '2', name: 'FR | Infos' }] : []));
  store.saveAccount({ id: '', server: 'http://a.tv', user: 'ann', pass: 'p', ok: true });
  router.init(root);
  router.register('search', searchView);
  for (const n of ['player-live', 'movie-detail', 'series-detail', 'home']) router.register(n, () => ({ mount() {}, unmount() {} }));
  go = vi.spyOn(router, 'go');
  router.go('search', {});
  await tick(); await tick();
  go.mockClear();
});
afterEach(() => { router.reset(); go.mockRestore(); toast.hide(); });

describe('Search screen', () => {
  it('has the box, the four chips with All picked, and Android\'s status texts', async () => {
    expect(box().placeholder).toBe(HINT);
    expect(document.activeElement).toBe(box());
    expect([...root.querySelectorAll('.s-chip')].map((c) => c.textContent)).toEqual(CHIPS);
    expect(chip(0).classList.contains('on')).toBe(true);
    expect(status()).toBe(IDLE);
  });

  it('says "Getting your library ready…" until every list is in, then "Searching…" while one is missing', () => {
    expect(statusText('', [true, false, true], [0, 0, 0])).toBe(LOADING);
    expect(statusText('bb', [true, false, true], [0, 0, 0])).toBe(SEARCHING);
    expect(statusText('bb', [true, false, true], [2, 0, 0])).toBe('');
    expect(statusText('bb', [true, true, true], [0, 0, 0])).toBe('No results for "bb"');
    expect(statusText('b', [true, true, true], [0, 0, 0])).toBe(IDLE);
  });

  it('needs two characters (one is ignored)', async () => {
    await type('b');
    expect(sections()).toEqual([]);
    expect(status()).toBe(IDLE);
    await type('bb');
    expect(sections().map((s) => s.slot)).toEqual([0]);
  });

  it('All: a shelf per section with hits, in the order Channels, Movies, Series, headed "Movies  ·  N"', async () => {
    await type('spider');
    expect(sections()).toEqual([
      { slot: 1, grid: false, title: 'Movies  ·  2', names: ['Spider-Man', 'The Amazing Spider-Man'] },
      { slot: 2, grid: false, title: 'Series  ·  1', names: ['Spider-Man: The Series'] },
    ]);
    expect(status()).toBe('');
  });

  it('All with hits in only one section lays that section out as the full grid', async () => {
    await type('bbc');
    const s = sections();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ slot: 0, grid: true, title: 'Channels  ·  3' });
  });

  it('each chip shows only its own section, as a grid', async () => {
    await type('spider');
    chip(3).click(); await tick(); await tick();
    expect(chip(3).classList.contains('on')).toBe(true);
    expect(sections()).toEqual([{ slot: 2, grid: true, title: 'Series  ·  1', names: ['Spider-Man: The Series'] }]);
    chip(2).click(); await tick(); await tick();
    expect(sections().map((s) => [s.slot, s.grid])).toEqual([[1, true]]);
    chip(1).click(); await tick(); await tick();
    expect(sections()).toEqual([]);
    expect(status()).toBe('No results for "spider"');
    chip(0).click(); await tick(); await tick();
    expect(sections().map((s) => [s.slot, s.grid])).toEqual([[1, false], [2, false]]);
  });

  it('shelves stop at 40 and grids at 120, with "+" in the heading', async () => {
    expect(heading(1, 40, MAX)).toBe('Movies  ·  40+');
    expect(heading(0, 39, MAX)).toBe('Channels  ·  39');
    expect(heading(2, 120, GRID_MAX)).toBe('Series  ·  120+');
    MOVIES.length = 0;
    for (let i = 0; i < 150; i++) MOVIES.push(M(`m${i}`, `Star ${i}`));
    SERIES.push(S('s1', 'Star Trek'));
    await type('star');
    expect(sections().map((s) => s.title)).toEqual(['Movies  ·  40+', 'Series  ·  1']);
    expect(root.querySelectorAll('[data-slot="1"] .card')).toHaveLength(40);
    chip(2).click(); await tick(); await tick();
    expect(sections()[0].title).toBe('Movies  ·  120+');
    expect(root.querySelectorAll('.card')).toHaveLength(120);
  });

  it('grid columns follow Cards.grid (6 posters / 5 channels across 1920 px)', () => {
    expect(gridColumns('poster')).toBe(6);
    expect(gridColumns('channel')).toBe(5);
  });

  it('shows "No results for "q"" when nothing matches', async () => {
    await type('ZZZ');
    expect(sections()).toEqual([]);
    expect(status()).toBe('No results for "zzz"');
  });

  it('leaves out channels from hidden countries', async () => {
    await type('bbc');
    expect(sections()[0].names).toContain('FR: BBC Monde');
    filters.setHiddenTags(new Set(['FR']));
    await type('bbc ');
    await type('bbc');
    expect(sections()[0].names).toEqual(['BBC One', 'bbc Two']);
  });

  it('channels are CHANNEL cards, movies and series POSTER cards', async () => {
    await type('spider');
    expect(root.querySelector('[data-slot="1"] .card').classList.contains('poster')).toBe(true);
    await type('bbc');
    expect(root.querySelector('[data-slot="0"] .card').classList.contains('channel')).toBe(true);
  });

  it('OK (on release) opens a channel in the player with the hit list as the zap list', async () => {
    await type('bbc');
    const cards = root.querySelectorAll('.card');
    cards[1].focus();
    expect(key(13)).toBe(true);
    keyup(13);
    const hits = LIVE.filter((c) => /bbc/i.test(c.name));
    expect(go).toHaveBeenCalledWith('player-live', { channels: [hits[0], hits[1], hits[2]], index: 1 });
  });

  it('opens movies and series on their pages', async () => {
    await type('heat');
    root.querySelector('.card').click();
    expect(go).toHaveBeenCalledWith('movie-detail', { item: MOVIES[1] });
    go.mockClear();
    router.back(); await tick(); await tick();
    await type('breaking');
    root.querySelector('.card').click();
    expect(go).toHaveBeenCalledWith('series-detail', { item: SERIES[0] });
  });

  it('Hold OK and Menu toggle the favourite with a toast', async () => {
    vi.useFakeTimers();
    try {
      box().value = 'heat'; box().dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(400);
      const c = root.querySelector('.card');
      c.focus();
      key(13);
      await vi.advanceTimersByTimeAsync(500);
      keyup(13);
      expect(store.isFav(MOVIES[1])).toBe(true);
      expect(toast.current()).toBe('Added to Favourites — Heat');
      expect(go).not.toHaveBeenCalled();
      key(10133);
      expect(store.isFav(MOVIES[1])).toBe(false);
      expect(toast.current()).toBe('Removed from Favourites — Heat');
    } finally { vi.useRealTimers(); }
  });

  it('IME Done / Enter searches at once and moves to the first result', async () => {
    box().value = 'spider';
    key(65376);
    await tick(); await tick(); await tick();
    expect(document.activeElement.textContent).toBe('Spider-Man');
  });

  it('Back in the box goes to the first result, or the Search tab with none', async () => {
    await type('heat');
    box().focus();
    expect(key(10009)).toBe(true);
    expect(document.activeElement.classList.contains('card')).toBe(true);
    await type('zzzz');
    box().focus();
    key(65385);
    expect(document.activeElement.dataset.tab).toBe('search');
  });

  it('OK on the Search tab jumps back into the box', async () => {
    root.querySelector('[data-tab="search"]').focus();
    root.querySelector('[data-tab="search"]').click();
    expect(document.activeElement).toBe(box());
  });

  it('reads the saved library, never the provider', async () => {
    router.reset();
    const { seedLibrary } = await import('./helpers.js');
    const repo = await import('../js/repo.js');
    repo._reset();
    seedLibrary({ live: [L('x1', 'Saved One')] });
    api.streams.mockClear();
    router.init(root); router.register('search', searchView);
    router.go('search', {});
    await type('saved');
    expect(sections()[0].names).toEqual(['Saved One']);
    expect(api.streams).not.toHaveBeenCalled();
  });

  it('keeps the query, chip and focused card when you come back from a details page', async () => {
    await type('spider');
    chip(2).click(); await tick(); await tick();
    const params = router.current().params;
    root.querySelectorAll('.card')[1].focus();
    router.go('movie-detail', { item: MOVIES[3] });
    router.back();
    await tick(); await tick(); await tick();
    expect(router.current().params).toBe(params);
    expect(box().value).toBe('spider');
    expect(chip(2).classList.contains('on')).toBe(true);
    expect(document.activeElement.querySelector('.title').textContent).toBe('The Amazing Spider-Man');
  });

  it('shows the Search tour (two tips) when the tutorial is on', async () => {
    router.reset();
    coach.restart();
    localStorage.setItem('coach_seen_home', 'true');
    vi.useFakeTimers();
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 110, bottom: 60, width: 100, height: 50 });
    try {
      router.init(root); router.register('search', searchView);
      router.go('search', {});
      await vi.advanceTimersByTimeAsync(1000);
      const card = document.querySelector('.coach-card');
      expect(card.querySelector('.coach-title').textContent).toBe('Search everything');
      expect(card.querySelector('.coach-counter').textContent).toBe('TIP 1 OF 2');
      window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13 }));
      expect(card.querySelector('.coach-title').textContent).toBe('Narrow it down');
    } finally { vi.useRealTimers(); rect.mockRestore(); }
  });
});

describe('fuzzy ranking (Match.rank, as Search uses it)', () => {
  const items = (...names) => names.map((n, i) => M(String(i), n));
  const rank = (list, q, max = 40) => match.rank(list, q, max).map((m) => m.name);

  it('exact > starts with > words together > word starts > contained; ties go to the shorter name', () => {
    const list = items('Spidery Woman', 'Megaspiderman', 'Spiderman Returns', 'Man of Steel Spider', 'The Amazing Spider-Man',
      'Spider-Man 2', 'UK: Spider-Man', 'Spider-Man', 'Batman');
    expect(rank(list, 'spider man')).toEqual([
      'Spider-Man', 'UK: Spider-Man', // 1000: the whole name (with or without the tag), shorter first
      'Spider-Man 2', 'Spiderman Returns', // 900: starts with it
      'The Amazing Spider-Man', // 800 - 2: the words together, in order
      'Man of Steel Spider', // 600: every word starts a word
      'Megaspiderman', // 400: contained
      'Spidery Woman', // 200: the letters are all there
    ]);
  });

  it('ignores spaces, dashes and accents, and words can come in any order', () => {
    const list = items('Pokémon Detective', 'Spider-Man');
    expect(rank(list, 'pokemon')).toEqual(['Pokémon Detective']);
    expect(rank(list, 'spiderman')).toEqual(['Spider-Man']);
    expect(rank(list, 'man spider')).toEqual(['Spider-Man']);
    expect(rank(list, 'spider  -  man')).toEqual(['Spider-Man']);
  });

  it('a provider tag in front does not hide a better match: "premier sports" finds UK: Premier Sports 1 first', () => {
    const list = items('Sky Sports Premier League', 'UK: Premier Sports 1');
    expect(rank(list, 'premier sports')).toEqual(['UK: Premier Sports 1', 'Sky Sports Premier League']);
  });

  it('earlier phrases beat later ones; the provider order breaks exact ties', () => {
    const list = items('Watch The Office Now', 'The Office Hours', 'Best of The Office Hours');
    expect(rank(list, 'office ho')).toEqual(['The Office Hours', 'Best of The Office Hours']);
    expect(rank(items('ab x', 'ab y'), 'ab')).toEqual(['ab x', 'ab y']);
  });

  it('rankSection returns null before the list is loaded and caps at max', async () => {
    expect(await rankSection('movie', 'ab', 40, null)).toBe(null);
    const many = Array.from({ length: 50 }, (_, i) => M(String(i), `Abc ${i}`));
    expect(await rankSection('movie', 'abc', 40, many)).toHaveLength(40);
  });
});
