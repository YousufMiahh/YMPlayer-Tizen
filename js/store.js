// localStorage-backed store: port of Prefs.java.
// Per-account data is namespaced with "" (first/legacy account) or "{id}_".
import { key, fromJson, toJson } from './item.js';

export const DEFAULT_UA = 'XtreamPlayer/1.0 (Linux; Android; Fire TV)';
export const HOME_KEYS = ['continue', 'recent', 'fav_live', 'fav_movie', 'fav_series',
  'top_movies', 'top_series', 'new_movies', 'new_series'];

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
  return /^(fav_|favcat_|pos_|dur_|hist_|lib_time)/.test(k);
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

// ================================================================ home screen toggles

export const homeShows = (k) => getBool(`home_${k}`, true);
export const setHomeShows = (k, on) => setStr(`home_${k}`, !!on);

// ================================================================ resume positions (per account, ms)

export const position = (item) => getInt(`${ns()}pos_${key(item)}`, 0);
export function setPosition(item, ms) {
  const k = `${ns()}pos_${key(item)}`;
  if (ms <= 0) ls().removeItem(k); else setStr(k, Math.floor(ms));
}

export const duration = (item) => getInt(`${ns()}dur_${key(item)}`, 0);
export function setDuration(item, ms) {
  if (ms > 0) setStr(`${ns()}dur_${key(item)}`, Math.floor(ms));
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
