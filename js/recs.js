// Recs.java: "Because you watched …" rows for Home. TMDB's recommendations for the films and
// series you've watched most recently, showing only the ones your provider actually has (and not
// ones you've already watched). If TMDB has nothing that matches, a simple "Recommended for You"
// row picks series in the genres you watch.
import * as store from './store.js';
import * as repo from './repo.js';
import * as filters from './filters.js';
import * as tmdb from './tmdb.js';
import * as top10 from './top10.js';
import { MOVIE, SERIES, EPISODE, key } from './item.js';

export const KEEP_MS = 6 * 3600000;
export const RETRY_MS = 5 * 60000;
export const MAX_SOURCES = 3;
export const MAX_ITEMS = 20;
export const MIN_ITEMS = 3;
/** Only what you actually watched: finished, or at least this far in. */
export const MIN_WATCHED_MS = 5 * 60000;

let cached = null; let cachedFor = ''; let cachedAt = 0;
/** Tests. */
export function _reset() { cached = null; cachedFor = ''; cachedAt = 0; }

/** What you've been watching: newest first, one per film / series. */
export function sources() {
  const m = new Map();
  for (const h of store.history(false)) {
    if (m.size >= MAX_SOURCES) break;
    // Not something only opened, started by accident or played on its own for a moment
    if (!store.isWatched(h) && store.position(h) < MIN_WATCHED_MS) continue;
    // "Don't recommend based on this"
    if (store.recBlocked(h.type === EPISODE && h.parentId != null ? `${SERIES}:${h.parentId}` : key(h))) continue;
    if (h.type === MOVIE) m.set(key(h), h);
    else if (h.type === EPISODE && h.parentId != null) {
      const s = { type: SERIES, id: String(h.parentId), name: h.parentName || '' };
      if (h.parentIcon) s.icon = h.parentIcon;
      if (h.tmdb) s.tmdb = h.tmdb;
      if (!m.has(key(s))) m.set(key(s), s);
    }
  }
  return [...m.values()];
}

async function library(type) {
  let l = repo.cached(type);
  if (!l && repo.hasLibrary()) l = await repo.streams(type).catch(() => null);
  return l ? filters.items(type, l) : [];
}

function genres(info) {
  return String(info).split(/·|,|\/|&/).map((p) => p.trim().toLowerCase())
    .filter((t) => t !== '' && !t.startsWith('★') && t.length < 30);
}

function rating(info) {
  if (info == null) return 0;
  const i = String(info).indexOf('★');
  if (i < 0) return 0;
  const n = Number.parseFloat(String(info).slice(i + 1).trim().split(/\s/)[0]);
  return Number.isFinite(n) ? n : 0;
}

/** Fallback: series sharing a genre with what you watch, best rated first. */
export function byGenre(series, watched) {
  const want = new Set(); const seen = new Set();
  const byId = new Map(series.map((s) => [String(s.id), s]));
  for (const w of watched) {
    seen.add(key(w));
    const full = byId.get(String(w.id));
    if (full && full.info != null) for (const g of genres(full.info)) want.add(g);
  }
  if (!want.size) return [];
  const done = store.watchedKeys();
  const out = series.filter((s) => !seen.has(key(s)) && s.info != null && !done.has(key(s)) && genres(s.info).some((g) => want.has(g)));
  out.sort((a, b) => rating(b.info) - rating(a.info));
  return out.slice(0, MAX_ITEMS);
}

/** [{title, items}] (may be empty). Cached for six hours per account and set of sources. */
export async function rows(now = () => Date.now()) {
  const src = sources();
  const sig = `${store.accountNs()}[${src.map(key).join(', ')}]`;
  if (cached && sig === cachedFor && now() - cachedAt < KEEP_MS) return cached;
  const out = [];
  if (!src.length) return out;

  const movies = await library(MOVIE); const series = await library(SERIES);
  tmdb.state.failed = false;
  const shown = new Set();
  const done = store.watchedKeys();
  for (const s of src) {
    const tv = s.type === SERIES;
    const kind = tv ? tmdb.TV : tmdb.MOVIE;
    const id = await tmdb.findId(kind, s.name, s.tmdb);
    if (id === null) continue;
    const found = await top10.matchAsync(await tmdb.recommendations(kind, id), tv ? series : movies);
    const keep = [];
    for (const it of found) {
      if (key(it) === key(s) || done.has(key(it)) || shown.has(key(it))) continue;
      shown.add(key(it));
      keep.push(it);
      if (keep.length >= MAX_ITEMS) break;
    }
    const name = tmdb.cleanName(s.name)[0];
    if (keep.length >= MIN_ITEMS) {
      const shownName = name === '' ? s.name : name;
      out.push({ title: `Because you watched ${shownName}`, items: keep, sourceKey: key(s), sourceName: shownName });
    }
  }
  if (!out.length) {
    const g = byGenre(series, src);
    if (g.length >= MIN_ITEMS) out.push({ title: 'Recommended for You', items: g });
  }
  cached = out;
  cachedFor = sig;
  // Couldn't reach TMDB (e.g. the network isn't up yet): try again in a few minutes, not hours
  cachedAt = tmdb.state.failed ? now() - KEEP_MS + RETRY_MS : now();
  return out;
}
