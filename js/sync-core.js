// Cross-device sync: the part every app shares (Fire TV, phone, Mac and this one do exactly the same).
//
// Each account's watch data lives online as one encrypted blob, in a row whose id is a one-way
// hash of the login. Neither the id nor the blob reveal the server, username, password or what
// was watched: the key that opens the blob is made from the login too and never leaves the device.
//
//   material = "ymplayer-sync-v1\n" + server + "\n" + user + "\n" + pass   (server normalised)
//   64 bytes = PBKDF2-HMAC-SHA256(material, salt "ymplayer-sync-v1", 10000 rounds)
//   row id   = hex of the first 32 bytes        AES-256-GCM key = the last 32 bytes
//   blob     = base64(12-byte nonce + ciphertext + 16-byte tag) of the JSON document
//
// The document holds maps of entries, each stamped with the time it last changed ("t", ms).
// Merging keeps the newest entry per key, so devices can change different things offline and
// still end up the same. A removed thing is kept for a while as {x:1, t} so the removal spreads.
//
//   pos      item key → {p: position ms, d: duration ms, i?: item}   resume points
//   up       item key → {i?}                                         next episode, at the start
//   watched / recblock  item key → {}
//   fav      item key → {o: order, i: item}                          favourites
//   queue    item key → {o: order, i: item}
//   favcat / hidecat / showcat   "type:categoryId" → {}
//   hidetag  tag → {}                                                hidden countries / languages
//   catname  "type:categoryId" → {n: name}
//   pic      picture key → {m: mode}       ("series_<id>" for a series, else the item key)
//   adelay   same keys → {ms}                                         audio sync
//   settings name → {v}   subtitle style and languages, Home rows (sub_size, sub_color, sub_bg,
//            sub_bg_opacity, sub_lang, audio_lang, home_<row>): an app only reads and writes the
//            ones it has; the others are left alone (never removed)
//   hist     item key → {i, t}            watch history (newest t first; live: keys are channels);
//            {x:1, t} = taken off by hand. Gone from a device's list but not taken off = pushed past
//            its end (every app keeps at least HIST_SURE entries), which isn't a removal
//   histclear {live: t, vod: t}           history cleared at
//
// Items use the Android field names: type id name icon ext num plot info cat added pid pname
// picon dur season tmdb.

import { sha256, pbkdf2, gcm } from './lib/noble.js';

export const VERSION = 1;
export const MAPS = ['pos', 'up', 'watched', 'fav', 'favcat', 'hidecat', 'showcat', 'hidetag', 'recblock',
  'catname', 'queue', 'pic', 'adelay', 'settings'];
const SAME = {
  pos: (a, b) => a.p === b.p,
  catname: (a, b) => a.n === b.n,
  pic: (a, b) => a.m === b.m,
  adelay: (a, b) => a.ms === b.ms,
  settings: (a, b) => JSON.stringify(a.v) === JSON.stringify(b.v),
};
/** Maps whose missing keys mean "this app doesn't have that one", not "removed". */
const KEEP_MISSING = new Set(['settings']);
const DAY = 86400000;
export const TOMBSTONE_MS = 60 * DAY;
export const HIST_KEEP = 60;
export const HIST_SHOW = 40;
/** Every app keeps at least this many of each history (the Mac keeps 30 channels). */
export const HIST_SURE = 30;
export const ROUNDS = 10000;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ================================================================ keys

/** "HTTP://Example.com:80/" → "example.com" (same login typed slightly differently = same account). */
export function normServer(s) {
  let v = String(s || '').trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '');
  v = v.replace(/\/+$/, '');
  v = v.replace(/:(80|443)$/, '');
  return v;
}

export function hex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** {id, key} for a login. Slow on purpose (about a second on a TV): callers keep the result. */
export function deriveKeys(server, user, pass) {
  const material = `ymplayer-sync-v1\n${normServer(server)}\n${String(user || '').trim()}\n${String(pass || '').trim()}`;
  const dk = pbkdf2(sha256, enc.encode(material), enc.encode('ymplayer-sync-v1'), { c: ROUNDS, dkLen: 64 });
  return { id: hex(dk.subarray(0, 32)), key: dk.slice(32, 64) };
}

// ================================================================ encryption

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomNonce() {
  const n = new Uint8Array(12);
  globalThis.crypto.getRandomValues(n);
  return n;
}

export function encrypt(key, doc, nonce = randomNonce()) {
  const ct = gcm(key, nonce).encrypt(enc.encode(JSON.stringify(doc)));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 12);
  return b64(out);
}

/** The document, or throws if the blob wasn't made with this key. */
export function decrypt(key, blob) {
  const all = unb64(blob);
  const plain = gcm(key, all.subarray(0, 12)).decrypt(all.subarray(12));
  return JSON.parse(dec.decode(plain));
}

// ================================================================ the document

export function emptyDoc() {
  const d = { v: VERSION, histclear: { live: 0, vod: 0 }, hist: {} };
  for (const m of MAPS) d[m] = {};
  return d;
}

/** A document read from anywhere, with every map present. */
export function normDoc(d) {
  const out = emptyDoc();
  if (!d || typeof d !== 'object') return out;
  for (const m of [...MAPS, 'hist']) {
    const src = d[m];
    if (src && typeof src === 'object') for (const k of Object.keys(src)) if (src[k] && typeof src[k] === 'object') out[m][k] = src[k];
  }
  if (d.histclear) {
    out.histclear.live = Number(d.histclear.live) || 0;
    out.histclear.vod = Number(d.histclear.vod) || 0;
  }
  return out;
}

const histKind = (k) => (k.startsWith('live:') ? 'live' : 'vod');
const strip = (e) => { const o = { ...e }; delete o.t; delete o.x; return o; };

/**
 * This device's data as a document: what matches the last synced document keeps its time,
 * anything changed since gets "now", and anything gone since becomes a removal.
 * state: the maps (without times) this app keeps, plus hist {key: {o: 0 newest, i}}.
 * maps: the maps this app has; the others are passed through untouched.
 */
export function stamp(state, shadowIn, now, maps = MAPS) {
  const shadow = normDoc(shadowIn);
  const out = normDoc(shadow);
  for (const m of maps) {
    const cur = (state && state[m]) || {};
    const old = shadow[m];
    const res = {};
    let next = 0;
    const order = Object.keys(cur).sort((a, b) => (cur[a].o ?? 0) - (cur[b].o ?? 0));
    for (const k of order) {
      const e = cur[k];
      const s = old[k];
      const same = s && !s.x && (SAME[m] ? SAME[m](s, e) : true);
      if (same) { res[k] = s; continue; }
      const n = { ...strip(e), t: now };
      if (m === 'fav' || m === 'queue') n.o = now + next++;
      res[k] = n;
    }
    for (const k of Object.keys(old)) {
      if (k in res) continue;
      res[k] = old[k].x || KEEP_MISSING.has(m) ? old[k] : { x: 1, t: now };
    }
    out[m] = res;
  }
  if (!state || !state.hist) return out;
  // history: walk each list oldest → newest; an entry keeps its time while the order still agrees
  const hist = { ...shadow.hist };
  for (const kind of ['live', 'vod']) {
    const mine = Object.keys(state.hist).filter((k) => histKind(k) === kind)
      .sort((a, b) => (state.hist[b].o ?? 0) - (state.hist[a].o ?? 0));
    let prev = -Infinity;
    for (const k of mine) {
      const s = shadow.hist[k];
      let e;
      if (s && !s.x && s.t > prev) e = s;
      else e = { i: state.hist[k].i, t: Math.max(prev + 1, now - (state.hist[k].o ?? 0)) };
      hist[k] = e;
      prev = e.t;
    }
    // gone from this list while plenty newer stayed? Pushed off its end. Otherwise: taken off by hand
    const kept = mine.map((k) => hist[k].t);
    for (const k of Object.keys(shadow.hist)) {
      const s = shadow.hist[k];
      if (histKind(k) !== kind || s.x || k in state.hist || s.t <= shadow.histclear[kind]) continue;
      const newer = kept.filter((t) => t > s.t).length;
      if (newer < HIST_SURE && mine.length > 0) hist[k] = { x: 1, t: now };
    }
    if (mine.length === 0) {
      const had = Object.keys(shadow.hist).some((k) => histKind(k) === kind && !shadow.hist[k].x && shadow.hist[k].t > shadow.histclear[kind]);
      if (had) out.histclear[kind] = now;
    }
  }
  out.hist = hist;
  return out;
}

function newer(a, b) {
  if (a.t !== b.t) return a.t > b.t;
  return JSON.stringify(a) > JSON.stringify(b);
}

/**
 * The two documents combined: the newest entry per key. dirty = the result differs from
 * `remote` (so it needs saving online).
 */
export function merge(localIn, remoteIn, now) {
  const local = normDoc(localIn);
  const remote = normDoc(remoteIn);
  const out = emptyDoc();
  let dirty = false;
  for (const m of [...MAPS, 'hist']) {
    const a = local[m], b = remote[m], r = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const ea = a[k], eb = b[k];
      if (!eb) { r[k] = ea; dirty = true; continue; }
      if (!ea) { r[k] = eb; continue; }
      if (ea.t !== eb.t && newer(ea, eb)) { r[k] = ea; dirty = true; } else r[k] = eb;
    }
    out[m] = r;
  }
  for (const kind of ['live', 'vod']) {
    out.histclear[kind] = Math.max(local.histclear[kind], remote.histclear[kind]);
    if (out.histclear[kind] !== remote.histclear[kind]) dirty = true;
  }
  // tidy: old removals, cleared or surplus history
  for (const m of MAPS) {
    for (const k of Object.keys(out[m])) {
      const e = out[m][k];
      if (e.x && e.t < now - TOMBSTONE_MS) { delete out[m][k]; if (remote[m][k]) dirty = true; }
    }
  }
  for (const kind of ['live', 'vod']) {
    const keys = Object.keys(out.hist).filter((k) => histKind(k) === kind && !out.hist[k].x);
    keys.sort((x, y) => out.hist[y].t - out.hist[x].t);
    keys.forEach((k, idx) => {
      const e = out.hist[k];
      if (e.t <= out.histclear[kind] || idx >= HIST_KEEP) { delete out.hist[k]; if (remote.hist[k]) dirty = true; }
    });
    for (const k of Object.keys(out.hist)) { // removals: kept a while so they spread, then dropped
      const e = out.hist[k];
      if (histKind(k) === kind && e.x && (e.t < now - TOMBSTONE_MS || e.t <= out.histclear[kind])) { delete out.hist[k]; if (remote.hist[k]) dirty = true; }
    }
  }
  return { doc: out, dirty };
}

/** What the device should hold for a document: the maps without times (fav / queue o = 0, 1, 2…). */
export function toState(docIn) {
  const doc = normDoc(docIn);
  const st = { hist: {} };
  for (const m of MAPS) {
    const r = {};
    const keys = Object.keys(doc[m]).filter((k) => !doc[m][k].x);
    if (m === 'fav' || m === 'queue') keys.sort((a, b) => (doc[m][a].o ?? 0) - (doc[m][b].o ?? 0));
    keys.forEach((k, idx) => {
      r[k] = strip(doc[m][k]);
      if (m === 'fav' || m === 'queue') r[k].o = idx;
    });
    st[m] = r;
  }
  for (const kind of ['live', 'vod']) {
    const keys = Object.keys(doc.hist).filter((k) => histKind(k) === kind && !doc.hist[k].x && doc.hist[k].t > doc.histclear[kind]);
    keys.sort((a, b) => doc.hist[b].t - doc.hist[a].t);
    keys.slice(0, HIST_SHOW).forEach((k, idx) => { st.hist[k] = { o: idx, i: doc.hist[k].i }; });
  }
  return st;
}

/** True when two states hold the same thing for map m (order counts for fav / queue / hist). */
export function sameMap(m, a = {}, b = {}) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!(k in b)) return false;
    if (SAME[m] && !SAME[m](a[k], b[k])) return false;
    if ((m === 'fav' || m === 'queue' || m === 'hist') && (a[k].o ?? 0) !== (b[k].o ?? 0)) return false;
    if (m === 'pos' && (a[k].d ?? 0) !== (b[k].d ?? 0)) return false;
  }
  return true;
}
