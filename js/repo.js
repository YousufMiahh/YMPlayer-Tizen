// Library store: port of Repo.java.
//
// Memory first, then the copy saved on the TV, then the provider. The saved copy (IndexedDB; the
// lists are far too big for localStorage) makes browsing and search instant after the first
// download, and is refreshed on the user's schedule (Prefs refresh_hours, per-account lib_time).
// Readers keep using the old copy until a new one has fully downloaded, so a failed refresh never
// loses the library.
//
// Saved records are named like Android's files: lib_<hash(base|user)>_<type>_<cats|all>.
import * as api from './api.js';
import * as store from './store.js';
import { LIVE, MOVIE, SERIES } from './item.js';
import { normalize } from './url.js';

export const TYPES = [LIVE, MOVIE, SERIES];

// ------------------------------------------------------------ storage backends

/** Java String.hashCode() as Integer.toHexString(), so record names match Android's file names. */
export function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Plain Map backend: used when IndexedDB is unavailable (jsdom, or a TV that refuses it). */
export function memoryBackend() {
  const m = new Map();
  return {
    kind: 'memory',
    has: (k) => m.has(k),
    keys: () => [...m.keys()],
    async get(k) { return m.get(k); },
    async put(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
  };
}

const MANIFEST = 'lib_saved';

/**
 * IndexedDB backend. The names of the saved records are mirrored in localStorage ("lib_saved") so
 * that hasLibrary() can answer synchronously, as File.exists() does on Android. If the database
 * cannot be opened, it falls back to memory for the rest of the session.
 */
export function idbBackend(idb = globalThis.indexedDB, name = 'ymplayer-library') {
  const ls = globalThis.localStorage;
  let saved;
  try { saved = new Set(JSON.parse(ls.getItem(MANIFEST)) || []); } catch { saved = new Set(); }
  const persist = () => { try { ls.setItem(MANIFEST, JSON.stringify([...saved])); } catch { /* full */ } };
  let mem = null;
  const fallBack = () => {
    if (!mem) { mem = memoryBackend(); saved.clear(); persist(); }
    return mem;
  };
  const dbp = new Promise((resolve, reject) => {
    let req;
    try { req = idb.open(name, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { req.result.createObjectStore('lib'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbp.catch(fallBack);

  function run(mode, fn) {
    return dbp.then((db) => new Promise((resolve, reject) => {
      const t = db.transaction('lib', mode);
      const r = fn(t.objectStore('lib'));
      let out;
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
    }));
  }
  const ready = () => dbp.then(() => null, () => fallBack());

  return {
    get kind() { return mem ? 'memory' : 'indexeddb'; },
    has: (k) => (mem ? mem.has(k) : saved.has(k)),
    keys: () => (mem ? mem.keys() : [...saved]),
    async get(k) {
      const m = await ready();
      if (m) return m.get(k);
      if (!saved.has(k)) return undefined;
      const v = await run('readonly', (os) => os.get(k));
      if (v === undefined) { saved.delete(k); persist(); } // cleared behind our back
      return v;
    },
    async put(k, v) {
      const m = await ready();
      if (m) { await m.put(k, v); return; }
      await run('readwrite', (os) => os.put(v, k));
      saved.add(k); persist();
    },
    async del(k) {
      const m = await ready();
      if (m) { await m.del(k); return; }
      saved.delete(k); persist();
      await run('readwrite', (os) => os.delete(k));
    },
  };
}

let backend = null;
function disk() {
  if (!backend) {
    let idb = null;
    try { idb = globalThis.indexedDB || null; } catch { idb = null; }
    backend = idb ? idbBackend(idb) : memoryBackend();
  }
  return backend;
}

// ------------------------------------------------------------ memory

const LISTS = new Map(); // "type|cat" ("type|*" = everything) -> Item[]
const CATS = new Map(); // type -> category Item[]
const IDS = new Map(); // type -> Map(id -> Item), built on first use
const RECENT = new Map(); // type -> Item[] newest first, built on first use
const inflight = new Map(); // one download/read per key at a time (Repo.lock)
const downloads = new Map(); // "account|type" -> running downloadType promise
let account = null;
let generation = 0; // bumps whenever memory is dropped: late results from before are not kept
let refreshing = false;
let setupRunning = false;
let setupAccount = null;
let setupPromise = null;
let setupListener = null;
let onUpdated = null;

const accountKey = () => `${normalize(store.server())}|${store.user()}`;
const fileFor = (acct, type, kind) => `lib_${hash(acct)}_${type}_${kind}`;
const file = (type, kind) => fileFor(accountKey(), type, kind);
/** Name of the saved record for the current account, e.g. "lib_1a2b3c_live_all". */
export const fileName = (type, kind) => file(type, kind);

function dropMemory() {
  LISTS.clear(); CATS.clear(); IDS.clear(); RECENT.clear(); inflight.clear();
  generation++;
}

/** Repo.check: a different account means a different library. */
function check() {
  const k = accountKey();
  if (k !== account) { dropMemory(); account = k; }
}

function lock(key, fn) {
  const k = `${generation}|${key}`;
  const busy = inflight.get(k);
  if (busy) return busy;
  const p = Promise.resolve().then(() => fn(generation));
  inflight.set(k, p);
  const done = () => { if (inflight.get(k) === p) inflight.delete(k); };
  p.then(done, done);
  return p;
}

async function readFile(f) {
  const d = disk();
  if (!d.has(f)) return null;
  try {
    const v = await d.get(f);
    if (Array.isArray(v)) return v;
  } catch { /* unreadable: forget it, like Repo.readFile deleting a bad file */ }
  try { await d.del(f); } catch { /* ignore */ }
  return null;
}

async function writeFile(f, list) {
  try { await disk().put(f, list); } catch { /* Repo.writeFile: the saved copy is optional */ }
}

function forgetType(type) {
  for (const k of [...LISTS.keys()]) if (k.startsWith(`${type}|`)) LISTS.delete(k);
  IDS.delete(type); RECENT.delete(type);
}

function notifyUpdated() {
  const r = onUpdated;
  if (r) { try { r(); } catch (err) { console.error('repo onUpdated failed', err); } }
}

// ------------------------------------------------------------ public API

/** Category list of one type: memory -> saved copy -> provider. */
export async function categories(type) {
  check();
  const c = CATS.get(type);
  if (c) return c;
  return lock(`cat${type}`, async (gen) => {
    const again = CATS.get(type);
    if (again) return again;
    const f = file(type, 'cats');
    let list = await readFile(f);
    if (!list) {
      if (gen !== generation) throw new Error('The account changed');
      list = await api.categories(type);
      await writeFile(f, list);
    }
    if (gen === generation) CATS.set(type, list);
    return list;
  });
}

/** Whole library of one type: memory -> saved copy -> provider. Only one download per type at a time. */
function all(type) {
  return lock(type, async (gen) => {
    const key = `${type}|*`;
    const have = LISTS.get(key);
    if (have) return have;
    const f = file(type, 'all');
    let list = await readFile(f);
    const dl = downloads.get(`${account}|${type}`);
    if (!list && dl) { // nothing saved, but Setup/refresh is fetching it right now: share that download
      await dl.catch(() => {});
      const got = LISTS.get(key);
      if (got) return got;
      list = await readFile(f);
    }
    if (!list) {
      if (gen !== generation) throw new Error('The account changed');
      list = await api.streams(type, null);
      await writeFile(f, list);
    }
    if (gen === generation) { forgetType(type); LISTS.set(key, list); }
    return list;
  });
}

/**
 * Items of one type, optionally in one category. Once the whole list exists (in memory or saved),
 * categories are filtered from it locally; only a first-ever visit with nothing saved asks the
 * provider for just that category.
 * @param cat category id, or null for everything of that type.
 */
export async function streams(type, cat = null) {
  check();
  const gen = generation;
  const key = `${type}|${cat === null || cat === undefined ? '*' : cat}`;
  const have = LISTS.get(key);
  if (have) return have;
  const whole = cat === null || cat === undefined;
  let everything = whole ? null : LISTS.get(`${type}|*`) || null;
  if (!everything && (whole || disk().has(file(type, 'all')))) everything = await all(type);
  if (whole) return everything;
  let l;
  if (everything) {
    const id = String(cat);
    l = everything.filter((it) => it.categoryId === id);
  } else {
    l = await api.streams(type, cat); // first ever visit and no full list yet: just this category
  }
  if (gen === generation) LISTS.set(key, l);
  return l;
}

/** What is already in memory (null if not loaded yet). Never waits or downloads. */
export function cached(type, cat = null) {
  return LISTS.get(`${type}|${cat === null || cat === undefined ? '*' : cat}`) || null;
}

/** Item by id from the whole list in memory (null if that list isn't loaded or has no such id). */
export function byId(type, id) {
  const l = LISTS.get(`${type}|*`);
  if (!l) return null;
  let idx = IDS.get(type);
  if (!idx) {
    idx = new Map();
    for (const it of l) idx.set(it.id, it);
    IDS.set(type, idx);
  }
  return idx.get(String(id)) || null;
}

/** Newest first by the provider's "added" time (series: last_modified). */
export async function recentlyAdded(type, n) {
  const l = await streams(type, null);
  let sorted = RECENT.get(type);
  if (!sorted || LISTS.get(`${type}|*`) !== l) {
    sorted = [...l].sort((a, b) => (Number(b.added) || 0) - (Number(a.added) || 0));
    if (LISTS.get(`${type}|*`) === l) RECENT.set(type, sorted);
  }
  return sorted.slice(0, Math.min(n, sorted.length));
}

/** Forget the in-memory copy (the saved copy stays until the next refresh). */
export function clear() {
  dropMemory();
}

/** True if a saved copy of all three libraries exists for the current account. */
export function hasLibrary() {
  if (!store.current()) return false;
  return TYPES.every((t) => disk().has(file(t, 'all')));
}

/** True if the saved library is missing or older than the user's refresh setting. */
export function isDue(now = Date.now()) {
  const h = store.refreshHours();
  const last = store.lastRefresh();
  if (last === 0) return true;
  if (h < 0) return false;
  if (h === 0) return true;
  return now - last > h * 3600000;
}

export const isRefreshing = () => refreshing || setupRunning;
export const isSetupRunning = () => setupRunning;

/** Items read so far by the running whole-list download of `type` (XtreamApi.progress). */
export function progress(type) {
  return typeof api.progress === 'function' ? api.progress(type) : 0;
}

/** Called whenever a section's list has been replaced (e.g. Home reloads its rows). */
export function setOnUpdated(fn) { onUpdated = fn || null; }

/**
 * Downloads one section (categories + everything in it), saves it and swaps it into memory.
 * If either request fails nothing is replaced, so the old copy keeps working.
 * @returns number of items
 */
export function downloadType(type) {
  check();
  const k = `${account}|${type}`;
  const p = download(type);
  downloads.set(k, p);
  const done = () => { if (downloads.get(k) === p) downloads.delete(k); };
  p.then(done, done);
  return p;
}

async function download(type) {
  const gen = generation;
  const acct = account;
  // api.js reads the current account per request: never save one account's list under another's name.
  const same = () => { if (accountKey() !== acct) throw new Error('The account changed'); };
  const cats = await api.categories(type);
  same();
  const list = await api.streams(type, null);
  await writeFile(fileFor(acct, type, 'cats'), cats);
  await writeFile(fileFor(acct, type, 'all'), list);
  if (gen === generation) {
    forgetType(type);
    LISTS.set(`${type}|*`, list);
    CATS.set(type, cats);
  }
  notifyUpdated();
  return list.length;
}

/** Re-downloads Live TV, Movies and Series, then records the time (per account). */
export async function refreshAll() {
  check();
  const acct = account;
  refreshing = true;
  try {
    for (const t of TYPES) await downloadType(t);
    if (accountKey() === acct) store.setLastRefresh(Date.now());
  } finally {
    refreshing = false;
  }
}

/** Starts a background refresh if one is due. Resolves true when one ran and finished. */
export function refreshIfDue(whenDone) {
  if (refreshing || !isDue()) return Promise.resolve(false);
  return refreshAll().then(() => { if (whenDone) whenDone(); return true; }, () => false);
}

/** Warm memory from the saved copy, one section at a time (makes search instant). */
export async function preload() {
  for (const t of TYPES) {
    if (refreshing) return;
    try { if (disk().has(file(t, 'all'))) await streams(t, null); } catch { /* ignore */ }
  }
}

/**
 * SplashActivity's warm-up: with a saved library, load Live TV and every section's categories
 * into memory while the logo shows. @returns false when there is nothing saved yet.
 */
export async function warmUp() {
  if (!hasLibrary()) return false;
  await streams(LIVE, null);
  for (const t of TYPES) await categories(t);
  return true;
}

/** Delete the saved library of one account (Settings -> Remove This Account). */
export async function deleteFiles(server, user) {
  const prefix = `lib_${hash(`${normalize(server)}|${user}`)}_`;
  const d = disk();
  for (const k of d.keys()) if (k.startsWith(prefix)) { try { await d.del(k); } catch { /* ignore */ } }
}

// ------------------------------------------------------------ first-time setup

/**
 * Progress callbacks for the Setup screen:
 * { started(type), finished(type, count, error), allDone(ok) }.
 */
export function setSetupListener(l) { setupListener = l ? { l, acct: accountKey() } : null; }

function emit(acct, name, ...args) {
  const l = setupListener && setupListener.acct === acct ? setupListener.l : null;
  if (l && typeof l[name] === 'function') {
    try { l[name](...args); } catch (err) { console.error('setup listener failed', err); }
  }
}

async function setupStep(acct, type) {
  emit(acct, 'started', type);
  let n = -1; let err = null;
  try { n = await downloadType(type); } catch (e) { err = e || new Error('Download failed'); }
  emit(acct, 'finished', type, n, err);
  return err === null;
}

/**
 * Downloads the given sections: Live TV first (so it's ready soonest), then Movies and Series at
 * the same time. Keeps going if the Setup screen is left. If a setup for another account is
 * still finishing, this one starts after it.
 * @returns Promise<boolean> all ok
 */
export function startSetup(types = TYPES) {
  check();
  const acct = account;
  if (setupRunning && setupAccount === acct) return setupPromise;
  const before = setupRunning ? setupPromise : Promise.resolve();
  setupRunning = true;
  setupAccount = acct;
  const p = before.catch(() => {}).then(async () => {
    setupRunning = true;
    let ok = true;
    if (types.includes(LIVE)) ok = await setupStep(acct, LIVE);
    const rest = [MOVIE, SERIES].filter((t) => types.includes(t));
    const results = await Promise.all(rest.map((t) => setupStep(acct, t)));
    ok = ok && results.every(Boolean);
    if (ok && accountKey() === acct) store.setLastRefresh(Date.now());
    if (setupPromise === p) { setupRunning = false; setupAccount = null; }
    emit(acct, 'allDone', ok);
    return ok;
  });
  setupPromise = p;
  return p;
}

// ------------------------------------------------------------ tests

/** Test hook: use this storage backend (memoryBackend(), idbBackend(fake)) and forget everything. */
export function _setBackend(b) { backend = b; _reset(true); }

/** Test hook: drop memory, flags and listeners (and the backend unless keepBackend). */
export function _reset(keepBackend = false) {
  dropMemory();
  account = null;
  downloads.clear();
  refreshing = false; setupRunning = false; setupAccount = null; setupPromise = null;
  setupListener = null; onUpdated = null;
  if (!keepBackend) backend = null;
}

export const _backend = () => disk();
