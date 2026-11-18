// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({ streams: vi.fn(), categories: vi.fn(async () => []) }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as top10 from '../js/top10.js';
import { router } from '../js/router.js';
import { homeView, deltaToShow, _memo } from '../js/views/home.js';
import * as rows from '../js/home-rows.js';
import * as toast from '../js/ui/toast.js';

let root;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
const rowKeys = () => [...root.querySelectorAll('.home-row')].map((r) => r.dataset.row);
const titles = () => [...root.querySelectorAll('.home-row .shelf-title')].map((h) => h.firstChild.textContent);
const ids = (k) => [...root.querySelectorAll(`.home-row[data-row="${k}"] [data-tile]`)].map((t) => t.dataset.item);
const card = (k, i = 0) => root.querySelectorAll(`.home-row[data-row="${k}"] [data-tile]`)[i];
const stub = () => ({ mount() {}, unmount() {} });
const key = (keyCode, type = 'keydown', extra = {}) => {
  const e = new KeyboardEvent(type, { keyCode, bubbles: true, cancelable: true, ...extra });
  Object.defineProperty(e, 'keyCode', { value: keyCode });
  return e;
};
/** The app routes keydown to the active view first (app.js). */
const press = (keyCode, extra) => { const e = key(keyCode, 'keydown', extra); router.onKey(e); return e; };
const release = (keyCode) => document.dispatchEvent(key(keyCode, 'keyup'));
const MENU = 10133;

const M = (id, added) => ({ type: 'movie', id, name: `M${id}`, added });
const L = (id) => ({ type: 'live', id, name: `Channel ${id}` });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('coach_asked', 'true'); // no tutorial offer over the tests
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
afterEach(() => { router.reset(); toast.hide(); document.querySelectorAll('.dialog-scrim').forEach((d) => d.remove()); });

describe('home rows (HomeActivity.buildLocalRows / buildRemoteRows)', () => {
  it('every row in Android order with Android titles and card shapes', async () => {
    const ep = { type: 'episode', id: 'e1', name: 'Pilot', parentName: 'Show' };
    store.addHistory(ep); store.setPosition(ep, 60000);
    store.addHistory(L('9'));
    store.toggleFav(L('c1'));
    store.toggleFav({ type: 'movie', id: 'f1', name: 'Fav' });
    store.toggleFav({ type: 'series', id: 'fs', name: 'FavS' });
    top10.setFetch(async () => ({ status: 200, headers: { get: () => null }, text: async () => 'country_iso2\tweek\tcategory\tweekly_rank\tshow_title\nGB\t2026-11-01\tFilms (English)\t1\tM3\nGB\t2026-11-01\tTV (English)\t1\tS2\n' }));
    router.go('home');
    await settle(12);
    expect(rowKeys()).toEqual(['continue', 'recent', 'fav_live', 'fav_movie', 'fav_series', 'top_movies', 'top_series', 'new_movies', 'new_series']);
    expect(titles()).toEqual(['Continue Watching', 'Recent Channels', 'Favourite Channels', 'Favourite Movies', 'Favourite Series',
      'Top 10 Movies on Netflix UK', 'Top 10 Series on Netflix UK', 'Recently Added Movies', 'Recently Added Series']);
    const shapes = rowKeys().map((k) => card(k).classList[1]);
    expect(shapes).toEqual(['landscape', 'channel', 'channel', 'poster', 'poster', 'poster', 'poster', 'poster', 'poster']);
    // local rows first, remote rows after, in their own containers
    expect(root.querySelector('.home-local').children).toHaveLength(5);
    expect(root.querySelector('.home-remote').children).toHaveLength(4);
  });

  it('only non-empty rows whose Settings toggle is on', async () => {
    store.toggleFav(L('c1'));
    store.toggleFav({ type: 'movie', id: 'f1', name: 'Fav' });
    router.go('home');
    await settle();
    expect(rowKeys()).toEqual(['fav_live', 'fav_movie', 'new_movies', 'new_series']);
    store.setHomeShows('fav_movie', false);
    store.setHomeShows('new_series', false);
    router.go('home');
    await settle();
    expect(rowKeys()).toEqual(['fav_live', 'new_movies']);
  });

  it('Continue Watching = VOD history with a resume point, newest first, with the hint in the title', async () => {
    const a = M('a'); const b = M('b'); const c = M('c');
    store.addHistory(a); store.addHistory(b); store.addHistory(c);
    store.setPosition(a, 5000); store.setPosition(c, 9000);
    router.go('home');
    await settle();
    expect(ids('continue')).toEqual(['c', 'a']);
    const h = root.querySelector('.home-row[data-row="continue"] .shelf-title');
    expect(h.querySelector('.shelf-hint').textContent).toBe('      Hold OK for options');
  });

  it('Recent Channels shows the newest 20 of the live history', async () => {
    for (let i = 0; i < 30; i++) store.addHistory(L(String(i)));
    router.go('home');
    await settle();
    expect(ids('recent')).toHaveLength(20);
    expect(ids('recent')[0]).toBe('29');
  });

  it('Recently Added takes the newest 300, keeps 24, newest first', async () => {
    api.streams.mockImplementation(async (t) => (t === 'movie' ? Array.from({ length: 400 }, (_, i) => M(String(i), String(i))) : []));
    router.go('home');
    await settle();
    const got = ids('new_movies');
    expect(got).toHaveLength(24);
    expect(got.slice(0, 3)).toEqual(['399', '398', '397']);
    expect(rowKeys()).not.toContain('new_series');
  });

  it('the Recently Added filter hook (Filters.items) runs on the newest 300 before the cut to 24', async () => {
    api.streams.mockImplementation(async (t) => (t === 'movie' ? Array.from({ length: 40 }, (_, i) => M(String(i), String(i))) : []));
    const seen = [];
    rows.setFilter((type, list) => { seen.push([type, list.length]); return list.filter((m) => Number(m.id) % 2 === 0); });
    try {
      router.go('home');
      await settle();
      expect(seen).toContainEqual(['movie', 40]);
      expect(ids('new_movies').every((id) => Number(id) % 2 === 0)).toBe(true);
    } finally { rows.setFilter(null); }
  });
});

describe('Continue Watching cards (Cards.shelf LANDSCAPE)', () => {
  it('progress pos/dur and "… left" for a movie', async () => {
    const m = { ...M('m'), icon: 'http://x/m.jpg' };
    store.addHistory(m); store.setDuration(m, 6000000); store.setPosition(m, 1500000);
    router.go('home');
    await settle();
    const c = card('continue');
    expect(c.querySelector('.progress > i').style.width).toBe('25%');
    expect(c.querySelector('.sub').textContent).toBe('1:15:00 left');
    expect(c.dataset.art).toBe('http://x/m.jpg');
  });

  it('an episode shows "<series>  ·  m:ss left" and borrows the series art', async () => {
    const ep = { type: 'episode', id: 'e', name: 'Episode 3', parentName: 'The Show', parentIcon: 'http://x/show.jpg' };
    store.addHistory(ep); store.setDuration(ep, 1800000); store.setPosition(ep, 1000000);
    router.go('home');
    await settle();
    const c = card('continue');
    expect(c.querySelector('.sub').textContent).toBe('The Show  ·  13:20 left');
    expect(c.querySelector('img').getAttribute('src')).toBe('http://x/show.jpg');
  });

  it('no duration yet: no subtitle, no bar, initials when there is no art', async () => {
    const m = { type: 'movie', id: 'n', name: 'night: watch' };
    store.addHistory(m); store.setPosition(m, 20000);
    router.go('home');
    await settle();
    const c = card('continue');
    expect(c.querySelector('.sub')).toBeNull();
    expect(c.querySelector('.progress')).toBeNull();
    expect(c.querySelector('.initials').textContent).toBe('NW');
  });

  it('fmt and joinNonEmpty follow SeriesActivity.fmt / XtreamApi.joinNonEmpty', () => {
    expect(rows.fmt(59000)).toBe('0:59');
    expect(rows.fmt(3599000)).toBe('59:59');
    expect(rows.fmt(3600000)).toBe('1:00:00');
    expect(rows.joinNonEmpty(null, ' a ', '', 'null', 'b')).toBe('a  ·  b');
    expect(rows.joinNonEmpty('', null)).toBeNull();
  });
});

describe('opening cards (Open.item)', () => {
  it('a Continue Watching movie opens its details, not the player', async () => {
    const a = M('a'); store.addHistory(a); store.setPosition(a, 50000);
    router.go('home'); await settle();
    card('continue').click();
    expect(router.current().name).toBe('movie-detail');
    expect(router.current().params.item.id).toBe('a');
  });

  it('a Continue Watching episode goes straight into the player, alone in the queue (it resumes by itself)', async () => {
    const ep = { type: 'episode', id: 'e', name: 'E', parentName: 'S' };
    store.addHistory(ep); store.setPosition(ep, 90000);
    router.go('home'); await settle();
    card('continue').click();
    const cur = router.current();
    expect(cur.name).toBe('player-vod');
    expect(cur.params).toEqual({ queue: [expect.objectContaining({ id: 'e' })], index: 0 }); // Open.play(q, 0)
  });

  it('an episode opens through Open.play with no start time: PlayerActivity decides (> 10 s resumes)', () => {
    const ep = { type: 'episode', id: 'e' };
    store.setPosition(ep, 8000);
    expect(rows.openTarget(ep)).toEqual({ name: 'player-vod', params: { queue: [ep], index: 0 } });
  });

  it('a recent channel zaps through the whole Recent list; a favourite-only one through Favourite Channels', async () => {
    for (let i = 0; i < 25; i++) store.addHistory(L(String(i)));
    store.toggleFav(L('fav'));
    router.go('home'); await settle();
    card('recent', 2).click();
    let cur = router.current();
    expect(cur.name).toBe('player-live');
    expect(cur.params.channels).toHaveLength(25); // Prefs.history(true), not the 20 shown
    expect(cur.params.index).toBe(2);
    router.back(); await settle();
    card('fav_live').click();
    cur = router.current();
    expect(cur.params.channels.map((c) => c.id)).toEqual(['fav']);
    expect(cur.params.index).toBe(0);
  });

  it('a channel in neither list plays alone; series open the series screen; movies the movie screen', () => {
    expect(rows.openTarget(L('x'), null).params).toEqual({ channels: [L('x')], index: 0 });
    expect(rows.openTarget({ type: 'series', id: 's' }).name).toBe('series-detail');
    expect(rows.openTarget(M('m')).name).toBe('movie-detail');
  });

  it('a short OK opens the card on release', async () => {
    store.toggleFav({ type: 'series', id: 'sx', name: 'SX' });
    router.go('home'); await settle();
    expect(document.activeElement).toBe(card('fav_series'));
    press(13); release(13);
    expect(router.current().name).toBe('series-detail');
  });
});

describe('hold OK / ☰ on Home cards', () => {
  const menuItems = () => [...document.querySelectorAll('.dialog-item')].map((b) => b.textContent);
  const choose = async (label) => {
    [...document.querySelectorAll('.dialog-item')].find((b) => b.textContent === label).click();
    await settle();
  };

  it('Hold OK on a favourite channel removes it straight away with the Android toast and keeps focus on that shelf', async () => {
    vi.useFakeTimers();
    try {
      ['1', '2', '3'].forEach((id) => store.toggleFav({ type: 'live', id, name: `Channel ${id}` }));
      router.go('home');
      await vi.advanceTimersByTimeAsync(10);
      card('fav_live', 1).focus();
      press(13);
      await vi.advanceTimersByTimeAsync(450);
      release(13);
      expect(document.querySelector('.dialog')).toBeNull(); // channels have no menu
      expect(toast.current()).toBe('Removed from Favourites — Channel 2');
      expect(ids('fav_live')).toEqual(['1', '3']);
      expect(document.activeElement).toBe(card('fav_live', 1));
      expect(router.current().name).toBe('home'); // the release after a hold does not open anything
    } finally { vi.useRealTimers(); }
  });

  it('☰ on a film opens its options: Favourite, Queue, Watched (ItemMenu)', async () => {
    router.go('home'); await settle();
    const c = card('new_movies');
    c.focus();
    press(MENU);
    expect(document.querySelector('.dialog-title').textContent).toBe('M3');
    expect(menuItems()).toEqual(['♡  Add to Favourites', '＋  Add to Queue', '✓  Mark as Watched']);
    await choose('♡  Add to Favourites');
    expect(toast.current()).toBe('Added to Favourites — M3');
    expect(ids('fav_movie')).toEqual(['3']);
    expect(document.activeElement).toBe(card('new_movies')); // a remote row keeps its place
  });

  it('Hold OK on a "Because you watched" card: Don\'t recommend based on it hides the row and remembers it', async () => {
    router.go('home'); await settle();
    _memo().recRows = [{ title: 'Because you watched Heat', items: [M('1'), M('2'), M('3')], sourceKey: 'movie:9', sourceName: 'Heat' }];
    router.go('settings'); router.back(); await settle();
    expect(titles()).toContain('Because you watched Heat');
    expect(root.querySelector('.home-row[data-row="rec_0"] .shelf-title').textContent).toContain('Hold OK for options');
    card('rec_0', 1).focus();
    press(MENU);
    expect(document.querySelector('.dialog-title').textContent).toBe('Because you watched Heat');
    expect(menuItems()).toEqual(['Options for M2…', "Don't recommend based on Heat"]);
    await choose("Don't recommend based on Heat");
    expect(store.recBlocked('movie:9')).toBe(true);
    expect(toast.current()).toBe("You won't see recommendations based on Heat");
    expect(titles()).not.toContain('Because you watched Heat');
  });

  it('"Options for …" on a Because you watched card is the usual menu', async () => {
    router.go('home'); await settle();
    _memo().recRows = [{ title: 'Because you watched Heat', items: [M('1'), M('2'), M('3')], sourceKey: 'movie:9', sourceName: 'Heat' }];
    router.go('settings'); router.back(); await settle();
    card('rec_0').focus();
    press(MENU);
    await choose('Options for M1…');
    expect(menuItems()).toEqual(['♡  Add to Favourites', '＋  Add to Queue', '✓  Mark as Watched']);
  });

  it('Add to Queue: a "Your Queue" row under Continue Watching, with the hint; Remove takes it out', async () => {
    router.go('home'); await settle();
    card('new_movies').focus();
    press(MENU);
    await choose('＋  Add to Queue');
    expect(toast.current()).toBe('Added to your Queue — M3');
    expect(store.queue().map((q) => q.id)).toEqual(['3']);
    expect(rowKeys()[0]).toBe('queue');
    const h = root.querySelector('.home-row[data-row="queue"] .shelf-title');
    expect(h.textContent).toBe('Your Queue      Hold OK for options');
    card('queue').focus();
    press(MENU);
    expect(menuItems()).toEqual(['♡  Add to Favourites', '−  Remove from Queue', '✓  Mark as Watched']);
    await choose('−  Remove from Queue');
    expect(store.queue()).toEqual([]);
    expect(rowKeys()).not.toContain('queue');
  });

  it('Mark as Watched: a ✓ on the card, off Continue Watching and out of the queue', async () => {
    const m = M('3'); // also in Recently Added
    store.addHistory(m); store.setPosition(m, 30000); store.queueAdd(m);
    router.go('home'); await settle();
    expect(card('new_movies').querySelector('.watched-badge')).toBeNull();
    card('continue').focus();
    press(MENU);
    expect(menuItems()).toEqual(['♡  Add to Favourites', '−  Remove from Queue', '✓  Mark as Watched', '✕  Remove from Continue Watching']);
    await choose('✓  Mark as Watched');
    expect(store.isWatched(m)).toBe(true);
    expect(store.position(m)).toBe(0);
    expect(store.queue()).toEqual([]);
    expect(rowKeys()).not.toContain('continue');
    router.go('home'); await settle();
    expect(card('new_movies').querySelector('.watched-badge').textContent).toBe('✓');
    card('new_movies').focus();
    press(MENU);
    expect(menuItems()).toContain('○  Mark as Unwatched');
  });

  it('removing the last favourite moves focus to the shelf that took its place', async () => {
    store.toggleFav({ type: 'movie', id: 'only', name: 'Only' });
    store.toggleFav({ type: 'series', id: 's', name: 'Series' });
    router.go('home'); await settle();
    card('fav_movie').focus();
    press(MENU);
    await choose('♥  Remove from Favourites');
    expect(rowKeys()).not.toContain('fav_movie');
    expect(document.activeElement).toBe(card('fav_series'));
  });

  it('an episode in Continue Watching: "Series  ·  Episode" options without Favourite; Remove takes it off the list', async () => {
    const ep = { type: 'episode', id: 'e', name: 'Pilot', parentName: 'Show' };
    const m = M('m');
    store.addHistory(m); store.setPosition(m, 30000);
    store.addHistory(ep); store.setPosition(ep, 30000);
    router.go('home'); await settle();
    card('continue').focus();
    press(MENU);
    expect(document.querySelector('.dialog-title').textContent).toBe('Show  ·  Pilot');
    expect(menuItems()).toEqual(['＋  Add to Queue', '✓  Mark as Watched', '✕  Remove from Continue Watching']);
    await choose('✕  Remove from Continue Watching');
    expect(store.position(ep)).toBe(0);
    expect(ids('continue')).toEqual(['m']);
    expect(document.activeElement).toBe(card('continue'));
  });

  it('Back out of the menu leaves everything alone', async () => {
    const m = M('m'); store.addHistory(m); store.setPosition(m, 30000);
    router.go('home'); await settle();
    card('continue').focus();
    press(MENU);
    press(10009);
    document.dispatchEvent(new Event('back'));
    await settle();
    expect(store.position(m)).toBe(30000);
    expect(ids('continue')).toEqual(['m']);
  });

  it('the next episode after one you finished sits in Continue Watching as "Next episode"', async () => {
    const ep = { type: 'episode', id: 'e2', name: 'Two', parentName: 'Show', parentId: '9' };
    store.markUpNext(ep);
    router.go('home'); await settle();
    expect(ids('continue')).toEqual(['e2']);
    expect(card('continue').querySelector('.sub').textContent).toBe('Show  ·  Next episode');
    store.setPosition(ep, 20000); // started: an ordinary entry from now on
    expect(store.isUpNext(ep)).toBe(false);
  });
});

describe('empty and loading states', () => {
  it('a new account with nothing watched: welcome text, focus on the Home tab', async () => {
    api.streams.mockImplementation(async () => []);
    router.go('home'); await settle();
    const p = root.querySelector('.home-empty');
    expect(p.hidden).toBe(false);
    expect(p.textContent).toBe('Welcome to YM Player\nPick Live TV, Movies or Series above to get started.');
    expect(document.activeElement.dataset.tab).toBe('home');
  });

  it('the welcome text goes once a row exists', async () => {
    router.go('home'); await settle();
    expect(root.querySelector('.home-empty').hidden).toBe(true);
  });
});

describe('focus and returning to Home', () => {
  it('focus starts on the first card of the first row, not the top bar', async () => {
    store.toggleFav(L('c1'));
    router.go('home'); await settle();
    expect(document.activeElement).toBe(card('fav_live'));
  });

  it('back from a card in a library row lands on the same card', async () => {
    store.toggleFav(L('c1'));
    router.go('home'); await settle();
    card('new_movies', 2).focus();
    card('new_movies', 2).click();
    expect(router.current().name).toBe('movie-detail');
    router.back(); await settle();
    expect(document.activeElement).toBe(card('new_movies', 2));
    expect(api.streams.mock.calls.filter((c) => c[0] === 'movie')).toHaveLength(1); // rows kept, not reloaded
  });

  it('back from a card in a local row goes to the first card (HomeActivity.onResume)', async () => {
    store.toggleFav(L('c1')); store.toggleFav(L('c2'));
    router.go('home'); await settle();
    card('fav_live', 1).click();
    router.back(); await settle();
    expect(document.activeElement).toBe(card('fav_live', 0));
  });

  it('back from a section opened from the bar lands on the Home tab (TopBar.onHomeResumed)', async () => {
    store.toggleFav(L('c1'));
    router.go('home'); await settle();
    root.querySelector('[data-tab="home"]').focus();
    root.querySelector('[data-tab="live"]').focus();
    root.querySelector('[data-tab="live"]').click();
    expect(router.current().name).toBe('live');
    router.back(); await settle();
    expect(document.activeElement.dataset.tab).toBe('home');
  });

  it('rows rebuild on return (history and favourites may have changed)', async () => {
    store.toggleFav(L('c1'));
    router.go('home'); await settle();
    card('fav_live').click();
    store.addHistory(L('c1'));
    router.back(); await settle();
    expect(ids('recent')).toEqual(['c1']);
  });

  it('a different account starts afresh', async () => {
    store.saveAccount({ id: '', server: 'http://a.tv', user: 'ann', pass: 'p', ok: true });
    router.go('home'); await settle();
    const before = _memo();
    store.saveAccount({ id: 'b', server: 'http://b.tv', user: 'bob', pass: 'p', ok: true });
    store.setCurrent('b');
    router.resetTo('home'); await settle();
    expect(_memo()).not.toBe(before);
    expect(_memo().acct).toContain('bob');
  });

  it('deltaToShow is ScrollView.computeScrollDeltaToGetChildRectOnScreen (no fading edge)', () => {
    expect(deltaToShow(100, 200, 0, 500, 1000)).toBe(0);    // already on screen
    expect(deltaToShow(450, 650, 0, 500, 1000)).toBe(150);  // just enough to show the end
    expect(deltaToShow(950, 1100, 0, 500, 300)).toBe(300);  // never past the end
    expect(deltaToShow(50, 150, 100, 500, 1000)).toBe(-50); // back to its start
    expect(deltaToShow(-10, 900, 0, 500, 1000)).toBe(0);    // taller than the screen and overlapping
  });
});

describe('Top 10 rows', () => {
  const tsv = (films, tv, week = '2026-11-01') => ['country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title',
    ...films.map((t, i) => `United Kingdom\tGB\t${week}\tFilms (English)\t${i + 1}\t${t}\tN/A`),
    ...tv.map((t, i) => `United Kingdom\tGB\t${week}\tTV (English)\t${i + 1}\t${t}\t${t}: Season 1`),
    `France\tFR\t${week}\tFilms (English)\t1\tM1\tN/A`].join('\n');
  const respond = (text) => async () => ({ status: 200, headers: { get: () => null }, text: async () => text });

  it('shows Netflix titles found in the library, in Netflix order, without any key', async () => {
    top10.setFetch(respond(tsv(['Not On Provider', 'M2', 'M1'], ['S2', 'S1'])));
    router.go('home'); await settle(12);
    expect(ids('top_movies')).toEqual(['2', '1']);
    expect(ids('top_series')).toEqual(['s2', 's1']);
  });

  it('a failed download shows no Top 10 rows and the rest of Home is unaffected', async () => {
    router.go('home'); await settle(12); // setup.js: Netflix is offline
    expect(rowKeys()).toEqual(['new_movies', 'new_series']);
    const saved = top10.load();
    expect(saved).toBeNull(); // nothing cached yet, so nothing to keep
  });

  it('the hourly check rebuilds only when the matched list changed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      vi.setSystemTime(new Date(2026, 10, 3, 12));
      top10.setFetch(respond(tsv(['M1'], [])));
      router.go('home'); await settle(12);
      const before = root.querySelector('.home-row[data-row="top_movies"]');
      expect(ids('top_movies')).toEqual(['1']);
      vi.setSystemTime(new Date(2026, 10, 12, 12)); // past the Tuesday after the next week: due
      top10.setFetch(respond(tsv(['M1'], [], '2026-11-08')));
      vi.advanceTimersByTime(60 * 60000);
      await settle(12);
      expect(root.querySelector('.home-row[data-row="top_movies"]')).toBe(before); // same list: not rebuilt
      vi.setSystemTime(new Date(2026, 10, 19, 12));
      top10.setFetch(respond(tsv(['M3', 'M1'], [], '2026-11-15')));
      vi.advanceTimersByTime(60 * 60000);
      await settle(12);
      expect(ids('top_movies')).toEqual(['3', '1']);
    } finally { vi.useRealTimers(); }
  });

  it('the Top 10 Settings toggles hide the rows', async () => {
    top10.setFetch(respond(tsv(['M1'], ['S1'])));
    store.setHomeShows('top_movies', false);
    router.go('home'); await settle(12);
    expect(rowKeys()).toEqual(['top_series', 'new_movies', 'new_series']);
  });
});

describe('home top bar', () => {
  it('shows the clock, Home is the current tab, and the bar scrolls with the rows', async () => {
    router.go('home');
    await tick();
    expect(root.querySelector('.tb-clock').textContent).toMatch(/^\d\d:\d\d$/);
    expect(root.querySelector('[data-tab="home"]').classList.contains('current')).toBe(true);
    const screen = root.querySelector('.section-home');
    expect(screen.hasAttribute('data-own-scroll')).toBe(true);
    expect(screen.contains(root.querySelector('[data-topbar]'))).toBe(true);
  });

  it.each([['live'], ['movies'], ['series'], ['search'], ['settings']])('tab %s routes there (pushed over Home)', async (name) => {
    router.go('home');
    await tick();
    root.querySelector(`[data-tab="${name}"]`).click();
    expect(router.current().name).toBe(name);
    expect(router.stackDepth()).toBe(2);
  });
});

describe('home library (HomeActivity.startLibrary)', () => {
  const signIn = () => store.saveAccount({ id: '', server: 'http://a.tv', user: 'ann', pass: 'p', ok: true });

  it('first run with nothing saved: shows the "getting ready" note, downloads once, then fills the rows', async () => {
    signIn();
    let done;
    api.categories.mockImplementationOnce(() => new Promise((r) => { done = r; }));
    router.go('home');
    await tick();
    expect(root.querySelector('.home-empty').textContent)
      .toBe('Getting your channels, movies and series ready…\nThis only takes a while the first time.');
    done([]);
    await settle(10);
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
    await settle();
    expect(ids('new_movies')).toEqual(['7']);
    expect(api.streams).not.toHaveBeenCalled();
    api.streams.mockImplementation(async (t) => (t === 'movie' ? [M('8', '800'), M('7', '700')] : []));
    await repo.downloadType('movie');
    await settle();
    expect(ids('new_movies')).toEqual(['8', '7']);
  });
});
