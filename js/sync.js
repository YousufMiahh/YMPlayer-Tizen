// Cross-device sync for this TV: reads and writes this app's own storage in the shared format
// (see sync-core.js) and talks to the sync server (Supabase: two functions, nothing else).
import * as core from './sync-core.js';
import { sha256 } from './lib/noble.js';
import { SYNC_URL, SYNC_KEY } from './sync-config.js';
import * as store from './store.js';
import { changed as filtersChanged } from './filters.js';

const ls = () => globalThis.localStorage;
const getJson = (k, d) => { try { const v = JSON.parse(ls().getItem(k)); return v ?? d; } catch { return d; } };
const arr = (k) => { const v = getJson(k, []); return Array.isArray(v) ? v : []; };
const TYPES = ['live', 'movie', 'series'];
/** The maps this app keeps (no per-title audio sync here). */
export const MAPS = core.MAPS.filter((m) => m !== 'adelay');

// ================================================================ items in the shared format

const WIRE = { categoryId: 'cat', parentId: 'pid', parentName: 'pname', parentIcon: 'picon', duration: 'dur' };
const LOCAL = Object.fromEntries(Object.entries(WIRE).map(([a, b]) => [b, a]));

export function toWire(it) {
  const o = {};
  for (const [k, v] of Object.entries(it || {})) if (v !== undefined && v !== null) o[WIRE[k] || k] = v;
  return o;
}

export function fromWire(o) {
  const it = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') it[LOCAL[k] || k] = v;
  if (it.id !== undefined) it.id = String(it.id);
  if (it.season !== undefined) it.season = Number(it.season);
  return it;
}

const keyOf = (it) => `${it.type}:${it.id}`;

// ================================================================ this device's data

/** Keys of the current account (the first account's have no prefix: skip other accounts' "a123_…"). */
function accountKeys() {
  const n = store.accountNs();
  const out = [];
  for (let i = 0; i < ls().length; i++) {
    const k = ls().key(i);
    if (n === '') { if (!/^a\d+_/.test(k)) out.push(k); } else if (k.startsWith(n)) out.push(k.slice(n.length));
  }
  return out;
}

export function readLocal() {
  const n = store.accountNs();
  const st = { hist: {} };
  for (const m of MAPS) st[m] = {};
  const histItems = new Map();
  for (const kind of ['live', 'vod']) {
    arr(`${n}hist_${kind}`).forEach((h, o) => {
      const w = toWire(h);
      st.hist[keyOf(h)] = { o, i: w };
      histItems.set(keyOf(h), w);
    });
  }
  for (const k of accountKeys()) {
    if (k.startsWith('pos_')) {
      const ik = k.slice(4);
      const p = parseInt(ls().getItem(n + k), 10);
      if (!(p > 0)) continue;
      const e = { p, d: parseInt(ls().getItem(`${n}dur_${ik}`), 10) || 0 };
      if (histItems.has(ik)) e.i = histItems.get(ik);
      st.pos[ik] = e;
    } else if (k.startsWith('catname_')) {
      const rest = k.slice(8);
      const u = rest.indexOf('_');
      const v = ls().getItem(n + k);
      if (u > 0 && v) st.catname[`${rest.slice(0, u)}:${rest.slice(u + 1)}`] = { n: v };
    } else if (k.startsWith('pic_')) {
      const m = parseInt(ls().getItem(n + k), 10);
      if (m > 0) st.pic[k.slice(4)] = { m };
    }
  }
  for (const k of arr(`${n}upnext`)) st.up[k] = histItems.has(k) ? { i: histItems.get(k) } : {};
  for (const k of arr(`${n}watched`)) st.watched[k] = {};
  for (const k of arr(`${n}rec_block`)) st.recblock[String(k)] = {};
  for (const t of arr(`${n}hide_tags`)) st.hidetag[String(t)] = {};
  for (const type of TYPES) {
    arr(`${n}fav_${type}`).forEach((f, o) => { st.fav[keyOf({ type, id: f.id })] = { o, i: toWire({ ...f, type }) }; });
    for (const id of arr(`${n}favcat_${type}`)) st.favcat[`${type}:${id}`] = {};
    for (const id of arr(`${n}hide_cat_${type}`)) st.hidecat[`${type}:${id}`] = {};
    for (const id of arr(`${n}show_cat_${type}`)) st.showcat[`${type}:${id}`] = {};
  }
  arr(`${n}queue`).forEach((q, o) => { st.queue[keyOf(q)] = { o, i: toWire(q) }; });
  return st;
}

const sorted = (m) => Object.entries(m).sort((a, b) => (a[1].o ?? 0) - (b[1].o ?? 0));
const typeOf = (k) => k.slice(0, k.indexOf(':'));
const idOf = (k) => k.slice(k.indexOf(':') + 1);
const setJson = (k, v) => ls().setItem(k, JSON.stringify(v));

/** Writes what differs between `next` and `prev` (what readLocal gave). True if anything changed. */
export function writeLocal(next, prev) {
  const n = store.accountNs();
  let any = false;
  const diff = (m) => { const d = !core.sameMap(m, next[m], prev[m]); if (d) any = true; return d; };
  if (diff('pos')) {
    for (const k of Object.keys(prev.pos)) if (!next.pos[k]) { ls().removeItem(`${n}pos_${k}`); }
    for (const [k, e] of Object.entries(next.pos)) {
      ls().setItem(`${n}pos_${k}`, String(Math.floor(e.p)));
      if (e.d > 0) ls().setItem(`${n}dur_${k}`, String(Math.floor(e.d)));
    }
  }
  if (diff('up')) setJson(`${n}upnext`, Object.keys(next.up));
  if (diff('watched')) setJson(`${n}watched`, Object.keys(next.watched));
  if (diff('recblock')) setJson(`${n}rec_block`, Object.keys(next.recblock));
  let filters = false;
  if (diff('hidetag')) { setJson(`${n}hide_tags`, Object.keys(next.hidetag)); filters = true; }
  if (diff('fav')) {
    for (const type of TYPES) setJson(`${n}fav_${type}`, sorted(next.fav).filter(([k]) => typeOf(k) === type).map(([, e]) => fromWire(e.i)));
  }
  for (const [m, pre] of [['favcat', 'favcat_'], ['hidecat', 'hide_cat_'], ['showcat', 'show_cat_']]) {
    if (!diff(m)) continue;
    if (m !== 'favcat') filters = true;
    for (const type of TYPES) setJson(`${n}${pre}${type}`, Object.keys(next[m]).filter((k) => typeOf(k) === type).map(idOf));
  }
  if (diff('catname')) {
    filters = true;
    for (const k of Object.keys(prev.catname)) if (!next.catname[k]) ls().removeItem(`${n}catname_${typeOf(k)}_${idOf(k)}`);
    for (const [k, e] of Object.entries(next.catname)) ls().setItem(`${n}catname_${typeOf(k)}_${idOf(k)}`, e.n);
  }
  if (diff('queue')) setJson(`${n}queue`, sorted(next.queue).map(([, e]) => fromWire(e.i)));
  if (diff('pic')) {
    for (const k of Object.keys(prev.pic)) if (!next.pic[k]) ls().removeItem(`${n}pic_${k}`);
    for (const [k, e] of Object.entries(next.pic)) ls().setItem(`${n}pic_${k}`, String(e.m));
  }
  if (diff('hist')) {
    for (const kind of ['live', 'vod']) {
      const list = sorted(next.hist).filter(([k]) => (typeOf(k) === 'live') === (kind === 'live')).map(([, e]) => fromWire(e.i));
      setJson(`${n}hist_${kind}`, list);
    }
  }
  if (filters) filtersChanged();
  return any;
}

// ================================================================ the server

let SURL = SYNC_URL, SKEY = SYNC_KEY;
/** Tests: point at a fake server. */
export function _configure(url, key) { SURL = url; SKEY = key; }
export const configured = () => !!(SURL && SKEY);

async function rpc(fn, body) {
  const headers = { apikey: SKEY, 'Content-Type': 'application/json' };
  if (SKEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SKEY}`;
  const r = await fetch(`${SURL.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`sync ${fn}: HTTP ${r.status}`);
  return r.json();
}

// ================================================================ running it

function keysFor(acc) {
  const n = store.accountNs();
  const fp = core.hex(sha256(new TextEncoder().encode(`${acc.server}\n${acc.user}\n${acc.pass}`)));
  const saved = getJson(`${n}sync_keys`, null);
  if (saved && saved.fp === fp && saved.id && saved.key) {
    const key = new Uint8Array(saved.key.match(/../g).map((h) => parseInt(h, 16)));
    return { id: saved.id, key };
  }
  const k = core.deriveKeys(acc.server, acc.user, acc.pass);
  setJson(`${n}sync_keys`, { fp, id: k.id, key: core.hex(k.key) });
  return k;
}

let running = null;
let again = false;
let timer = null;
const listeners = new Set();

/** Called with no arguments after a sync changed what's on this TV. */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export const status = () => getJson(`${store.accountNs()}sync_status`, null);
const setStatus = (s) => setJson(`${store.accountNs()}sync_status`, s);

/** One sync now (or straight after the one already running). Resolves true if this TV changed. */
export function syncNow() {
  if (running) { again = true; return running; }
  running = (async () => {
    try { return await once(); } finally {
      running = null;
      if (again) { again = false; syncNow(); }
    }
  })();
  return running;
}

async function once() {
  if (!configured() || !store.hasAccount() || !store.syncEnabled()) return false;
  const acc = store.current();
  const n = store.accountNs();
  try {
    const { id, key } = keysFor(acc);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (store.accountNs() !== n) return false; // switched account meanwhile
      const shadow = getJson(`${n}sync_shadow`, null);
      const prev = readLocal();
      const now = Date.now();
      const local = core.stamp(prev, shadow, now, MAPS);
      const rows = await rpc('ym_sync_get', { p_id: id });
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      let remote = null;
      if (row) { try { remote = core.decrypt(key, row.data); } catch { remote = null; } }
      const { doc, dirty } = remote ? core.merge(local, remote, now) : { doc: core.merge(local, core.emptyDoc(), now).doc, dirty: true };
      if (dirty) {
        const v = await rpc('ym_sync_put', { p_id: id, p_data: core.encrypt(key, doc), p_version: row ? row.version : 0 });
        if (v === null || v === undefined) continue; // another device saved first: merge with theirs
      }
      if (store.accountNs() !== n) return false;
      const changedHere = writeLocal(core.toState(doc), prev);
      setJson(`${n}sync_shadow`, doc);
      setStatus({ ok: true, at: Date.now() });
      if (changedHere) for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
      return changedHere;
    }
    setStatus({ ok: false, at: Date.now(), error: 'busy' });
  } catch (e) {
    console.warn('sync failed', e);
    setStatus({ ok: false, at: Date.now(), error: String(e && e.message || e) });
  }
  return false;
}

/** A sync a few seconds from now (many quick changes become one). */
export function soon(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, ms);
}

/** A sync within a while, without putting off one already due (for resume points while playing). */
export function later(ms = 20000) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; syncNow(); }, ms);
}

/** Starts listening to this TV's changes (once, at launch). */
let started = false;
export function start() {
  if (started) return;
  started = true;
  store.onAccountWrite((what) => { if (what === 'pos') later(); else soon(); });
  if (globalThis.document) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) soon(500); else if (timer) { clearTimeout(timer); timer = null; syncNow(); } });
  }
  // another device's changes show within half a minute while YM Player is on screen
  setInterval(() => { if (!globalThis.document || !document.hidden) syncNow(); }, 30000);
}

/** Forgets what was last synced for this account (after signing out or a new login). */
export function forget() {
  const n = store.accountNs();
  for (const k of ['sync_shadow', 'sync_keys', 'sync_status']) ls().removeItem(n + k);
}
