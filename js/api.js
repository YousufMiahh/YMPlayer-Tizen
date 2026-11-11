// Xtream Codes API client: port of XtreamApi.java. Reads server/user/pass/UA from the current account.
import * as store from './store.js';
import { LIVE, MOVIE, SERIES, EPISODE, CATEGORY } from './item.js';

const TAILS = ['/player_api.php', '/get.php', '/xmltv.php', '/panel_api.php'];

/** Turns whatever the user typed into "http(s)://host:port". */
export function normalize(server) {
  let s = (server ?? '').trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  for (const t of TAILS) if (s.endsWith(t)) s = s.slice(0, -t.length);
  return s.replace(/\/+$/, '');
}

/** Accepts a server or a pasted get.php M3U link -> {server, user, pass}. */
export function parseLink(text) {
  const raw = (text ?? '').trim();
  const out = { server: normalize(raw), user: '', pass: '' };
  const q = raw.indexOf('?');
  if (q >= 0) {
    const p = new URLSearchParams(raw.slice(q + 1));
    out.user = p.get('username') ?? '';
    out.pass = p.get('password') ?? '';
  }
  return out;
}

const enc = encodeURIComponent;
const base = () => normalize(store.server());

function apiUrl(action, extra) {
  let u = `${base()}/player_api.php?username=${enc(store.user())}&password=${enc(store.pass())}`;
  if (action) u += `&action=${action}`;
  if (extra) u += extra;
  return u;
}

// Browsers (and the Tizen webview) treat User-Agent as a forbidden header and silently drop it,
// so this is best-effort: providers that insist on a specific UA need a native/proxy layer.
async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': store.userAgent() } });
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
  return res;
}

async function getText(url) {
  return (await (await get(url)).text()).trim();
}

async function getObject(url) {
  const body = await getText(url);
  if (!body.startsWith('{')) return {};
  try { return JSON.parse(body); } catch { return {}; }
}

/**
 * Incrementally parses a top-level JSON array of objects from the response body, calling
 * onObject(parsed) for each one so the full (possibly huge) array text is never held at once.
 * Anything that is not an array (e.g. an error object) yields nothing.
 */
async function readArray(url, onObject) {
  const res = await get(url);
  if (!res.body || !res.body.getReader) {
    let arr;
    try { arr = JSON.parse(await res.text()); } catch { return; }
    if (Array.isArray(arr)) for (const o of arr) if (o && typeof o === 'object') onObject(o);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let started = false; // saw the opening '['
  let depth = 0; // object/array nesting inside the top-level array
  let inStr = false;
  let esc = false;
  let buf = ''; // text of the object currently being read
  const feed = (chunk) => {
    let start = 0; // where the pending slice of `chunk` begins (when depth > 0)
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (!started) {
        if (c === '[') started = true;
        else if (!/[\s\uFEFF]/.test(c)) return false; // not an array (BOM/whitespace tolerated)
        start = i + 1;
        continue;
      }
      if (depth === 0) {
        if (c === '{') { depth = 1; start = i; }
        else if (c === ']') return false;
        continue;
      }
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) {
          const text = buf + chunk.slice(start, i + 1);
          buf = '';
          try { const o = JSON.parse(text); if (o && typeof o === 'object') onObject(o); } catch { /* skip bad entry */ }
        }
      }
    }
    if (depth > 0) buf += chunk.slice(start);
    return true;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!feed(dec.decode(value, { stream: true }))) { reader.cancel().catch(() => {}); return; }
  }
}

// ---------------------------------------------------------------- account

export async function login() {
  const body = await getText(apiUrl());
  if (!body.startsWith('{')) throw new Error("This doesn't look like an Xtream server");
  return JSON.parse(body);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function describeAccount(r) {
  const u = r && r.user_info;
  if (!u || typeof u !== 'object') return '';
  const parts = [`Status: ${u.status ?? '?'}`];
  const exp = u.exp_date === undefined || u.exp_date === null ? '' : String(u.exp_date);
  if (exp === '' || exp === 'null' || exp === 'never') {
    parts.push('Expires: never');
  } else if (/^\d+$/.test(exp)) {
    const d = new Date(Number(exp) * 1000);
    parts.push(`Expires: ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
  }
  const act = u.active_cons === undefined || u.active_cons === null ? '' : String(u.active_cons);
  const max = u.max_connections === undefined || u.max_connections === null ? '' : String(u.max_connections);
  if (max !== '') parts.push(`Connections: ${act === '' ? '0' : act}/${max}`);
  return parts.join('  ·  ');
}

// ---------------------------------------------------------------- lists

const str = (v) => (v === undefined || v === null ? '' : String(v));
const num = (v) => { const n = parseInt(str(v).trim(), 10); return Number.isNaN(n) ? 0 : n; };

function rating(r) {
  const d = parseFloat(str(r));
  return Number.isNaN(d) || d <= 0 ? undefined : `★ ${d.toFixed(1)}`;
}

function joinNonEmpty(...parts) {
  const p = parts.filter((s) => s && s.trim() && s !== 'null').map((s) => s.trim());
  return p.length ? p.join('  ·  ') : undefined;
}

const CAT_ACTION = { [LIVE]: 'get_live_categories', [MOVIE]: 'get_vod_categories', [SERIES]: 'get_series_categories' };
const STREAM_ACTION = { [LIVE]: 'get_live_streams', [MOVIE]: 'get_vod_streams', [SERIES]: 'get_series' };

/** @returns {Promise<Item[]>} category items (type "cat"); [] on an error-object response. */
export async function categories(type) {
  const out = [];
  await readArray(apiUrl(CAT_ACTION[type] ?? CAT_ACTION[SERIES]), (o) => {
    const id = str(o.category_id);
    if (id) out.push({ type: CATEGORY, id, name: str(o.category_name).trim() });
  });
  return out;
}

/** @param categoryId omit/null for every item of that type. */
export async function streams(type, categoryId = null) {
  const extra = categoryId === null || categoryId === undefined ? null : `&category_id=${enc(categoryId)}`;
  const out = [];
  await readArray(apiUrl(STREAM_ACTION[type] ?? STREAM_ACTION[SERIES], extra), (o) => {
    let item;
    if (type === SERIES) {
      item = { type, id: str(o.series_id), name: str(o.name).trim() };
      if (o.cover) item.icon = str(o.cover);
      if (o.plot) item.plot = str(o.plot);
      const info = joinNonEmpty(str(o.genre), rating(o.rating));
      if (info) item.info = info;
    } else {
      item = { type, id: str(o.stream_id), name: str(o.name).trim() };
      if (o.stream_icon) item.icon = str(o.stream_icon);
      if (o.num !== undefined && o.num !== null) item.num = str(o.num);
      if (o.container_extension) item.ext = str(o.container_extension);
      if (type === MOVIE) {
        const r = rating(o.rating);
        if (r) item.info = r;
      }
    }
    if (!item.id) return;
    if (o.category_id !== undefined && o.category_id !== null) item.categoryId = str(o.category_id);
    item.added = num(type === SERIES ? o.last_modified : o.added);
    out.push(item);
  });
  return out;
}

export const seriesInfo = (id) => getObject(apiUrl('get_series_info', `&series_id=${enc(id)}`));
export const vodInfo = (id) => getObject(apiUrl('get_vod_info', `&vod_id=${enc(id)}`));

// ---------------------------------------------------------------- EPG

const pad = (n) => String(n).padStart(2, '0');
const hm = (sec) => { const d = new Date(sec * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Decodes base64 text; text that is not valid base64/UTF-8 is returned as-is. */
function b64(s) {
  if (!s) return '';
  try {
    const bin = atob(s.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const out = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    // Plain text that merely looks like base64 decodes to junk: keep the original then.
    return /[\x00-\x08\x0e-\x1f\uFFFD]/.test(out) ? s : out;
  } catch {
    return s;
  }
}

function programme(e) {
  const start = Number(e.start_timestamp) || 0;
  const stop = Number(e.stop_timestamp) || 0;
  return {
    title: b64(str(e.title)),
    desc: b64(str(e.description)),
    start,
    stop,
    timeRange() { return start <= 0 ? '' : `${hm(start)} – ${hm(stop)}`; },
    progress() {
      if (stop <= start) return 0;
      const now = Date.now() / 1000;
      return Math.max(0, Math.min(1, (now - start) / (stop - start)));
    },
  };
}

/** Current and upcoming programmes (empty on any failure). */
export async function epg(streamId, limit = 6) {
  try {
    const o = await getObject(apiUrl('get_short_epg', `&stream_id=${enc(streamId)}&limit=${limit}`));
    if (!Array.isArray(o.epg_listings)) return [];
    const now = Date.now() / 1000;
    return o.epg_listings.map(programme).filter((p) => p.stop === 0 || p.stop >= now);
  } catch {
    return [];
  }
}

/** @returns {Promise<[string|null, string|null]>} "Now" and "Next" lines. */
export async function shortEpg(streamId) {
  const l = await epg(streamId);
  return [0, 1].map((i) => {
    if (!l[i]) return null;
    const t = l[i].timeRange();
    return `${t ? `${t}  ` : ''}${l[i].title}`;
  });
}

// ---------------------------------------------------------------- playback

export function playUrl(item, liveFormat = 'ts') {
  const root = `${base()}`;
  const cred = `${enc(store.user())}/${enc(store.pass())}`;
  if (item.type === LIVE) return `${root}/live/${cred}/${item.id}.${liveFormat}`;
  const ext = item.ext || 'mp4';
  const kind = item.type === EPISODE ? 'series' : 'movie';
  return `${root}/${kind}/${cred}/${item.id}.${ext}`;
}
