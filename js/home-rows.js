// What Home shows and where its cards go: the data side of HomeActivity, Cards.shelf and Open.
// Pure functions over js/store.js (history, favourites, positions) and js/repo.js (the library).
import * as store from './store.js';
import * as repo from './repo.js';
import { LIVE, MOVIE, SERIES, EPISODE, key } from './item.js';

/** Card shapes (Cards.Shape). */
export const POSTER = 'poster';
export const CHANNEL = 'channel';
export const LANDSCAPE = 'landscape';

/** HomeActivity.buildLocalRows / buildRemoteRows, in order, with their Settings keys. */
export const LOCAL_ROWS = [
  { key: 'continue', title: 'Continue Watching', shape: LANDSCAPE },
  { key: 'recent', title: 'Recent Channels', shape: CHANNEL },
  { key: 'fav_live', title: 'Favourite Channels', shape: CHANNEL },
  { key: 'fav_movie', title: 'Favourite Movies', shape: POSTER },
  { key: 'fav_series', title: 'Favourite Series', shape: POSTER },
];
export const REMOTE_ROWS = [
  { key: 'top_movies', title: 'Top 10 Movies on Netflix UK', shape: POSTER },
  { key: 'top_series', title: 'Top 10 Series on Netflix UK', shape: POSTER },
  { key: 'new_movies', title: 'Recently Added Movies', shape: POSTER },
  { key: 'new_series', title: 'Recently Added Series', shape: POSTER },
];
export const ROWS = [...LOCAL_ROWS, ...REMOTE_ROWS];

/** Cards.titleWithMenuHint on a remote without ☰: "Hold OK to remove from list". */
export const CW_HINT = 'Hold OK to remove from list';
export const RECENT_CHANNELS = 20;   // HomeActivity: limit(prefs.history(true), 20)
export const RECENT_POOL = 300;      // HomeActivity.recent: Repo.recentlyAdded(type, 300)
export const RECENT_KEEP = 24;       //   ... filtered, then the newest 24

export const FIRST_RUN = 'Getting your channels, movies and series ready…\nThis only takes a while the first time.';
export const WELCOME = 'Welcome to YM Player\nPick Live TV, Movies or Series above to get started.';

/** Prefs.continueWatching: movies and episodes started but not finished (history order, newest first). */
export function continueWatching() {
  return store.history(false).filter((i) => store.position(i) > 0);
}

/** SeriesActivity.fmt: m:ss, or h:mm:ss from an hour. */
export function fmt(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}` : `${Math.floor(s / 60)}:${p2(s % 60)}`;
}

/** XtreamApi.joinNonEmpty: "a  ·  b", skipping blanks and "null". */
export function joinNonEmpty(...parts) {
  const kept = parts.filter((s) => s != null && String(s).trim() !== '' && s !== 'null').map((s) => String(s).trim());
  return kept.length ? kept.join('  ·  ') : null;
}

/**
 * What a Continue Watching card shows (Cards.shelf, LANDSCAPE): progress pos/dur, the "… left"
 * subtitle ("<series>  ·  12:34 left" for an episode) and, for an episode without its own still,
 * the series artwork.
 */
export function cwCard(it) {
  const pos = store.position(it); const dur = store.duration(it);
  const progress = dur > 0 ? pos / dur : 0;
  const left = dur > 0 ? `${fmt(Math.max(0, dur - pos))} left` : null;
  let image = it.icon || null;
  let sub;
  if (it.type === EPISODE) {
    sub = joinNonEmpty(it.parentName, left);
    if (!image) image = it.parentIcon || null;
  } else {
    sub = left;
  }
  return { image, sub, progress };
}

/** HomeActivity.buildLocalRows: rows kept on the TV, available instantly. */
export function localRows() {
  const out = [];
  const add = (r, items) => { if (store.homeShows(r.key) && items && items.length) out.push({ ...r, items }); };
  const [cw, recent, favLive, favMovie, favSeries] = LOCAL_ROWS;
  add(cw, continueWatching());
  add(recent, store.history(true).slice(0, RECENT_CHANNELS));
  add(favLive, store.favs(LIVE));
  add(favMovie, store.favs(MOVIE));
  add(favSeries, store.favs(SERIES));
  return out;
}

/**
 * HomeActivity.buildRemoteRows from what has been loaded so far.
 * @param data {topMovies, topSeries, newMovies, newSeries} (null = not loaded yet)
 */
export function remoteRows(data = {}) {
  const lists = [data.topMovies, data.topSeries, data.newMovies, data.newSeries];
  const out = [];
  REMOTE_ROWS.forEach((r, i) => {
    const items = lists[i];
    if (store.homeShows(r.key) && items && items.length) out.push({ ...r, items });
  });
  return out;
}

// Filters.items (hidden categories and countries) arrives with the Browse filters; until then
// this hook keeps everything.
let filterItems = (type, list) => list;
export function setFilter(fn) { filterItems = fn || ((type, list) => list); }

/** HomeActivity.recent: the newest 300, minus hidden categories and countries, then 24. */
export async function recentlyAdded(type) {
  const l = filterItems(type, await repo.recentlyAdded(type, RECENT_POOL));
  return l.slice(0, RECENT_KEEP);
}

/** HomeActivity.sig: the keys in order, so rows only rebuild when the list really changed. */
export function sig(list) {
  return (list || []).map((it) => `${key(it)},`).join('');
}

/** HomeActivity.pick: a live channel zaps through Recent Channels if it's there, else Favourite Channels. */
export function liveSiblings(it) {
  for (const l of [store.history(true), store.favs(LIVE)]) {
    if (l.some((x) => key(x) === key(it))) return l;
  }
  return null;
}

/**
 * Open.item: where a card goes.
 *   movie -> movie details (Continue Watching too), series -> series screen,
 *   live -> the player with the zap queue, episode -> straight into the player (one-item queue).
 * @returns {{name: string, params: object}}
 */
export function openTarget(it, siblings = null) {
  if (it.type === MOVIE) return { name: 'movie-detail', params: { item: it } };
  if (it.type === SERIES) return { name: 'series-detail', params: { item: it } };
  if (it.type === LIVE) {
    let q = (siblings || []).filter((s) => s.type === LIVE);
    let idx = q.findIndex((s) => key(s) === key(it)); // the list may hold a different copy of it
    if (idx < 0) { q = [it]; idx = 0; }
    return { name: 'player-live', params: { channels: q, index: idx } };
  }
  // PlayerActivity.play(resume): resumes from the saved point when it is past 10 s.
  const pos = store.position(it);
  return { name: 'player-vod', params: { item: it, queue: [it], index: 0, startMs: pos > 10000 ? pos : 0 } };
}

/** Open.toggleFav's toast text. */
export function favToast(now, it) {
  return `${now ? 'Added to Favourites — ' : 'Removed from Favourites — '}${it.name || ''}`;
}

/** HomeActivity.removeMenu: the dialog message ("Series · Episode" for an episode). */
export function removeName(it) {
  return it.type === EPISODE && it.parentName ? `${it.parentName} · ${it.name || ''}` : (it.name || '');
}
