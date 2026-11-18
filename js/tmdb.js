// Tmdb.java: The Movie Database (themoviedb.org). Finds a film's or series' TMDB id from its
// name, and fetches "people who liked this also liked" recommendations. Used for Skip Intro (the
// intro database is keyed by TMDB id) and for "Because you watched…" on Home.
// The key is the one the Android app ships with.
const KEY = 'ec34788e4bc515bbf0c395f7f3441b78';
export const BASE = 'https://api.themoviedb.org/3';
export const TIMEOUT_MS = 15000;
export const MOVIE = 'movie';
export const TV = 'tv';

const YEAR = /[([]((?:19|20)\d{2})[)\]]|\S\s+((?:19|20)\d{2})\s*$/;
const CACHE_PREFIX = 'tmdb_';

let fetcher = (url, init) => globalThis.fetch(url, init);
/** Tests: swap the network. */
export function setFetch(fn) { fetcher = fn || ((url, init) => globalThis.fetch(url, init)); }

/** Set when a lookup failed because TMDB couldn't be reached (not "not found"). Recs resets it. */
export const state = { failed: false };

/** GET a JSON document, giving up after TIMEOUT_MS (AbortController: Chromium 94 has no AbortSignal.timeout). */
export async function getJson(url, ms = TIMEOUT_MS) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(new Error('timeout')); if (ctl) { try { ctl.abort(); } catch { /* done */ } } }, ms);
  });
  expired.catch(() => {});
  try {
    const res = await Promise.race([fetcher(url, ctl ? { signal: ctl.signal } : undefined), expired]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await Promise.race([res.json(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

const get = (path) => getJson(`${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${KEY}&language=en-GB`);

const IMDB = new Map();
/** A series' IMDb id ("tt0903747") from its TMDB id, for the skip-intro databases that use it; null if none. */
export async function imdbId(tvId) {
  if (IMDB.has(String(tvId))) return IMDB.get(String(tvId));
  let id = null;
  try {
    const v = String((await get(`/tv/${encodeURIComponent(tvId)}/external_ids`)).imdb_id || '');
    if (v.startsWith('tt')) id = v;
  } catch { return null; } // not kept: asked again next time
  IMDB.set(String(tvId), id);
  return id;
}
/** Tests. */
export function _resetImdb() { IMDB.clear(); }

/**
 * "EN - Breaking Bad (2008) [4K]" → ["Breaking Bad", "2008", …]. Only a provider's tag is taken
 * off the front ("EN - ", "UK: ", "NF | "), never part of a real title ("CSI: Miami",
 * "24: Legacy", "Thor: Ragnarok"), and a title that is a year ("1917") stays.
 * [2] is the name with an unbracketed trailing number kept ("Blade Runner 2049").
 */
export function cleanName(raw) {
  let n = raw == null ? '' : String(raw).trim();
  n = n.replace(/^[^|]{1,8}\|\s*/, '');                                                     // "NF | ", "EN| "
  n = n.replace(/^(?:[A-Z]{2}|(?:ENG|AMZ|DSNP|ATVP|VOD|MULTI|4K|UHD|FHD|HD|eng|amz|dsnp|atvp|vod|multi|4k|uhd|fhd|hd))\s*[:-]\s+/, ''); // "EN - ", "UK: "
  let year = null;
  const m = YEAR.exec(n);
  if (m) year = m[1] != null ? m[1] : m[2];
  n = n.replace(/\(.*?\)|\[.*?\]/g, ' ');                                                    // "(2008)", "[Multi-Sub]"
  n = n.replace(/\s+[-:]?\s*S\d{1,2}\s*E\d{1,3}\b.*$/i, '');                                 // " - S01E01 …"
  n = n.replace(/\s+(?:4K|UHD|FHD|HD|SD|MULTI|SUB|DUB|HEVC|H265)\b.*$/, '');                 // " 4K", " MULTI SUB"
  n = n.replace(/\s+/g, ' ').trim();
  const withNumber = n;
  if (year !== null) n = n.replace(new RegExp(`\\s*${year}\\s*$`), '').trim();
  if (n === '') { n = withNumber === '' ? (raw == null ? '' : String(raw).trim()) : withNumber; year = null; }
  return [n, year, withNumber];
}

const ls = () => globalThis.localStorage;

/**
 * TMDB id for a film or series. Uses the provider's id when it gives one; otherwise looks the
 * name up (remembered, so each title is only searched once). Null if it can't be found.
 */
export async function findId(kind, name, known) {
  if (known != null && /^\d+$/.test(String(known)) && String(known) !== '0') return String(known);
  const cn = cleanName(name);
  if (cn[0] === '') return null;
  const ck = `${CACHE_PREFIX}${kind}:${cn[0].toLowerCase()}:${cn[1] === null ? '' : cn[1]}`;
  const hit = ls().getItem(ck);
  if (hit !== null) return hit === '' ? null : hit;
  let id = null;
  try {
    const search = async (q, year) => {
      let path = `/search/${kind}?query=${encodeURIComponent(q)}`;
      if (year) path += `${kind === TV ? '&first_air_date_year=' : '&year='}${year}`;
      const r = (await get(path)).results;
      return Array.isArray(r) ? r : [];
    };
    let r = await search(cn[0], cn[1]);
    if (!r.length && cn[1] !== null && cn[2] !== cn[0]) r = await search(cn[2], null); // the number is part of the title
    if (!r.length && cn[1] !== null) r = await search(cn[0], null);                    // wrong year in the name: try without
    if (r.length && r[0] && r[0].id != null) id = String(r[0].id);
  } catch {
    state.failed = true;
    return null; // offline: try again next time
  }
  try { ls().setItem(ck, id === null ? '' : id); } catch { /* storage full: look it up again next time */ }
  return id;
}

/** Titles TMDB recommends for people who liked this one (both the English and original titles). */
export async function recommendations(kind, id) {
  const out = [];
  if (id == null) return out;
  try {
    for (let page = 1; page <= 2; page++) {
      const r = (await get(`/${kind}/${id}/recommendations?page=${page}`)).results;
      if (!Array.isArray(r)) break;
      for (const o of r) {
        const t = (o && o[kind === TV ? 'name' : 'title']) || '';
        const ot = (o && o[kind === TV ? 'original_name' : 'original_title']) || '';
        if (t) out.push(t);
        if (ot && ot !== t) out.push(ot);
      }
    }
  } catch {
    if (!out.length) state.failed = true;
  }
  return out;
}
