// localStorage-backed store: port of Prefs.java.
// Per-account data is namespaced with "" (first/legacy account) or "{id}_".
import { key, fromJson, toJson } from './item.js';

export const DEFAULT_UA = 'XtreamPlayer/1.0 (Linux; Android; Fire TV)';
export const HOME_KEYS = ['continue', 'recent', 'fav_live', 'fav_movie', 'fav_series',
  'top_movies', 'top_series', 'recommended', 'new_movies', 'new_series'];

export const HOME_NAMES = {
  continue: 'Continue Watching', recent: 'Recent Channels', fav_live: 'Favourite Channels',
  fav_movie: 'Favourite Movies', fav_series: 'Favourite Series', top_movies: 'Top 10 Movies in the UK',
  top_series: 'Top 10 Series in the UK', recommended: 'Because You Watched…', new_movies: 'Recently Added Movies', new_series: 'Recently Added Series',
};

const HISTORY_MAX = 40;
const ls = () => globalThis.localStorage;

// ---- raw helpers
const getStr = (k, d) => { const v = ls().getItem(k); return v === null ? d : v; };
const setStr = (k, v) => ls().setItem(k, String(v));
const getInt = (k, d) => { const n = parseInt(ls().getItem(k), 10); return Number.isNaN(n) ? d : n; };
const getBool = (k, d) => { const v = ls().getItem(k); return v === null ? d : v === 'true'; };
const getJson = (k, d) => { try { const v = JSON.parse(ls().getItem(k)); return v ?? d; } catch { return d; } };
const getArr = (k) => { const v = getJson(k, []); return Array.isArray(v) ? v : []; };
const setJson = (k, v) => ls().setItem(k, JSON.stringify(v));

// ================================================================ accounts

function normAccount(o) {
  return {
    id: o.id || '', name: o.name || '', server: o.server || '', user: o.user || '',
    pass: o.pass || '', ua: o.ua || '', ok: !!o.ok,
  };
}

export function accounts() {
  const raw = getJson('accounts', []);
  let out = Array.isArray(raw) ? raw.map(normAccount) : [];
  if (out.length === 0 && getStr('server', '') !== '') {
    // First run after multi-account: adopt the old single login (prefix "").
    out = [normAccount({
      id: '', server: getStr('server', ''), user: getStr('user', ''), pass: getStr('pass', ''),
      ua: getStr('ua', ''), ok: getBool('ok', false),
    })];
    writeAccounts(out);
    setStr('current', '');
    // Legacy keys are now owned by accounts[]; clear them so a removed login can't be re-adopted.
    for (const k of ['server', 'user', 'pass', 'ua', 'ok']) ls().removeItem(k);
  }
  return out;
}

function writeAccounts(list) { setJson('accounts', list); }

/** The account in use, or null. */
export function current() {
  const l = accounts();
  const id = ls().getItem('current');
  const hit = l.find((a) => a.id === id);
  return hit || l[0] || null;
}

export function setCurrent(id) { setStr('current', id); }

export function newAccount() {
  return normAccount({ id: accounts().length === 0 ? '' : `a${Date.now()}${Math.floor(Math.random() * 1000)}` });
}

export function saveAccount(acc) {
  const l = accounts();
  const i = l.findIndex((a) => a.id === acc.id);
  if (i >= 0) l[i] = normAccount(acc); else l.push(normAccount(acc));
  writeAccounts(l);
}

function isAccountData(k) {
  return /^(fav_|favcat_|pos_|dur_|hist_|lib_time|hide_tags|hide_cat_|show_cat_|catname_|pic_)/.test(k)
    || k === 'watched' || k === 'queue' || k === 'upnext';
}

export function removeAccount(id) {
  const wasCurrent = current()?.id === id;
  const l = accounts().filter((a) => a.id !== id);
  writeAccounts(l);
  const prefix = id === '' ? null : `${id}_`;
  const keys = [];
  for (let i = 0; i < ls().length; i++) keys.push(ls().key(i));
  for (const k of keys) {
    if (prefix !== null ? k.startsWith(prefix) : isAccountData(k)) ls().removeItem(k);
  }
  if (wasCurrent) setStr('current', l.length ? l[0].id : '');
}

/** Key prefix for the current account ("" for the first account). */
function ns() {
  const a = current();
  return !a || a.id === '' ? '' : `${a.id}_`;
}

export function hasAccount() {
  const a = current();
  return !!a && a.ok && a.server !== '' && a.user !== '';
}

export function server() { return current()?.server ?? ''; }
export function user() { return current()?.user ?? ''; }
export function pass() { return current()?.pass ?? ''; }

export function userAgent() {
  const ua = current()?.ua;
  return !ua || ua.trim() === '' ? DEFAULT_UA : ua;
}

export function setUserAgent(ua) {
  const a = current();
  if (!a) return;
  a.ua = !ua || ua === DEFAULT_UA ? '' : ua;
  saveAccount(a);
}

// ================================================================ settings (all accounts)

export const liveFormat = () => getStr('live_format', 'ts');
export const setLiveFormat = (f) => setStr('live_format', f);

export const subtitleSize = () => getInt('sub_size', 1);
export const setSubtitleSize = (s) => setStr('sub_size', s);
export const subtitleColor = () => Math.min(getInt('sub_color', 0), 5);
export const setSubtitleColor = (i) => setStr('sub_color', i);
export const subtitleBackground = () => getBool('sub_bg', false);
export const setSubtitleBackground = (b) => setStr('sub_bg', !!b);
/** 0=25%, 1=50%, 2=75%, 3=100%. */
export const subtitleOpacity = () => Math.min(getInt('sub_bg_opacity', 2), 3);
export const setSubtitleOpacity = (i) => setStr('sub_bg_opacity', i);
/** "" = provider default, "off" = no subtitles. */
export const subtitleLanguage = () => getStr('sub_lang', '');
export const setSubtitleLanguage = (l) => setStr('sub_lang', l ?? '');
export const audioLanguage = () => getStr('audio_lang', '');
export const setAudioLanguage = (l) => setStr('audio_lang', l ?? '');

export const autoRecover = () => getBool('auto_recover', true);
export const setAutoRecover = (b) => setStr('auto_recover', !!b);
export const dark = () => getBool('dark', true);
export const setDark = (b) => setStr('dark', !!b);
/** 0 off, 1 on (muted), 2 on with sound. */
export const previewMode = () => getInt('preview', 2);
export const setPreviewMode = (m) => setStr('preview', m);
/** Hours between library refreshes: 0 = every launch, -1 = manual only. */
export const refreshHours = () => getInt('refresh_hours', 12);
export const setRefreshHours = (h) => setStr('refresh_hours', h);

export const lastRefresh = () => getInt(`${ns()}lib_time`, 0);
export const setLastRefresh = (t) => setStr(`${ns()}lib_time`, t);

// ================================================================ favourites (per account)

export const favs = (type) => getArr(`${ns()}fav_${type}`).map(fromJson);

export function isFav(item) {
  return favs(item.type).some((f) => f.id === String(item.id));
}

/** @returns true if the item is now a favourite. */
export function toggleFav(item) {
  const list = favs(item.type);
  const id = String(item.id);
  const kept = list.filter((f) => f.id !== id);
  const removed = kept.length !== list.length;
  if (!removed) kept.push(fromJson(item));
  setJson(`${ns()}fav_${item.type}`, kept.map(toJson));
  return !removed;
}

/** The ids of one type's favourites, for drawing many cells at once (one read instead of one per cell). */
export const favIds = (type) => new Set(favs(type).map((f) => f.id));

export const favCategories = (type) => getArr(`${ns()}favcat_${type}`);
export const isFavCategory = (type, id) => favCategories(type).includes(String(id));

/** @returns true if the category is now a favourite. */
export function toggleFavCategory(type, id) {
  id = String(id);
  const l = favCategories(type);
  const i = l.indexOf(id);
  if (i >= 0) l.splice(i, 1); else l.push(id);
  setJson(`${ns()}favcat_${type}`, l);
  return i < 0;
}

// ================================================================ per-account lists (Filters.readSet / writeSet)

/** A saved list of strings for the current account (hide_tags, hide_cat_<type>, show_cat_<type>). */
export const accountList = (k) => getArr(`${ns()}${k}`).map(String);
export const setAccountList = (k, list) => setJson(`${ns()}${k}`, [...list].map(String));
/** Key prefix of the current account, so caches can tell accounts apart. */
export const accountNs = () => ns();

// ================================================================ home screen toggles

export const homeShows = (k) => getBool(`home_${k}`, true);
export const setHomeShows = (k, on) => setStr(`home_${k}`, !!on);

// ================================================================ resume positions (per account, ms)

export const position = (item) => getInt(`${ns()}pos_${key(item)}`, 0);
export function setPosition(item, ms) {
  clearUpNext(item); // started (or removed): an ordinary entry from now on
  const k = `${ns()}pos_${key(item)}`;
  if (ms <= 0) ls().removeItem(k); else setStr(k, Math.floor(ms));
}

export const duration = (item) => getInt(`${ns()}dur_${key(item)}`, 0);
export function setDuration(item, ms) {
  if (ms > 0) setStr(`${ns()}dur_${key(item)}`, Math.floor(ms));
}

// ================================================================ up next (Continue Watching)

const keySet = (k) => new Set(getArr(`${ns()}${k}`).map(String));
const saveKeySet = (k, set) => setJson(`${ns()}${k}`, [...set]);

/** The next episode after one you finished: shown in Continue Watching at the start. */
export function markUpNext(item) {
  addHistory(item);
  const s = keySet('upnext');
  if (!s.has(key(item))) { s.add(key(item)); saveKeySet('upnext', s); }
}

export const isUpNext = (item) => !!item && keySet('upnext').has(key(item));

function clearUpNext(item) {
  const s = keySet('upnext');
  if (s.delete(key(item))) saveKeySet('upnext', s);
}

// ================================================================ picture shape (per channel / film / series)

export const PICTURE = ['Fit', 'Fill screen (zoom)', 'Stretch', '16:9', '4:3'];
export const PICTURE_SHORT = ['Fit', 'Fill', 'Stretch', '16:9', '4:3'];

/** Episodes share their series' setting. */
const pictureKey = (item) => (item.type === 'episode' && item.parentId != null ? `series_${item.parentId}` : key(item));

/** 0 Fit, 1 Fill, 2 Stretch, 3 16:9, 4 4:3. */
export function picture(item) {
  if (!item) return 0;
  const m = getInt(`${ns()}pic_${pictureKey(item)}`, 0);
  return m > 0 && m < PICTURE.length ? m : 0;
}

export function setPicture(item, mode) {
  const k = `${ns()}pic_${pictureKey(item)}`;
  if (mode <= 0) ls().removeItem(k); else setStr(k, mode);
}

// ================================================================ already watched (per account)

/** The keys of everything marked watched, for drawing many cards at once. */
export const watchedKeys = () => keySet('watched');
export const isWatched = (item) => !!item && keySet('watched').has(key(item));

/**
 * One item or a list (a season). Watched: off Continue Watching and out of the queue;
 * unwatched: shows as new again.
 */
export function setWatched(itemOrList, watched) {
  if (!itemOrList) return;
  const list = Array.isArray(itemOrList) ? itemOrList : [itemOrList];
  const s = keySet('watched');
  for (const it of list) { if (watched) s.add(key(it)); else s.delete(key(it)); }
  saveKeySet('watched', s);
  if (!watched) return;
  for (const it of list) setPosition(it, 0);
  const gone = new Set(list.map(key));
  const q = queue();
  const kept = q.filter((x) => !gone.has(key(x)));
  if (kept.length !== q.length) saveQueue(kept);
}

export function watchedCount(items) {
  const s = keySet('watched');
  return items.reduce((n, it) => n + (s.has(key(it)) ? 1 : 0), 0);
}

// ================================================================ playback queue (per account, in order)

export const queue = () => getArr(`${ns()}queue`).map(fromJson);
const saveQueue = (l) => setJson(`${ns()}queue`, l.map(toJson));
export const inQueue = (item) => !!item && queue().some((q) => key(q) === key(item));

export function queueAdd(item) {
  const l = queue();
  if (l.some((q) => key(q) === key(item))) return;
  l.push(fromJson(item));
  saveQueue(l);
}

export function queueRemove(item) {
  if (!item) return;
  const l = queue();
  const kept = l.filter((q) => key(q) !== key(item));
  if (kept.length !== l.length) saveQueue(kept);
}

/** What plays after this (the first queued item that isn't this one), or null. */
export function queueNextAfter(cur) {
  return queue().find((q) => !cur || key(q) !== key(cur)) || null;
}

// ================================================================ your own category names (per account)

export const catName = (type, id) => { const v = ls().getItem(`${ns()}catname_${type}_${id}`); return v === null || v === '' ? null : v; };

export function setCatName(type, id, name) {
  const k = `${ns()}catname_${type}_${id}`;
  const n = name == null ? '' : String(name).trim();
  if (n === '') ls().removeItem(k); else setStr(k, n);
}

// ================================================================ watch history (per account, newest first)

export const history = (live) => getArr(`${ns()}hist_${live ? 'live' : 'vod'}`).map(fromJson);

export function addHistory(item) {
  const live = item.type === 'live';
  const k = key(item);
  const list = history(live).filter((h) => key(h) !== k);
  list.unshift(fromJson(item));
  setJson(`${ns()}hist_${live ? 'live' : 'vod'}`, list.slice(0, HISTORY_MAX).map(toJson));
}

/**
 * Prefs.clearHistory: the current account's resume points, durations and watch history
 * (pos_ / dur_ / hist_). The first account's keys have no prefix, so another account's
 * "a123_…" keys are skipped there.
 */
export function clearHistory() {
  const n = ns();
  const keys = [];
  for (let i = 0; i < ls().length; i++) keys.push(ls().key(i));
  for (const k of keys) {
    const rest = n === '' ? k : (k.startsWith(n) ? k.slice(n.length) : null);
    if (rest === null) continue;
    if (n === '' && /^a\d+_/.test(rest)) continue;
    if (rest.startsWith('pos_') || rest.startsWith('dur_') || rest.startsWith('hist_') || rest === 'upnext') ls().removeItem(k);
  }
}

/** Prefs.continueWatching: movies and episodes started but not finished. */
export function continueWatching() {
  const up = keySet('upnext');
  return history(false).filter((i) => position(i) > 0 || up.has(key(i)));
}

/** Prefs.continueMovies. */
export function continueMovies() {
  return continueWatching().filter((i) => i.type === 'movie');
}

/** Prefs.continueSeries: series you've been watching, most recent first (one entry per series). */
export function continueSeries() {
  const m = new Map();
  for (const ep of history(false)) {
    if (ep.type !== 'episode' || !ep.parentId || m.has(ep.parentId)) continue;
    const s = { type: 'series', id: String(ep.parentId), name: ep.parentName || '' };
    if (ep.parentIcon) s.icon = ep.parentIcon;
    m.set(ep.parentId, s);
  }
  return [...m.values()];
}
