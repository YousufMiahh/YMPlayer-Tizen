// Text helpers from Item.java (squash / fold / compact / words) and the search ranking from
// Match.java. Top 10 matching (js/top10.js) uses squash/compact; Search can use rank().

const LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;
const MARK = /\p{Mn}/u;
const SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Item.squash: lower-case, drop accents and keep only letters and digits.
 * Plain loop on the ASCII path so tens of thousands of titles stay quick.
 */
export function squash(s) {
  s = s == null ? '' : String(s);
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
  let out = '';
  if (ascii) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 48 && c <= 57) out += s[i];
      else if (c >= 97 && c <= 122) out += s[i];
      else if (c >= 65 && c <= 90) out += String.fromCharCode(c + 32);
    }
    return out;
  }
  for (const ch of s.normalize('NFKD')) if (LETTER_OR_DIGIT.test(ch)) out += ch.toLowerCase();
  return out;
}

/** Item.fold: lower-case and strip accents (é -> e); keeps spaces and punctuation. */
export function fold(s) {
  const n = String(s == null ? '' : s).toLowerCase().normalize('NFKD');
  let out = '';
  for (const ch of n) if (!MARK.test(ch)) out += ch;
  return out;
}

// Per-item caches (Item.compact / Item.words are computed once per Item on Android).
const COMPACT = new WeakMap();
const WORDS = new WeakMap();

/** Item.compact: the squashed name, computed once. */
export function compact(it) {
  let c = COMPACT.get(it);
  if (c === undefined) { c = squash(it.name || ''); COMPACT.set(it, c); }
  return c;
}

/** Item.words: "UK: Premier Sports 1" -> [uk, premier, sports, 1]. */
export function words(it) {
  let w = WORDS.get(it);
  if (!w) {
    w = fold(it.name || '').split(SPLIT).map(squash).filter(Boolean);
    WORDS.set(it, w);
  }
  return w;
}

/** Match.Query: a search, prepared once. */
export function query(text) {
  const w = fold(text == null ? '' : text).split(SPLIT).map(squash).filter(Boolean);
  return { words: w, whole: w.join(''), usable: w.join('').length >= 2 };
}

const TAGS = new Set(['uk', 'us', 'usa', 'ca', 'au', 'ie', 'en', 'fr', 'de', 'es', 'it', 'nl', 'pl', 'pt',
  'tr', 'ar', 'in', '4k', '8k', 'hd', 'fhd', 'uhd', 'sd', 'vip', 'eu', 'nz', 'za', 'multi', 'sub', 'dub']);

/** Leading provider tags ("UK", "4K", "EN"…): short tokens before the real name, max 2. */
export function tagLength(t) {
  let i = 0;
  while (i < t.length - 1 && i < 2 && t[i].length <= 3 && TAGS.has(t[i])) i++;
  return i;
}

const joinFrom = (t, from) => t.slice(from).join('');

function phraseAt(t, from, q) {
  outer:
  for (let i = from; i + q.length <= t.length; i++) {
    for (let k = 0; k < q.length; k++) {
      const last = k === q.length - 1;
      if (last ? !t[i + k].startsWith(q[k]) : t[i + k] !== q[k]) continue outer;
    }
    return i - from;
  }
  if (q.length === 1) { // "spiderman" typed as one word for "Spider-Man"
    for (let i = from; i < t.length; i++) {
      let b = '';
      for (let j = i; j < t.length && b.length < q[0].length; j++) b += t[j];
      if (b.startsWith(q[0])) return i - from;
    }
  }
  return -1;
}

function allWordStarts(t, q) {
  return q.every((w) => t.some((x) => x.startsWith(w)));
}

/** Match.score: 0 for no match, higher is better. */
export function score(it, q) {
  if (!q.usable) return 0;
  const c = compact(it);
  for (const w of q.words) if (!c.includes(w)) return 0;
  const t = words(it);
  const start = tagLength(t);
  const core = joinFrom(t, start);
  const full = start === 0 ? core : joinFrom(t, 0);
  if (core === q.whole || full === q.whole) return 1000;
  if (core.startsWith(q.whole) || full.startsWith(q.whole)) return 900;
  let phrase = phraseAt(t, start, q.words);
  if (phrase < 0 && start > 0) phrase = phraseAt(t, 0, q.words);
  if (phrase >= 0) return 800 - Math.min(phrase, 50);
  if (allWordStarts(t, q.words)) return 600;
  if (c.includes(q.whole)) return 400;
  return 200;
}

const byBest = (a, b) => (b.s - a.s) || (a.n - b.n) || (a.i - b.i);
function consider(it, i, q, hits) {
  const s = score(it, q);
  if (s > 0) hits.push({ it, s, i, n: compact(it).length });
}

/** Match.rank: best score first, then shorter names, otherwise the provider's order. */
export function rank(all, text, max) {
  const q = query(text);
  if (!q.usable || !all) return [];
  const hits = [];
  all.forEach((it, i) => consider(it, i, q, hits));
  hits.sort(byBest);
  return hits.slice(0, max).map((h) => h.it);
}

export const RANK_SLICE = 2000;

/**
 * rank() in slices, yielding between them (as top10.matchAsync does), so the first search over a
 * library of tens of thousands (every name is squashed and split on first use) never holds up
 * the remote. Same hits in the same order as rank().
 * @param o.slice     items per slice
 * @param o.cancelled () => bool, checked between slices: a newer search has replaced this one
 * @returns the hits, or null when cancelled
 */
export async function rankAsync(all, text, max, o = {}) {
  const q = query(text);
  if (!q.usable || !all) return [];
  const slice = o.slice || RANK_SLICE;
  const hits = [];
  for (let i = 0; i < all.length; i++) {
    consider(all[i], i, q, hits);
    if ((i + 1) % slice === 0 && i + 1 < all.length) {
      await new Promise((r) => setTimeout(r, 0));
      if (o.cancelled && o.cancelled()) return null;
    }
  }
  hits.sort(byBest);
  return hits.slice(0, max).map((h) => h.it);
}
