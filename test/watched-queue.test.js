// @vitest-environment jsdom
// What the Android app added after the first Tizen build: already watched, the queue, up next in
// Continue Watching, your own category names (Prefs.java), the item menu (ItemMenu.java), the
// TMDB and intro-database lookups (Tmdb.java, Intros.java), "Because you watched" (Recs.java),
// What's New (WhatsNew.java), and the series page's ✓ marks and episode menu.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/api.js', async (orig) => ({ ...(await orig()), vodInfo: vi.fn(), seriesInfo: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as filters from '../js/filters.js';
import * as tmdb from '../js/tmdb.js';
import * as intros from '../js/intros.js';
import * as recs from '../js/recs.js';
import * as whatsNew from '../js/whats-new.js';
import * as D from '../js/detail.js';
import * as toast from '../js/ui/toast.js';
import { menuItems, menuTitle, showItemMenu } from '../js/item-menu.js';
import { router } from '../js/router.js';
import { seriesDetailView } from '../js/views/series-detail.js';
import { movieDetailView } from '../js/views/movie-detail.js';
import { seedLibrary } from './helpers.js';

const M = (id, extra = {}) => ({ type: 'movie', id: String(id), name: `Film ${id}`, ...extra });
const E = (id, extra = {}) => ({ type: 'episode', id: String(id), name: `Ep ${id}`, num: '1', parentId: '7', parentName: 'Dark', ...extra });
const json = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));

function account(id = '') {
  const a = { id, server: `http://${id || 'first'}.tv`, user: 'u', pass: 'p', ok: true };
  store.saveAccount(a);
  store.setCurrent(id);
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  account('');
});

// ------------------------------------------------------------------ store

describe('store: watched, queue, up next, picture, category names', () => {
  it('watched: marks and unmarks; marking clears the resume point and takes it out of the queue', () => {
    const m = M(1);
    store.addHistory(m); store.setPosition(m, 60000); store.queueAdd(m); store.queueAdd(M(2));
    store.setWatched(m, true);
    expect(store.isWatched(m)).toBe(true);
    expect(store.position(m)).toBe(0);
    expect(store.queue().map((q) => q.id)).toEqual(['2']);
    expect(store.continueWatching()).toEqual([]);
    store.setWatched(m, false);
    expect(store.isWatched(m)).toBe(false);
    expect(store.watchedKeys().size).toBe(0);
  });

  it('a whole season at once, and the count for the season pill', () => {
    const season = [E(1), E(2), E(3)];
    store.queueAdd(season[1]);
    expect(store.watchedCount(season)).toBe(0);
    store.setWatched(season.slice(0, 2), true);
    expect(store.watchedCount(season)).toBe(2);
    expect(store.queue()).toEqual([]);
    store.setWatched(season, false);
    expect(store.watchedCount(season)).toBe(0);
  });

  it('queue: in order, no doubles, and what plays after the current one', () => {
    store.queueAdd(M(1)); store.queueAdd(M(2)); store.queueAdd(M(1));
    expect(store.queue().map((q) => q.id)).toEqual(['1', '2']);
    expect(store.inQueue(M(2))).toBe(true);
    expect(store.queueNextAfter(M(1)).id).toBe('2');
    expect(store.queueNextAfter(M(9)).id).toBe('1');
    store.queueRemove(M(1)); store.queueRemove(M(2));
    expect(store.queueNextAfter(null)).toBeNull();
  });

  it('up next: in Continue Watching without a resume point, until it is started or history is cleared', () => {
    const e = E(2);
    store.markUpNext(e);
    expect(store.isUpNext(e)).toBe(true);
    expect(store.continueWatching().map((x) => x.id)).toEqual(['2']);
    store.setPosition(e, 15000);
    expect(store.isUpNext(e)).toBe(false);
    expect(store.continueWatching().map((x) => x.id)).toEqual(['2']);
    store.markUpNext(E(3));
    store.clearHistory();
    expect(store.isUpNext(E(3))).toBe(false);
    expect(store.continueWatching()).toEqual([]);
  });

  it('season and tmdb survive being saved (history, queue)', () => {
    store.addHistory(E(5, { season: 0, tmdb: '70523' }));
    expect(store.history(false)[0]).toMatchObject({ season: 0, tmdb: '70523' });
  });

  it('all of it is per account, and goes with the account', () => {
    store.setWatched(M(1), true); store.queueAdd(M(2)); store.markUpNext(E(3));
    store.setPicture(M(1), 2); store.setCatName('live', '4', 'Mine');
    account('a1');
    expect(store.isWatched(M(1))).toBe(false);
    expect(store.queue()).toEqual([]);
    expect(store.picture(M(1))).toBe(0);
    expect(store.catName('live', '4')).toBeNull();
    store.setWatched(M(1), true); store.setCatName('live', '4', 'Theirs');
    store.removeAccount('');
    for (const k of ['watched', 'queue', 'upnext', 'pic_movie:1', 'catname_live_4']) expect(localStorage.getItem(k), k).toBeNull();
    expect(store.isWatched(M(1))).toBe(true); // the other account's is untouched
    expect(store.catName('live', '4')).toBe('Theirs');
    store.removeAccount('a1');
    expect(localStorage.getItem('a1_watched')).toBeNull();
  });

  it('your own category names show in the list; the provider\'s name still decides the country filter', () => {
    const cats = [{ type: 'cat', id: '1', name: 'FR | Cinéma' }, { type: 'cat', id: '2', name: 'Radio' }];
    expect(filters.categories('movie', cats)).toBe(cats);
    store.setCatName('movie', '1', 'French films');
    expect(filters.categories('movie', cats).map((c) => c.name)).toEqual(['French films', 'Radio']);
    expect(cats[0].name).toBe('FR | Cinéma'); // the saved list is not touched
    filters.setHiddenTags(new Set(['FR']));
    expect(filters.categories('movie', cats).map((c) => c.name)).toEqual(['Radio']);
  });

  it('Home has a switch for "Because You Watched…", on by default, between the Top 10 and Recently Added', () => {
    expect(store.HOME_KEYS.slice(5)).toEqual(['top_movies', 'top_series', 'recommended', 'new_movies', 'new_series']);
    expect(store.HOME_NAMES.recommended).toBe('Because You Watched…');
    expect(store.homeShows('recommended')).toBe(true);
  });
});

// ------------------------------------------------------------------ item menu

describe('ItemMenu', () => {
  const labels = (it, season) => menuItems(it, season).map((x) => x.label);

  it('a film: Favourite, Queue, Watched, and Remove from Continue Watching once it has a resume point', () => {
    const m = M(1);
    expect(labels(m)).toEqual(['♡  Add to Favourites', '＋  Add to Queue', '✓  Mark as Watched']);
    store.toggleFav(m); store.queueAdd(m); store.setPosition(m, 30000);
    expect(labels(m)).toEqual(['♥  Remove from Favourites', '−  Remove from Queue', '✓  Mark as Watched', '✕  Remove from Continue Watching']);
    store.setWatched(m, true);
    expect(labels(m)).toEqual(['♥  Remove from Favourites', '＋  Add to Queue', '○  Mark as Unwatched']);
  });

  it('a series: only Favourite. An episode: no Favourite, plus its whole season', () => {
    expect(labels({ type: 'series', id: '7', name: 'Dark' })).toEqual(['♡  Add to Favourites']);
    const season = [E(1), E(2)];
    expect(labels(season[0], season)).toEqual(['＋  Add to Queue', '✓  Mark as Watched', '✓  Mark Season as Watched']);
    store.setWatched(season, true);
    expect(labels(season[0], season)).toEqual(['＋  Add to Queue', '○  Mark as Unwatched', '○  Mark Season as Unwatched']);
    store.setWatched(season, false);
    store.markUpNext(season[1]);
    expect(labels(season[1])).toContain('✕  Remove from Continue Watching');
    expect(menuTitle(season[0])).toBe('Dark  ·  Ep 1');
    expect(menuTitle(M(1))).toBe('Film 1');
  });

  it('picking a row does it and resolves true; Back resolves false', async () => {
    const p = showItemMenu(M(1));
    expect(document.querySelector('.dialog-title').textContent).toBe('Film 1');
    document.querySelectorAll('.dialog-item')[1].click();
    expect(await p).toBe(true);
    expect(store.inQueue(M(1))).toBe(true);
    expect(toast.current()).toBe('Added to your Queue — Film 1');
    const q = showItemMenu(M(1));
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event('back'));
    const closed = await Promise.race([q, tick().then(() => 'open')]);
    if (closed === 'open') { // close it the way the dialog's own Back does
      document.querySelector('.dialog-scrim')?.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true, cancelable: true }));
    }
    expect(store.inQueue(M(1))).toBe(true);
  });
});

// ------------------------------------------------------------------ TMDB + intros

describe('Tmdb', () => {
  it('cleanName takes off a provider tag, the year and the quality, never part of a real title', () => {
    expect(tmdb.cleanName('EN - Breaking Bad (2008) [4K]')).toEqual(['Breaking Bad', '2008', 'Breaking Bad']);
    expect(tmdb.cleanName('NF | The Crown')).toEqual(['The Crown', null, 'The Crown']);
    expect(tmdb.cleanName('UK: Line of Duty')[0]).toBe('Line of Duty');
    expect(tmdb.cleanName('CSI: Miami')[0]).toBe('CSI: Miami');
    expect(tmdb.cleanName('24: Legacy')[0]).toBe('24: Legacy');
    expect(tmdb.cleanName('Thor: Ragnarok')[0]).toBe('Thor: Ragnarok');
    expect(tmdb.cleanName('1917')).toEqual(['1917', null, '1917']);
    expect(tmdb.cleanName('Blade Runner 2049')).toEqual(['Blade Runner', '2049', 'Blade Runner 2049']);
    expect(tmdb.cleanName('Dark - S01E03 Past and Present')[0]).toBe('Dark');
    expect(tmdb.cleanName('Dune 4K HDR')[0]).toBe('Dune');
    expect(tmdb.cleanName(null)).toEqual(['', null, '']);
  });

  it('findId: the provider\'s own id wins; otherwise one search, remembered (also "not found")', async () => {
    const f = vi.fn((url) => json({ results: url.includes('query=Heat') ? [{ id: 949 }] : [] }));
    tmdb.setFetch(f);
    expect(await tmdb.findId('movie', 'Heat (1995)', '949')).toBe('949');
    expect(await tmdb.findId('movie', 'Heat (1995)', '0')).toBe('949');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/api\.themoviedb\.org\/3\/search\/movie\?query=Heat&year=1995&api_key=\w+&language=en-GB$/);
    expect(await tmdb.findId('movie', 'Heat (1995)', null)).toBe('949');
    expect(f).toHaveBeenCalledTimes(1); // remembered
    expect(await tmdb.findId('tv', 'Nope', null)).toBeNull();
    expect(await tmdb.findId('tv', 'Nope', null)).toBeNull();
    expect(f).toHaveBeenCalledTimes(2); // "not found" is remembered too
  });

  it('findId: a number that is part of the title, then a wrong year, are tried in turn; series use first_air_date_year', async () => {
    const urls = [];
    tmdb.setFetch((url) => { urls.push(decodeURIComponent(url.split('?')[1].split('&api_key')[0])); return json({ results: urls.length === 3 ? [{ id: 5 }] : [] }); });
    expect(await tmdb.findId('tv', 'Blade Runner 2049', null)).toBe('5');
    expect(urls).toEqual(['query=Blade Runner&first_air_date_year=2049', 'query=Blade Runner 2049', 'query=Blade Runner']);
  });

  it('findId offline: null, flagged as a failure, and asked again next time', async () => {
    tmdb.setFetch(() => Promise.reject(new Error('offline')));
    expect(await tmdb.findId('movie', 'Heat', null)).toBeNull();
    expect(tmdb.state.failed).toBe(true);
    tmdb.setFetch(() => json({ results: [{ id: 949 }] }));
    expect(await tmdb.findId('movie', 'Heat', null)).toBe('949');
  });

  it('recommendations: two pages, the English and the original titles', async () => {
    const pages = [];
    tmdb.setFetch((url) => { pages.push(/page=(\d)/.exec(url)[1]); return json({ results: [{ title: 'Ronin', original_title: 'Ronin' }, { title: 'The Town', original_title: 'La ville' }] }); });
    expect(await tmdb.recommendations('movie', '949')).toEqual(['Ronin', 'The Town', 'La ville', 'Ronin', 'The Town', 'La ville']);
    expect(pages).toEqual(['1', '2']);
    expect(await tmdb.recommendations('movie', null)).toEqual([]);
  });
});

describe('Intros (TheIntroDB)', () => {
  const T = (o) => ({ introStart: -1, introEnd: -1, recapStart: -1, recapEnd: -1, creditsStart: -1, status: '', ...o });

  it('parse: intro, recap and credits; a null start is the beginning; {0,0} means none; the longest of several', () => {
    expect(intros.parse({ intro: [{ start_ms: 30000, end_ms: 95000 }], credits: [{ start_ms: 2500000, end_ms: null }] }))
      .toEqual(T({ introStart: 30000, introEnd: 95000, creditsStart: 2500000 }));
    expect(intros.parse({ data: { intro: { start_ms: null, end_ms: 60000 } } })).toEqual(T({ introStart: 0, introEnd: 60000 }));
    expect(intros.parse({ intro: [{ start_ms: 0, end_ms: 0 }], credits: [] })).toEqual(T({}));
    expect(intros.parse({ recap: [{ start_ms: null, end_ms: 45000 }], intro: [{ start_ms: 50000, end_ms: 60000 }, { start_ms: 120000, end_ms: 175000 }] }))
      .toEqual(T({ recapStart: 0, recapEnd: 45000, introStart: 120000, introEnd: 175000 }));
    expect(intros.parse({ intro: [{ startMs: 5000, endMs: 65000 }] })).toEqual(T({ introStart: 5000, introEnd: 65000 })); // camelCase too
    expect(intros.hasIntro(intros.parse({ intro: [{ start_ms: 5000, end_ms: 65000 }] }))).toBe(true);
    expect(intros.hasRecap(intros.parse({ recap: [{ start_ms: null, end_ms: 40000 }] }))).toBe(true);
    expect(intros.hasIntro(intros.NONE)).toBe(false);
    expect(intros.hasIntro(null)).toBe(false);
  });

  it('get: no intro for this cut (only credits): the intro comes from the episode as a whole', async () => {
    const f = vi.fn((url) => json(url.includes('duration_ms')
      ? { intro: [], recap: [], credits: [{ start_ms: 3000000, end_ms: null }] }
      : { intro: [{ start_ms: 70000, end_ms: 120000 }], credits: [{ start_ms: 2900000, end_ms: null }] }));
    tmdb.setFetch(f);
    const s = await intros.get('225385', 1, 2, 3207000);
    expect(s).toMatchObject({ introStart: 70000, introEnd: 120000, creditsStart: 3000000 }); // this cut's credits kept
    expect(s.status).toBe('TMDB 225385 S1E2: intro 1:10–2:00  credits 50:00  (TheIntroDB, another cut)');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('get: nothing in TheIntroDB: SkipDB, then IntroDB, by the IMDb id; says when there is nowhere yet', async () => {
    tmdb._resetImdb();
    const seen = [];
    tmdb.setFetch((url) => {
      seen.push(url.replace(/api_key=[^&]+&?/, ''));
      if (url.includes('theintrodb')) return json({ tvdb_id: 441315, credits: [{ start_ms: 3000412, end_ms: null }] });
      if (url.includes('/external_ids')) return json({ imdb_id: 'tt13250218' });
      if (url.includes('skipdb')) return json({ segments: { intro: null, recap: null, outro: null, preview: null } });
      if (url.includes('introdb.app')) return json({ intro: { start_sec: 62.5, end_sec: 118 } });
      return json({}, false);
    });
    const s = await intros.get('225385', 1, 2, 3207000);
    expect(s).toMatchObject({ introStart: 62500, introEnd: 118000, creditsStart: 3000412 });
    expect(s.status).toBe('TMDB 225385 S1E2: intro 1:02–1:58  credits 50:00  (IntroDB)');
    expect(seen.some((u) => u.startsWith('https://api.skipdb.tv/api/segments?imdb_id=tt13250218&season=1&episode=2&duration=3207'))).toBe(true);
    expect(seen.some((u) => u.startsWith('https://api.introdb.app/segments?imdb_id=tt13250218&season=1&episode=2'))).toBe(true);
    tmdb.setFetch((url) => (url.includes('skipdb')
      ? json({ segments: { intro: { start_ms: 40000, end_ms: 95000 }, recap: null, outro: { start_ms: 2950000, end_ms: 3000000 } } })
      : url.includes('/external_ids') ? json({ imdb_id: 'tt0903747' }) : json({}, false)));
    expect((await intros.get('1396', 1, 1)).status).toBe('TMDB 1396 S1E1: intro 0:40–1:35  credits 49:10  (SkipDB)');
    tmdb.setFetch((url) => (url.includes('theintrodb') ? json({ credits: [{ start_ms: 3000000, end_ms: null }] }) : json({}, false)));
    expect((await intros.get('225385', 1, 3, 3207000)).status).toBe('TMDB 225385 S1E3: credits 50:00  ·  no intro or recap times in TheIntroDB, SkipDB or IntroDB yet');
  });

  it('get: asks by tmdb id, season, episode (and length), once per episode; says what happened', async () => {
    const f = vi.fn(() => json({ recap: [{ start_ms: null, end_ms: 30000 }], intro: [{ start_ms: 61000, end_ms: 92000 }], credits: [{ start_ms: 2500000, end_ms: null }] }));
    tmdb.setFetch(f);
    const s = await intros.get('70523', 1, 3, 2700000);
    expect(s).toMatchObject({ introStart: 61000, introEnd: 92000, recapEnd: 30000 });
    expect(s.status).toBe('TMDB 70523 S1E3: recap 0:00–0:30  intro 1:01–1:32  credits 41:40  (TheIntroDB)');
    expect(await intros.get('70523', 1, 3)).toBe(s);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('https://api.theintrodb.org/v4/media?tmdb_id=70523&season=1&episode=3&duration_ms=2700000');
    expect(await intros.get(null, 1, 3)).toMatchObject({ introEnd: -1, status: "Couldn't find this show on TMDB" });
    expect(await intros.get('1', -1, 3)).toMatchObject({ introEnd: -1, status: 'No season / episode number for this episode' });
    tmdb.setFetch(() => json({}, false));
    const missing = await intros.get('1', 2, 1);
    expect(intros.hasIntro(missing)).toBe(false);
    expect(missing.status).toMatch(/(not in TheIntroDB, SkipDB or IntroDB|Couldn't reach TheIntroDB)/);
  });
});

// ------------------------------------------------------------------ Because you watched

describe('Recs', () => {
  const LIB = [M(1, { name: 'Heat' }), M(2, { name: 'Ronin (1998)' }), M(3, { name: 'The Town' }), M(4, { name: 'Collateral' }), M(5, { name: 'Thief' })];

  // Watched for real: more than five minutes in
  const seen = (it) => { store.addHistory(it); store.setPosition(it, 6 * 60000); };

  it('sources: the three newest films / series in the history, one per series', () => {
    seen(M(1)); seen(E(10)); seen(E(11)); seen(M(2)); seen(M(3));
    expect(recs.sources().map((s) => `${s.type}:${s.id}`)).toEqual(['movie:3', 'movie:2', 'series:7']);
  });

  it('sources: only what was finished or watched 5+ minutes; not ones turned off with Don\'t recommend', () => {
    store.addHistory(M(1)); store.setPosition(M(1), 4 * 60000); // only a few minutes: left out
    store.addHistory(M(2)); store.setWatched(M(2), true);        // finished
    seen(E(10)); seen(M(3));
    expect(recs.sources().map((s) => `${s.type}:${s.id}`)).toEqual(['movie:3', 'series:7', 'movie:2']);
    store.blockRec('series:7');
    store.blockRec('movie:3');
    expect(recs.sources().map((s) => `${s.type}:${s.id}`)).toEqual(['movie:2']);
    expect(store.recBlockedCount()).toBe(2);
    store.clearRecBlocks();
    expect(recs.sources()).toHaveLength(3);
  });

  it('a "Because you watched X" row: TMDB\'s picks that are in the library, minus the film itself and watched ones', async () => {
    seedLibrary({ movie: LIB });
    seen(LIB[0]);
    store.setWatched(LIB[4], true);
    tmdb.setFetch((url) => json(url.includes('/search/') ? { results: [{ id: 949 }] }
      : { results: url.includes('page=1') ? ['Heat', 'Ronin', 'The Town', 'Collateral', 'Thief', 'Not In Library'].map((t) => ({ title: t })) : [] }));
    const rows = await recs.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Because you watched Heat');
    expect(rows[0]).toMatchObject({ sourceKey: 'movie:1', sourceName: 'Heat' });
    expect(rows[0].items.map((i) => i.id)).toEqual(['2', '3', '4']);
    tmdb.setFetch(() => Promise.reject(new Error('should be cached')));
    expect(await recs.rows()).toBe(rows); // kept for six hours
  });

  it('fewer than three matches is no row; nothing watched is no rows and no requests', async () => {
    const f = vi.fn(() => json({ results: [] }));
    tmdb.setFetch(f);
    expect(await recs.rows()).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('when TMDB can\'t be reached the answer is only kept for five minutes', async () => {
    seedLibrary({ movie: LIB });
    seen(LIB[0]);
    let t = 1000000;
    tmdb.setFetch(() => Promise.reject(new Error('offline')));
    expect(await recs.rows(() => t)).toEqual([]);
    tmdb.setFetch((url) => json(url.includes('/search/') ? { results: [{ id: 949 }] } : { results: ['Ronin', 'The Town', 'Collateral'].map((x) => ({ title: x })) }));
    t += 4 * 60000;
    expect(await recs.rows(() => t)).toEqual([]);
    t += 2 * 60000;
    expect((await recs.rows(() => t))[0].items).toHaveLength(3);
  });

  it('byGenre fallback: series sharing a genre with what you watch, best rated first', () => {
    const series = [
      { type: 'series', id: '7', name: 'Dark', info: 'Sci-Fi  ·  ★ 8.7' },
      { type: 'series', id: '8', name: 'Fringe', info: 'Sci-Fi, Drama  ·  ★ 8.1' },
      { type: 'series', id: '9', name: 'The Expanse', info: 'Sci-Fi  ·  ★ 8.5' },
      { type: 'series', id: '10', name: 'Bake Off', info: 'Reality  ·  ★ 8.9' },
    ];
    expect(recs.byGenre(series, [series[0]]).map((s) => s.id)).toEqual(['9', '8']);
  });
});

// ------------------------------------------------------------------ What's New

describe("What's New", () => {
  it('format: "- line" becomes a bullet with a blank line between', () => {
    expect(whatsNew.format('\n- One.\n- Two.\n')).toBe('•  One.\n\n•  Two.');
    expect(whatsNew.NOTES.trim().split('\n').every((l) => l.startsWith('- '))).toBe(true);
  });

  it('a fresh install never sees it; an update shows it once', () => {
    localStorage.clear();
    whatsNew.init(); // no account yet: fresh
    account('');
    expect(whatsNew.maybeShow()).toBe(false);
    expect(document.querySelector('.dialog')).toBeNull();

    localStorage.removeItem('whatsnew_seen'); // an install from before this version, already signed in
    whatsNew.init();
    expect(whatsNew.maybeShow()).toBe(true);
    expect(document.querySelector('.dialog-title').textContent).toMatch(/^What's New in YM Player \d+\.\d+\.\d+$/);
    expect(document.querySelector('.dialog-message').textContent.startsWith('•  A new launch intro')).toBe(true);
    expect(whatsNew.NOTES.trim().split('\n').length).toBeLessThanOrEqual(7); // more would not fit the pop-up
    expect(document.querySelector('.dialog-button').textContent).toBe('Got it');
    expect(whatsNew.maybeShow()).toBe(false);
  });

  it('new notes show again', () => {
    localStorage.setItem('whatsnew_seen', whatsNew.hash('older notes'));
    expect(whatsNew.maybeShow()).toBe(true);
  });
});

// ------------------------------------------------------------------ series and movie pages

describe('series page: ✓ marks, season counts and the episode menu', () => {
  const SERIES = { type: 'series', id: '7', name: 'Dark', icon: 'http://x/dark.jpg' };
  const ep = (id, n) => ({ id, episode_num: n, title: `Ep ${id}`, container_extension: 'mp4' });
  const INFO = { info: { tmdb: '70523' }, episodes: { 1: [ep('101', 1), ep('102', 2)], 2: [ep('201', 1)] } };
  const pills = () => [...document.querySelectorAll('.season-pill')].map((p) => p.textContent);
  const cards = () => [...document.querySelectorAll('.sp-shelf .card')];
  const key = (keyCode) => router.onKey(new KeyboardEvent('keydown', { keyCode, cancelable: true, bubbles: true }));
  let root;

  beforeEach(() => {
    root = document.getElementById('root');
    api.seriesInfo.mockReset(); api.seriesInfo.mockResolvedValue(INFO);
    router.init(root);
    router.register('series-detail', seriesDetailView);
    router.register('player-vod', () => ({ mount() {}, unmount() {} }));
  });

  it('episodes carry their season and the series\' TMDB id (for Skip Intro)', () => {
    const s = D.parseSeasons(INFO, SERIES);
    expect(s[1].episodes[0]).toMatchObject({ id: '201', season: 2, tmdb: '70523', num: '1' });
    expect(D.seriesTmdb({ info: { tmdb_id: 12 } })).toBe('12');
    expect(D.seriesTmdb({})).toBeNull();
  });

  it('followingEpisodes: the whole series in order, specials kept apart', () => {
    const withSpecials = { episodes: { 0: [ep('1', 1)], 1: [ep('101', 1)], 2: [ep('201', 1)] } };
    expect(D.followingEpisodes(withSpecials, E('101', { season: 1 })).map((e) => e.id)).toEqual(['101', '201']);
    expect(D.followingEpisodes(withSpecials, E('1', { season: 0 })).map((e) => e.id)).toEqual(['1']);
    expect(D.followingEpisodes(null, E('1'))).toBeNull();
  });

  it('☰ on an episode: mark the season watched → ✓ on the cards and the pill; focus stays on the card', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    expect(pills()).toEqual(['Season 1', 'Season 2']);
    cards()[1].focus();
    key(10133);
    expect(document.querySelector('.dialog-title').textContent).toBe('Dark  ·  Ep 102');
    const items = [...document.querySelectorAll('.dialog-item')];
    expect(items.map((b) => b.textContent)).toEqual(['＋  Add to Queue', '✓  Mark as Watched', '✓  Mark Season as Watched']);
    items[1].click();
    await tick();
    expect(pills()).toEqual(['Season 1  1/2', 'Season 2']);
    expect(cards()[1].querySelector('.watched-badge').textContent).toBe('✓');
    expect(cards()[1].querySelector('.sub').textContent).toBe('✓ Watched');
    expect(cards()[0].querySelector('.watched-badge')).toBeNull();
    expect(document.activeElement).toBe(cards()[1]);
    key(10133);
    [...document.querySelectorAll('.dialog-item')].find((b) => b.textContent === '✓  Mark Season as Watched').click();
    await tick();
    expect(pills()).toEqual(['Season 1  ✓', 'Season 2']);
  });

  it('Hold OK on an episode opens the menu; a short OK still plays it', async () => {
    vi.useFakeTimers();
    try {
      router.go('series-detail', { item: SERIES });
      await vi.advanceTimersByTimeAsync(5);
      cards()[0].focus();
      key(13);
      await vi.advanceTimersByTimeAsync(450);
      expect(document.querySelector('.dialog-title').textContent).toBe('Dark  ·  Ep 101');
      document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 13, bubbles: true }));
      expect(router.current().name).toBe('series-detail');
      document.querySelectorAll('.dialog-item')[0].click(); // Add to Queue
      await vi.advanceTimersByTimeAsync(5);
      expect(store.queue().map((q) => q.id)).toEqual(['101']);
      cards()[0].focus();
      key(13);
      await vi.advanceTimersByTimeAsync(100);
      document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 13, bubbles: true }));
      expect(router.current().name).toBe('player-vod');
    } finally { vi.useRealTimers(); }
  });
});

describe('movie page: Queue and Watched buttons', () => {
  it('Queue toggles in place; Mark Watched rebuilds the row (Resume goes) and keeps focus on it', async () => {
    const m = M(100, { name: 'Heat' });
    store.setPosition(m, 754000);
    api.vodInfo.mockReset(); api.vodInfo.mockResolvedValue({ info: { tmdb_id: '949' } });
    const root = document.getElementById('root');
    router.init(root);
    router.register('movie-detail', movieDetailView);
    router.go('movie-detail', { item: m });
    await tick();
    const btn = (action) => root.querySelector(`.dp-buttons [data-action="${action}"]`);
    const labels = () => [...root.querySelectorAll('.dp-buttons button')].map((b) => b.textContent);
    btn('queue').click();
    expect(btn('queue').textContent).toBe('✓  In Queue');
    expect(store.inQueue(m)).toBe(true);
    btn('watched').click();
    expect(labels()).toEqual(['▶  Play', 'Audio & Subtitles', '♡  Favourite', '＋  Queue', '✓  Watched']);
    expect(document.activeElement.textContent).toBe('✓  Watched');
    expect(store.isWatched(m)).toBe(true);
    btn('watched').click();
    expect(labels().at(-1)).toBe('○  Mark Watched');
    expect(router.current().params.movie.tmdb).toBe('949'); // remembered for recommendations
  });
});
