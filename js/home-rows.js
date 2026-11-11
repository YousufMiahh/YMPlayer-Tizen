// Pure row builders for the Home screen. Each row: {key, title, items}.
import * as store from './store.js';
import * as api from './api.js';
import { MOVIE, SERIES } from './item.js';

// No TMDB key in v1; Task 13 formalises this (js/keys.js).
export const hasTmdb = () => false;

const RECENT_LIMIT = 20;
const byAddedDesc = (a, b) => (Number(b.added) || 0) - (Number(a.added) || 0);

export const ROWS = [
  { key: 'continue', title: 'Continue Watching' },
  { key: 'recent', title: 'Recent Channels' },
  { key: 'fav_live', title: 'Favourite Channels' },
  { key: 'fav_movie', title: 'Favourite Movies' },
  { key: 'fav_series', title: 'Favourite Series' },
  { key: 'top_movies', title: 'Top 10 Movies in the UK', needsTmdb: true },
  { key: 'top_series', title: 'Top 10 Series in the UK', needsTmdb: true },
  { key: 'new_movies', title: 'Recently Added Movies', type: MOVIE },
  { key: 'new_series', title: 'Recently Added Series', type: SERIES },
];

/** VOD history entries with a saved position, newest first (history is already newest first). */
export function continueWatching() {
  return store.history(false).filter((i) => store.position(i) > 0);
}

export function sortRecentlyAdded(list) {
  return [...list].sort(byAddedDesc).slice(0, RECENT_LIMIT);
}

const cache = new Map();
export function clearCache() { cache.clear(); }

async function recentlyAdded(type) {
  if (!cache.has(type)) {
    const list = await api.streams(type, null);
    cache.set(type, sortRecentlyAdded(list));
  }
  return cache.get(type);
}

/** Rows (in display order) that are enabled and non-empty. Failed/empty rows are dropped. */
export async function buildRows() {
  const out = [];
  for (const r of ROWS) {
    if (!store.homeShows(r.key)) continue;
    if (r.needsTmdb && !hasTmdb()) continue;
    let items = [];
    try {
      if (r.key === 'continue') items = continueWatching();
      else if (r.key === 'recent') items = store.history(true);
      else if (r.key.startsWith('fav_')) items = store.favs(r.key.slice(4));
      else if (r.type) items = await recentlyAdded(r.type);
    } catch { items = []; }
    if (items.length) out.push({ key: r.key, title: r.title, items });
  }
  return out;
}
