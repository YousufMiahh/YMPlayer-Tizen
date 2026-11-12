// Netflix's official UK Top 10 (films and TV), from the public data file Netflix publishes.
// Port of Top10.java. No API key. Netflix updates the file weekly (Tuesdays, for the week ending
// the previous Sunday), so although Home checks every hour, it only downloads when a new week is
// due, and asks Netflix whether the file changed first. Titles are matched against the provider's
// library so only things you can actually watch are shown.
import { squash, compact } from './match.js';

export const URL = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv';
export const FILE = 'netflix_top10_uk'; // localStorage key (Android: files/netflix_top10_uk.json)
const HOUR = 3600000;
const DAY = 24 * HOUR;
export const CONNECT_TIMEOUT_MS = 15000;
export const READ_TIMEOUT_MS = 60000;

const ls = () => globalThis.localStorage;

/** @typedef {{week: string, films: string[], tv: string[], checked: number, etag: ?string, lastModified: ?string}} Data */
export const emptyData = () => ({ week: '', films: [], tv: [], checked: 0, etag: null, lastModified: null });

// ------------------------------------------------------------ cache

/** @returns {Data|null} */
export function load() {
  try {
    const raw = ls().getItem(FILE);
    if (raw === null) return null;
    const o = JSON.parse(raw);
    const d = emptyData();
    d.week = typeof o.week === 'string' ? o.week : '';
    d.checked = Number(o.checked) || 0;
    d.etag = o.etag || null;
    d.lastModified = o.lastModified || null;
    if (Array.isArray(o.films)) d.films = o.films.map(String);
    if (Array.isArray(o.tv)) d.tv = o.tv.map(String);
    return d;
  } catch {
    return null;
  }
}

export function save(d) {
  try {
    ls().setItem(FILE, JSON.stringify({
      week: d.week, checked: d.checked, etag: d.etag, lastModified: d.lastModified, films: d.films, tv: d.tv,
    }));
  } catch { /* storage full: ignored, as on Android */ }
}

/** Hourly at most, and only once the next weekly list should be out (the Tuesday after the next week ends). */
export function due(d, now = Date.now()) {
  if (!d || d.week === '') return !d || now - d.checked > HOUR;
  if (now - d.checked < HOUR) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.week);
  if (!m) return true;
  // SimpleDateFormat("yyyy-MM-dd", Locale.UK) parses in the device's zone: local midnight.
  const weekEnd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return now >= weekEnd + 9 * DAY; // Sunday + 7 = next Sunday, + 2 = Tuesday it's published
}

let fetcher = (url, init) => globalThis.fetch(url, init);
/** Tests / the screenshot harness: replace the network. */
export function setFetch(fn) { fetcher = fn || ((url, init) => globalThis.fetch(url, init)); }

/** Fetches if due; returns the newest data (or the cached copy if nothing changed or offline). */
export async function refresh(now = () => Date.now()) {
  const old = load();
  if (!due(old, now())) return old;
  try {
    const fresh = await fetchData(old);
    fresh.checked = now();
    save(fresh);
    return fresh;
  } catch {
    if (old) {
      old.checked = now() - HOUR + 10 * 60000; // try again in ~10 minutes
      save(old);
    }
    return old;
  }
}

// Top10.WORKER: one quiet job at a time, so a slow download never runs twice.
let chain = Promise.resolve();
export function enqueue(job) {
  const p = chain.then(job, job);
  chain = p.catch(() => {});
  return p;
}

// ------------------------------------------------------------ download

/** Conditional GET, read as it arrives (the file covers every country and week since 2021). */
export async function fetchData(old) {
  const headers = {};
  if (old && old.etag) headers['If-None-Match'] = old.etag;
  if (old && old.lastModified) headers['If-Modified-Since'] = old.lastModified;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = setTimeout(() => ctl && ctl.abort(), CONNECT_TIMEOUT_MS);
  const idle = () => { clearTimeout(timer); timer = setTimeout(() => ctl && ctl.abort(), READ_TIMEOUT_MS); };
  try {
    const res = await fetcher(URL, { headers, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    idle();
    if (res.status === 304 && old) return old; // unchanged
    if (res.status >= 400) throw new Error(`Netflix replied HTTP ${res.status}`);
    const p = parser();
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8');
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        idle();
        p.push(dec.decode(value, { stream: true }));
      }
      p.push(dec.decode());
    } else {
      p.push(await res.text());
    }
    const d = p.end();
    const h = res.headers;
    d.etag = (h && h.get('ETag')) || null;
    d.lastModified = (h && h.get('Last-Modified')) || null;
    if (d.week === '' && old) return old;
    return d;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the file as it arrives, keeping only UK rows from the latest week (Top10.parse).
 * push(text) any number of times, then end() -> Data. Throws on an empty file or a layout it
 * doesn't know.
 */
export function parser() {
  let rest = '';
  let header = null;
  let col = null;
  let bestWeek = '';
  let films = new Map(); let tv = new Map();

  function readHeader(line) {
    const h = line.split('\t');
    const c = { country: -1, iso: -1, week: -1, cat: -1, rank: -1, title: -1 };
    h.forEach((k, i) => {
      k = k.trim().toLowerCase();
      if (k === 'country_name') c.country = i;
      else if (k === 'country_iso2') c.iso = i;
      else if (k === 'week') c.week = i;
      else if (k === 'category') c.cat = i;
      else if (k === 'weekly_rank') c.rank = i;
      else if (k === 'show_title') c.title = i;
    });
    if (c.week < 0 || c.cat < 0 || c.rank < 0 || c.title < 0 || (c.iso < 0 && c.country < 0)) {
      throw new Error('Unexpected Top 10 file layout');
    }
    return c;
  }

  function row(line) {
    // Skip non-UK lines without splitting them
    if (col.iso >= 0 ? line.indexOf('\tGB\t') < 0 && !line.startsWith('GB\t') : line.indexOf('United Kingdom') < 0) return;
    const f = line.split('\t');
    if (f.length <= Math.max(col.week, col.cat, col.rank, col.title)) return;
    const uk = col.iso >= 0 && col.iso < f.length ? f[col.iso].trim().toUpperCase() === 'GB'
      : col.country < f.length && f[col.country].trim().toLowerCase() === 'united kingdom';
    if (!uk) return;
    const week = f[col.week].trim();
    if (week < bestWeek) return; // yyyy-MM-dd compares correctly as text
    if (week > bestWeek) { bestWeek = week; films = new Map(); tv = new Map(); }
    const r = f[col.rank].trim();
    if (!/^[+-]?\d+$/.test(r)) return;
    const rank = parseInt(r, 10);
    const title = f[col.title].trim();
    if (f[col.cat].toLowerCase().startsWith('film')) films.set(rank, title);
    else tv.set(rank, title);
  }

  function line(l) {
    if (l.endsWith('\r')) l = l.slice(0, -1);
    if (header === null) { header = l; col = readHeader(l); return; }
    row(l);
  }

  const byRank = (m) => [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k));

  return {
    push(text) {
      if (!text) return;
      rest += text;
      let i;
      while ((i = rest.indexOf('\n')) >= 0) {
        line(rest.slice(0, i));
        rest = rest.slice(i + 1);
      }
    },
    end() {
      if (rest !== '') { line(rest); rest = ''; }
      if (header === null) throw new Error('Empty Top 10 file');
      const d = emptyData();
      d.week = bestWeek;
      d.films = byRank(films);
      d.tv = byRank(tv);
      return d;
    },
  };
}

/** Whole text at once (tests). */
export function parse(text) {
  const p = parser();
  p.push(text);
  return p.end();
}

// ------------------------------------------------------------ matching to your library

/** Provider decoration removed before comparing: "EN - ", "UK: ", "(2022)", "[4K]", ": Season 2". */
export function key(name) {
  let n = name == null ? '' : String(name);
  n = n.replace(/^\s*(?:[A-Za-z0-9]{2,4})\s*[|:-]\s+/, ''); // "EN - ", "UK: ", "4K | "
  n = n.replace(/\(.*?\)|\[.*?\]/g, ' ');                    // "(2022)", "[Multi-Sub]"
  n = n.replace(/[:-]\s*(?:season|series|limited series)\b.*$/, ''); // "Show: season 2" (case-sensitive, as Java)
  return squash(n);
}

function prepare(titles) {
  const wanted = new Map();
  titles.forEach((t, i) => {
    const k = key(t);
    if (k !== '' && !wanted.has(k)) wanted.set(k, i);
  });
  return wanted;
}

function consider(it, wanted, keys, found) {
  const c = compact(it);
  let maybe = false; // quick pre-check before the more careful comparison
  for (const k of keys) if (c.includes(k)) { maybe = true; break; }
  if (!maybe) return;
  const idx = wanted.get(key(it.name));
  if (idx === undefined) return;
  if (!found[idx] || (Number(it.added) || 0) > (Number(found[idx].added) || 0)) found[idx] = it; // newest copy wins
}

/** Each Netflix title found in the library, in Netflix's order; the newest copy wins; misses dropped. */
export function match(titles, library) {
  if (!titles || !library || titles.length === 0) return [];
  const wanted = prepare(titles);
  const keys = [...wanted.keys()];
  const found = new Array(titles.length);
  for (const it of library) consider(it, wanted, keys, found);
  return found.filter(Boolean);
}

/** match() in slices, yielding between them so a 10k+ library never holds up the remote. */
export async function matchAsync(titles, library, slice = 2000) {
  if (!titles || !library || titles.length === 0) return [];
  const wanted = prepare(titles);
  const keys = [...wanted.keys()];
  const found = new Array(titles.length);
  for (let i = 0; i < library.length; i++) {
    consider(library[i], wanted, keys, found);
    if ((i + 1) % slice === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return found.filter(Boolean);
}
