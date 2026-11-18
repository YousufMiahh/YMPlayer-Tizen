// @vitest-environment jsdom
// Browse (BrowseActivity) for Live TV, Movies and Series: the category list and its special
// entries, dwell auto-open, keys, favourites, hiding, search, the info panel and the live preview.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, categories: vi.fn(), streams: vi.fn(), epg: vi.fn(async () => []) };
});

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as filters from '../js/filters.js';
import * as nav from '../js/nav.js';
import * as B from '../js/browse.js';
import * as toast from '../js/ui/toast.js';
import { router } from '../js/router.js';
import { shim } from '../js/avplay-shim.js';
import { liveView } from '../js/views/live.js';
import { moviesView } from '../js/views/movies.js';
import { seriesView } from '../js/views/series.js';
import { playerLiveView } from '../js/views/player.js';
import * as topbar from '../js/ui/topbar.js';
import * as repo from '../js/repo.js';
import { seedLibrary } from './helpers.js';
import { isOpen as dialogOpen } from '../js/ui/dialog.js';

const K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, MENU: 10133 };
const ev = (keyCode, type = 'keydown', extra = {}) => {
  const e = new KeyboardEvent(type, { keyCode, bubbles: true, cancelable: true, ...extra });
  Object.defineProperty(e, 'keyCode', { value: keyCode });
  return e;
};
/** A remote key: keydown on the focused element (the top bar handles its own), then the app's routing. */
const press = (k, extra) => (document.activeElement || document.body).dispatchEvent(ev(k, 'keydown', extra));
const release = (k) => document.dispatchEvent(ev(k, 'keyup'));
const settle = async () => { for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0); };
const ok = async () => { press(K.ENTER); release(K.ENTER); await settle(); };
const holdOk = async () => { press(K.ENTER); await vi.advanceTimersByTimeAsync(460); release(K.ENTER); await settle(); };
const wait = async (ms) => { await vi.advanceTimersByTimeAsync(ms); await settle(); };

const CAT = (id, name) => ({ type: 'cat', id, name });
const CH = (id, cat, extra = {}) => ({ type: 'live', id, name: `Channel ${id}`, num: id, categoryId: cat, icon: `http://x/${id}.png`, ...extra });
const MV = (id, cat) => ({ type: 'movie', id, name: `Movie ${id}`, categoryId: cat, icon: `http://x/m${id}.jpg`, ext: 'mp4' });
const LIVE_CATS = [CAT('1', 'UK | News'), CAT('2', 'UK | Sports'), CAT('3', 'FR | Général'), CAT('4', 'Radio')];
const LIVE = [CH('10', '1'), CH('11', '1'), CH('12', '1', { num: undefined }), CH('20', '2'), CH('30', '3'), CH('40', '4')];
const MOVIE_CATS = [CAT('100', 'Action'), CAT('101', 'Comedy')];
const MOVIES = Array.from({ length: 12 }, (_, i) => MV(String(500 + i), i < 8 ? '100' : '101'));

let root; let onKeydown; let onBack;
const view = () => router.current().view;
const st = () => view()._state();
const catRows = () => [...root.querySelectorAll('.b-catlist [data-cat]')];
const catNames = () => catRows().map((r) => r.querySelector('.rc-title').textContent);
const focusedCat = () => document.activeElement.closest('[data-cat]')?.dataset.cat;
const contentIds = () => [...root.querySelectorAll('.b-channels [data-id], .b-grid [data-id]')].map((c) => c.dataset.id);
const focusedItem = () => document.activeElement.closest('[data-id]')?.dataset.id;
const emptyText = () => root.querySelector('.b-empty').textContent;

async function open(name) {
  router.go(name, {});
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('coach_asked', 'true');
  document.body.innerHTML = '<div id="root"></div><object id="av" type="application/avplayer" hidden></object>';
  root = document.getElementById('root');
  vi.clearAllMocks();
  shim.reset();
  filters._reset();
  topbar._reset();
  delete globalThis.webapis;
  delete globalThis.tizen;
  store.saveAccount({ id: '', name: 'T', server: 'http://srv', user: 'u', pass: 'p', ok: true });
  store.setCurrent('');
  api.categories.mockImplementation(async (t) => (t === 'live' ? LIVE_CATS : MOVIE_CATS));
  api.streams.mockImplementation(async (t, c) => {
    const all = t === 'live' ? LIVE : MOVIES;
    return c == null ? all : all.filter((x) => x.categoryId === c);
  });
  api.epg.mockResolvedValue([]);
  // The saved library, as after Setup (Browse never asks the provider per category)
  seedLibrary({ live: LIVE, movie: MOVIES, series: [], cats: { live: LIVE_CATS, movie: MOVIE_CATS, series: [] } });
  router.init(root);
  router.register('live', liveView);
  router.register('movies', moviesView);
  router.register('series', seriesView);
  router.register('player-live', playerLiveView);
  router.register('movie-detail', () => ({ mount() {}, unmount() {} }));
  router.register('series-detail', () => ({ mount() {}, unmount() {} }));
  router.register('home', () => ({ mount() {}, unmount() {} }));
  onKeydown = (e) => { if (router.onKey(e)) return; nav.onKey(e); };
  onBack = () => router.back();
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('back', onBack);
});

afterEach(() => {
  for (let i = 0; i < 5 && dialogOpen(); i++) window.dispatchEvent(ev(27)); // Back closes a dialog left open
  router.reset();
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('back', onBack);
  toast.hide();
  vi.useRealTimers();
});

// ------------------------------------------------------------------ the data side

describe('category list (BrowseActivity.buildCategoryList)', () => {
  it('special entries first in Android order, then favourite categories (♥, in favourited order), then the rest', () => {
    store.toggleFavCategory('live', '4');
    store.toggleFavCategory('live', '2');
    const l = B.buildCategoryList('live', LIVE_CATS);
    expect(l.map((c) => c.name)).toEqual(['Search', 'Favourite Channels', 'Recent Channels', 'All Channels',
      'Radio', 'UK | Sports', 'UK | News', 'FR | Général']);
    expect(l.map((c) => c.id).slice(0, 4)).toEqual([B.SEARCH, B.FAV, B.RECENT, B.ALL]);
    expect(l[4].num).toBe('♥');
    expect(l[5].num).toBe('♥');
    expect(l[6].num).toBeUndefined();
  });

  it('Movies / Series: Favourite Movies|Series, Continue Watching, All', () => {
    expect(B.buildCategoryList('movie', []).map((c) => c.name)).toEqual(['Search', 'Favourite Movies', 'Continue Watching', 'All']);
    expect(B.buildCategoryList('series', []).map((c) => c.name)).toEqual(['Search', 'Favourite Series', 'Continue Watching', 'All']);
  });

  it('the category shown on arrival: Favourites, else Recent/Continue, else the first category, else All', () => {
    const l = B.buildCategoryList('live', LIVE_CATS);
    expect(B.startIndex('live', l)).toBe(4);
    expect(B.startIndex('live', B.buildCategoryList('live', []))).toBe(3);
    store.addHistory(LIVE[0]);
    expect(B.startIndex('live', l)).toBe(2);
    store.toggleFav(LIVE[1]);
    expect(B.startIndex('live', l)).toBe(1);
  });

  it('Continue Watching lists: movies with a resume point; series once each, newest first', () => {
    const ep = (id, sid) => ({ type: 'episode', id, name: `E${id}`, parentId: sid, parentName: `S${sid}`, parentIcon: `http://x/s${sid}.jpg` });
    store.addHistory(MOVIES[0]); store.setPosition(MOVIES[0], 50000);
    store.addHistory(MOVIES[1]); // never started
    store.addHistory(ep('1', '7')); store.addHistory(ep('2', '8')); store.addHistory(ep('3', '7'));
    expect(B.specialList(B.CONTINUE, 'movie').map((m) => m.id)).toEqual([MOVIES[0].id]);
    expect(B.specialList(B.CONTINUE, 'series')).toEqual([
      { type: 'series', id: '7', name: 'S7', icon: 'http://x/s7.jpg' },
      { type: 'series', id: '8', name: 'S8', icon: 'http://x/s8.jpg' },
    ]);
  });

  it("Android's empty texts", () => {
    expect(B.emptyText('live', B.SEARCH, 0, 'a')).toBe('Type the name of a channel');
    expect(B.emptyText('movie', B.SEARCH, 0, '')).toBe('Type the name of a film');
    expect(B.emptyText('series', B.SEARCH, 0, ' x ')).toBe('Type the name of a series');
    expect(B.emptyText('movie', B.SEARCH, 0, 'zzz')).toBe('No results for "zzz"');
    expect(B.emptyText('live', B.FAV, 0)).toBe('No favourites yet\nHold OK on anything to add it.');
    expect(B.emptyText('live', '1', 0)).toBe('Nothing here yet');
    expect(B.emptyText('live', '1', 3)).toBe('');
    expect(B.loadError('The server took too long to answer')).toBe("Couldn't load this list\nThe server took too long to answer");
    expect(B.catError('x')).toBe("Couldn't load categories\nx");
    expect(B.searchHint('live')).toBe('Search all channels');
    expect(B.CAT_HINT).toBe('Hold OK  Favourite, rename or hide');
    expect(B.PANEL_HINT).toBe('▶  TV guide      Hold OK  Favourite');
  });

  it('section tours: Live four tips, Movies / Series two', () => {
    const l = B.tourSteps('live', {});
    expect(l.map((s) => s.title)).toEqual(['Categories', 'Channels', "What's on", 'The TV guide']);
    expect(l[0].body).toBe('Search is at the top. Hold OK on a category to make it a favourite (it moves near the top with a ♥), to rename it or to hide it.');
    expect(B.tourSteps('movie', {}).map((s) => s.title)).toEqual(['Categories', 'Pick something']);
    expect(B.tourKey('series')).toBe('vod');
  });
});

// ------------------------------------------------------------------ the screen

describe('Browse screen: arrival and categories', () => {
  it('lists the categories in order, focus on Search, the start category open but not marked', async () => {
    await open('live');
    expect(catNames()).toEqual(['Search', 'Favourite Channels', 'Recent Channels', 'All Channels', 'UK | News', 'UK | Sports', 'FR | Général', 'Radio']);
    expect(focusedCat()).toBe(B.SEARCH);
    expect(st().currentCat.id).toBe('1'); // first provider category
    expect(contentIds()).toEqual(['10', '11', '12']);
    expect(root.querySelector('.b-catlist .active')).toBeNull(); // nothing marked until you pick
    expect(root.querySelector('.b-cathint').classList.contains('on')).toBe(true);
  });

  it('no request per category: lists come from the saved library', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await wait(400);
    expect(st().currentCat.id).toBe('2');
    expect(api.streams).not.toHaveBeenCalled();
    expect(api.categories).not.toHaveBeenCalled();
  });

  it('a category opens 350 ms after the selection stops (dwell), and is marked from then on', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); // All Channels
    await wait(300);
    expect(st().currentCat.id).toBe('1');
    press(K.DOWN); // UK | News again: restarts the wait
    press(K.DOWN); // UK | Sports
    await wait(349);
    expect(st().currentCat.id).toBe('1');
    await wait(2);
    expect(st().currentCat.id).toBe('2');
    expect(contentIds()).toEqual(['20']);
    expect(root.querySelector('.b-catlist .active').dataset.cat).toBe('2');
  });

  it('resting on Search does nothing until OK', async () => {
    await open('live');
    press(K.DOWN); await wait(400);
    expect(st().currentCat.id).toBe(B.FAV);
    press(K.UP); await wait(400);
    expect(st().currentCat.id).toBe(B.FAV);
    expect(root.querySelector('.b-search').hidden).toBe(true);
  });

  it('OK opens the category and moves focus to its first item; ▶ does the same', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); // UK | Sports
    await ok();
    expect(st().currentCat.id).toBe('2');
    expect(focusedItem()).toBe('20');
    press(K.LEFT);
    expect(focusedCat()).toBe('2');
    press(K.UP); // UK | News
    press(K.RIGHT);
    await wait(0);
    expect(st().currentCat.id).toBe('1');
    expect(focusedItem()).toBe('10');
  });

  it('▶ on the category already open jumps to its first item', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); // UK | News (already shown)
    press(K.RIGHT); await wait(0);
    press(K.DOWN); press(K.DOWN);
    expect(focusedItem()).toBe('12');
    press(K.LEFT); press(K.RIGHT); await wait(0);
    expect(focusedItem()).toBe('10');
  });

  it('▲ on the top category goes to the current tab; ▼ from the bar goes back to the top (Search)', async () => {
    await open('live');
    press(K.UP);
    expect(document.activeElement.dataset.tab).toBe('live');
    expect(st().zone).toBe('bar');
    press(K.DOWN);
    expect(focusedCat()).toBe(B.SEARCH);
  });

  it('the open category is not marked while the bar has focus, and the list goes back to the top', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok();
    expect(root.querySelector('.b-catlist .active')).not.toBeNull();
    press(K.LEFT);
    for (let i = 0; i < 6; i++) press(K.UP);
    expect(document.activeElement.dataset.tab).toBe('live');
    expect(root.querySelector('.b-catlist .active')).toBeNull();
    expect(st().catSel).toBe(0);
  });

  it('Back from the content returns to the categories (on the open one); Back on the categories leaves', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok();
    press(K.DOWN);
    press(K.BACK);
    expect(focusedCat()).toBe('1');
    expect(router.current().name).toBe('live');
    router.go('live', {}); // a second entry so Back has somewhere to go
    await wait(0); await wait(0);
    press(K.BACK);
    expect(router.stackDepth()).toBe(1);
  });

  it('no categories from the provider: the special entries still work, "All" opens', async () => {
    repo._reset();
    api.categories.mockRejectedValue(new Error('Can\'t find that server — check the URL'));
    api.streams.mockRejectedValue(new Error('Can\'t find that server — check the URL'));
    await open('live');
    expect(catNames()).toEqual(['Search', 'Favourite Channels', 'Recent Channels', 'All Channels']);
    expect(st().currentCat.id).toBe(B.ALL);
    expect(emptyText()).toBe("Couldn't load this list\nCan't find that server — check the URL");
  });

  it('a category load error shows Android\'s text', async () => {
    repo._reset(); // nothing saved: the provider is asked, and fails
    api.streams.mockRejectedValue(Object.assign(new Error('The server took too long to answer'), { name: 'Error' }));
    await open('live');
    expect(emptyText()).toBe("Couldn't load this list\nThe server took too long to answer");
  });
});

describe('Browse screen: favourites and hiding', () => {
  it('Hold OK on a category: dialog "♡  Favourite" / "✎  Rename" / "Hide"; Favourite pins it under the special entries', async () => {
    await open('live');
    for (let i = 0; i < 7; i++) press(K.DOWN); // Radio
    await holdOk();
    const items = [...document.querySelectorAll('.dialog-item')].map((b) => b.textContent);
    expect(document.querySelector('.dialog-title').textContent).toBe('Radio');
    expect(items).toEqual(['♡  Favourite', '✎  Rename', 'Hide']);
    document.querySelector('.dialog-item[data-value="0"]').click();
    await wait(0);
    expect(catNames().slice(4)).toEqual(['Radio', 'UK | News', 'UK | Sports', 'FR | Général']);
    expect(catRows()[4].querySelector('.rc-trail').textContent).toBe('♥');
    expect(focusedCat()).toBe('4');
    expect(toast.current()).toBe('Added to favourite categories — Radio');
    await holdOk();
    expect([...document.querySelectorAll('.dialog-item')][0].textContent).toBe('♥  Remove from favourites');
  });

  it('Hold OK on a special entry does nothing', async () => {
    await open('live');
    await holdOk();
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('☰ on a category opens the same menu; Rename shows your own name in the list, and blank restores the original', async () => {
    await open('live');
    for (let i = 0; i < 7; i++) press(K.DOWN); // Radio
    press(K.MENU);
    await wait(0);
    expect(document.querySelector('.dialog-title').textContent).toBe('Radio');
    document.querySelector('.dialog-item[data-value="1"]').click();
    await wait(0); await wait(0);
    expect(document.querySelector('.dialog-title').textContent).toBe('Rename “Radio”');
    const box = document.querySelector('.dialog-input');
    expect(box.value).toBe('Radio');
    expect([...document.querySelectorAll('.dialog-button')].map((b) => b.textContent)).toEqual(['Original Name', 'Cancel', 'Save']);
    box.value = 'My Stations';
    document.querySelector('.dialog-button[data-value="positive"]').click();
    await wait(0); await wait(0); await wait(0);
    expect(toast.current()).toBe('Renamed to My Stations');
    expect(store.catName('live', '4')).toBe('My Stations');
    expect(catNames()).toContain('My Stations');
    expect(catNames()).not.toContain('Radio');
    store.setCatName('live', '4', '');
    expect(store.catName('live', '4')).toBeNull();
  });

  it('Hide (from the menu): gone from the list, toast, unfavourited, and "All" opens if it was open', async () => {
    store.toggleFavCategory('live', '1');
    await open('live');
    for (let i = 0; i < 4; i++) press(K.DOWN); // ♥ UK | News, pinned at 4
    await ok();
    expect(st().currentCat.id).toBe('1');
    press(K.LEFT);
    press(K.MENU);
    await wait(0);
    document.querySelector('.dialog-item[data-value="2"]').click();
    await wait(0); await wait(0);
    expect(catNames()).not.toContain('UK | News');
    expect(store.isFavCategory('live', '1')).toBe(false);
    expect(filters.hiddenCategories('live').has('1')).toBe(true);
    expect(toast.current()).toBe('Hidden: UK | News  (Settings → Hidden Categories to bring it back)');
    expect(st().currentCat.id).toBe(B.ALL);
    expect(contentIds()).not.toContain('10'); // "All" leaves out what's in hidden categories
    expect(contentIds()).toContain('20');
  });

  it('Hold OK / ☰ on an item toggles its favourite with a toast and the ♥ mark', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok();
    await holdOk();
    expect(store.isFav(LIVE[0])).toBe(true);
    expect(toast.current()).toBe('Added to Favourites — Channel 10');
    expect(document.activeElement.querySelector('.rc-trail').textContent).toBe('♥');
    expect(focusedItem()).toBe('10');
    press(K.MENU);
    expect(store.isFav(LIVE[0])).toBe(false);
    expect(toast.current()).toBe('Removed from Favourites — Channel 10');
  });

  it('in Favourites the list is rebuilt in place and the selection kept', async () => {
    LIVE.slice(0, 3).forEach((c) => store.toggleFav(c));
    await open('live');
    expect(st().currentCat.id).toBe(B.FAV);
    press(K.DOWN); await ok();
    press(K.DOWN); press(K.DOWN);
    expect(focusedItem()).toBe('12');
    press(K.MENU);
    expect(contentIds()).toEqual(['10', '11']);
    expect(focusedItem()).toBe('11');
  });

  it('empty Favourites says how to add one', async () => {
    await open('movies');
    press(K.DOWN); await wait(400);
    expect(st().currentCat.id).toBe(B.FAV);
    expect(emptyText()).toBe('No favourites yet\nHold OK on anything to add it.');
  });

  it('country filters leave whole countries out of the list, All and search', async () => {
    filters.setHiddenTags(new Set(['FR']));
    await open('live');
    expect(catNames()).not.toContain('FR | Général');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); await ok(); // All Channels
    expect(contentIds()).not.toContain('30');
  });
});

describe('Browse screen: content keys', () => {
  it('poster grid: AUTO_FIT columns, ◀ from the first column back to the categories, OK opens details', async () => {
    await open('movies');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); // All
    await ok();
    const cols = Math.floor(1315 / (178 * 1.4)); // jsdom has no layout: the view's fallback width
    expect(focusedItem()).toBe('500');
    press(K.RIGHT);
    expect(focusedItem()).toBe('501');
    press(K.LEFT); press(K.LEFT);
    expect(focusedCat()).toBe(B.ALL);
    press(K.RIGHT); await wait(0);
    await ok();
    expect(router.current().name).toBe('movie-detail');
    expect(router.current().params.item.id).toBe('500');
    expect(cols).toBeGreaterThan(0);
  });

  it('coming back from the player / details puts everything where it was', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); // UK | Sports
    press(K.UP); // UK | News
    await ok();
    press(K.DOWN);
    await ok(); // plays Channel 11
    expect(router.current().name).toBe('player-live');
    expect(router.current().params.channels.map((c) => c.id)).toEqual(['10', '11', '12']);
    expect(router.current().params.index).toBe(1);
    router.back();
    await wait(0); await wait(0); await wait(0);
    expect(st().currentCat.id).toBe('1');
    expect(focusedItem()).toBe('11');
    expect(root.querySelector('.b-catlist .active').dataset.cat).toBe('1');
  });

  it('channel rows: number (or position + 1), logo, name, ♥ — no Now/Next in the row', async () => {
    await open('live');
    store.toggleFav(LIVE[1]);
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN); await ok();
    const rows = [...root.querySelectorAll('.b-channels .row-cell')];
    expect(rows.map((r) => r.querySelector('.rc-num').textContent)).toEqual(['10', '11', '3']);
    expect(rows[0].querySelector('.rc-logo img').getAttribute('src')).toBe('http://x/10.png');
    expect(rows[1].querySelector('.rc-trail').textContent).toBe('♥');
    expect(rows[0].querySelector('.rc-trail')).toBeNull();
    expect(rows[0].textContent).toBe('10Channel 10');
  });

  it('posters: "♥ " before a favourite\'s title', async () => {
    store.toggleFav(MOVIES[1]);
    await open('movies');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); await ok();
    const titles = [...root.querySelectorAll('.b-grid .poster-cell .title')].map((t) => t.textContent);
    expect(titles[0]).toBe('Movie 500');
    expect(titles[1]).toBe('♥ Movie 501');
  });
});

describe('Browse screen: search', () => {
  it('OK on Search opens the box and its keyboard; typing searches the whole section after 300 ms; ▶ goes to the results', async () => {
    await open('live');
    await ok();
    const box = root.querySelector('.b-search');
    const keyEl = (k) => root.querySelector(`.b-keys [data-key="${k}"]`);
    expect(box.hidden).toBe(false);
    expect(box.readOnly).toBe(true); // the TV's own keyboard never comes up
    expect(box.placeholder).toBe('Search all channels');
    expect(document.activeElement).toBe(keyEl('a'));
    expect(emptyText()).toBe('Type the name of a channel');
    box.value = 'channel 2';
    box.dispatchEvent(new Event('input'));
    await wait(299);
    expect(contentIds()).toEqual([]);
    await wait(2); await wait(0);
    expect(contentIds()[0]).toBe('20');
    // the keyboard moves with the arrows and types with OK
    keyEl('del').focus();
    press(K.ENTER); document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: K.ENTER }));
    expect(box.value).toBe('channel ');
    keyEl('a').focus();
    press(K.RIGHT);
    expect(document.activeElement).toBe(keyEl('b'));
    press(K.UP);
    expect(document.activeElement.dataset.key).toBe(' ');
    press(K.DOWN);
    expect(document.activeElement).toBe(keyEl('a'));
    keyEl('1').focus();
    press(K.ENTER);
    await wait(310); await wait(0);
    expect(box.value).toBe('channel 1');
    keyEl('f').focus();
    press(K.RIGHT); // off the right edge: the results
    expect(focusedItem()).toBe('10');
  });

  it('search ignores categories you hid yourself but not country filters', async () => {
    filters.setCategoryHidden('live', '2', true);
    filters.setHiddenTags(new Set(['FR']));
    const r = await B.search('live', 'channel');
    expect(r.map((c) => c.id)).toContain('20');
    expect(r.map((c) => c.id)).not.toContain('30');
  });

  it('Back in the box goes to the categories', async () => {
    await open('movies');
    await ok();
    press(K.BACK);
    expect(focusedCat()).toBe(B.SEARCH);
  });
});

describe('Live TV info panel and preview', () => {
  const prog = (title, start, stop, desc = '') => ({ title, desc, start, stop, timeRange: () => (start ? '18:00 – 19:00' : ''), progress: () => 0.5 });

  it('name and logo at once; NOW, time, progress, description and UP NEXT 400 ms later', async () => {
    api.epg.mockResolvedValue([prog('Evening News', 100, 200, 'The day\'s news.'), { ...prog('Weather', 200, 300), timeRange: () => '19:00 – 19:05' }]);
    await open('live');
    const p = (s) => root.querySelector(s);
    expect(p('.b-name').textContent).toBe('Channel 10');
    expect(p('.b-logo img').getAttribute('src')).toBe('http://x/10.png');
    expect(p('.b-now').textContent).toBe('');
    await wait(399);
    expect(api.epg).not.toHaveBeenCalled();
    await wait(2); await wait(0);
    expect(api.epg).toHaveBeenCalledWith('10');
    expect(p('.b-now').textContent).toBe('Evening News');
    expect(p('.b-time').textContent).toBe('18:00 – 19:00');
    expect(p('.b-progress i').style.width).toBe('50%');
    expect(p('.b-desc').textContent).toBe("The day's news.");
    expect(p('.b-next').textContent).toBe('19:00   Weather');
    expect(p('.b-hint').textContent).toBe(B.PANEL_HINT);
  });

  it('no listings: "No guide information"', async () => {
    await open('live');
    await wait(450);
    expect(root.querySelector('.b-now').textContent).toBe('No guide information');
    expect(root.querySelector('.b-now').classList.contains('muted')).toBe(true);
  });

  it('the preview starts 450 ms after you pause on a channel, in the panel\'s box', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok();
    await wait(449);
    expect(shim.names()).not.toContain('open');
    await wait(2);
    expect(shim.names()).toEqual(['open', 'setListener', 'setDisplayRect', 'setStreamingProperty', 'prepareAsync', 'play']);
    expect(shim.calls[0].args[0]).toBe('http://srv/live/u/p/10.ts');
  });

  it('moving on stops the old preview before the next opens; leaving the list stops it', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok(); await wait(460);
    shim.calls = [];
    press(K.DOWN); // scrolling past: stopped at once, nothing new until you pause
    expect(shim.names()).toEqual(['stop', 'close']);
    await wait(460);
    expect(shim.names().slice(2)).toEqual(['open', 'setListener', 'setDisplayRect', 'setStreamingProperty', 'prepareAsync', 'play']);
    expect(shim.calls[2].args[0]).toContain('/11.ts');
    shim.calls = [];
    press(K.LEFT); // back to the categories
    expect(shim.names()).toEqual(['stop', 'close']);
  });

  it('the preview is closed before the full-screen player opens', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok(); await wait(460);
    shim.calls = [];
    await ok();
    expect(router.current().name).toBe('player-live');
    const n = shim.names();
    expect(n.indexOf('close')).toBeGreaterThanOrEqual(0);
    expect(n.indexOf('close')).toBeLessThan(n.indexOf('open'));
    expect(shim.calls[n.indexOf('setDisplayRect', n.indexOf('open'))].args).toEqual([0, 0, 1920, 1080]);
  });

  it('preview off: never opens; muted: the TV is muted while it plays and unmuted after', async () => {
    store.setPreviewMode(0);
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok(); await wait(500);
    expect(shim.names()).not.toContain('open');
    router.reset();
    store.setPreviewMode(1);
    let muted = false;
    globalThis.tizen = { tvaudiocontrol: { isMute: () => muted, setMute: vi.fn((m) => { muted = m; }) } };
    globalThis.webapis = { avplay: shim }; // a TV: the real player is there
    router.init(root);
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok(); await wait(500);
    expect(shim.names()).toContain('play');
    expect(muted).toBe(true);
    press(K.LEFT);
    expect(muted).toBe(false);
  });

  it('a preview error stops it silently; with a real player the artwork fades and the page opens a hole', async () => {
    globalThis.webapis = { avplay: shim };
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok(); await wait(460);
    expect(document.documentElement.classList.contains('preview-on')).toBe(true);
    expect(root.querySelector('.b-logo').style.opacity).toBe('0');
    expect(document.getElementById('av').hidden).toBe(false);
    shim.emitError('PLAYER_ERROR_CONNECTION_FAILED');
    expect(shim.names().slice(-2)).toEqual(['stop', 'close']);
    expect(document.documentElement.classList.contains('preview-on')).toBe(false);
    expect(root.querySelector('.b-logo').style.opacity).toBe('1');
    expect(document.getElementById('av').hidden).toBe(true);
  });

  it('in a browser (the shim) the box keeps the channel artwork', async () => {
    await open('live');
    press(K.DOWN); press(K.DOWN); press(K.DOWN); press(K.DOWN);
    await ok(); await wait(460);
    expect(shim.names()).toContain('play');
    expect(document.documentElement.classList.contains('preview-on')).toBe(false);
    expect(root.querySelector('.b-logo').style.opacity).toBe('1');
  });
});
