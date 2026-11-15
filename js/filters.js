// Port of Filters.java: hiding what you don't watch, per account.
//  - countries / languages: categories named "FR | …", "AR: …", "|IN| …" are hidden together by
//    unticking FR, AR or IN in Settings (names written mostly in another alphabet get "#ARABIC"…);
//  - single categories hidden by hand (Hold OK on a category → Hide).
// Hidden categories, and the channels, movies and series in them, disappear from the category
// lists, "All", Search (country filters only), the TV guide and Recently Added. Favourites and
// history are left alone.
import * as store from './store.js';
import * as repo from './repo.js';
import { LIVE, MOVIE, SERIES } from './item.js';

const TAG = /^[^\p{L}\p{N}]*(EX-YU|[A-Za-z]{2,3}|4K|8K)\s*(?:[|:~\-–—»▎│\]⎮/]+|\s{2,})/u;

/** Bumped whenever the hidden lists change, so cached results are rebuilt. */
let version = 1;
export const changed = () => { version++; };
export const getVersion = () => version;

/** "UK| SPORT ʰᵉᵛᶜ" → "UK"; a name written mostly in another alphabet → "#ARABIC" etc.; else null. */
export function tag(name) {
  if (name == null) return null;
  const m = TAG.exec(String(name).trim());
  if (!m) return script(String(name));
  let t = m[1].toUpperCase();
  if (t === 'USA') t = 'US';
  if (t === 'GB') t = 'UK';
  return t;
}

// Character.UnicodeBlock ranges Filters.scriptOf looks at.
const BLOCKS = [
  ['#ARABIC', [[0x0600, 0x06FF], [0x0750, 0x077F], [0xFB50, 0xFDFF], [0xFE70, 0xFEFF]]],
  ['#CYRILLIC', [[0x0400, 0x04FF], [0x0500, 0x052F]]],
  ['#DEVANAGARI', [[0x0900, 0x097F]]], ['#BENGALI', [[0x0980, 0x09FF]]], ['#GURMUKHI', [[0x0A00, 0x0A7F]]],
  ['#GUJARATI', [[0x0A80, 0x0AFF]]], ['#TAMIL', [[0x0B80, 0x0BFF]]], ['#TELUGU', [[0x0C00, 0x0C7F]]],
  ['#KANNADA', [[0x0C80, 0x0CFF]]], ['#MALAYALAM', [[0x0D00, 0x0D7F]]], ['#SINHALA', [[0x0D80, 0x0DFF]]],
  ['#THAI', [[0x0E00, 0x0E7F]]], ['#HEBREW', [[0x0590, 0x05FF]]], ['#GREEK', [[0x0370, 0x03FF]]],
  ['#ARMENIAN', [[0x0530, 0x058F]]], ['#GEORGIAN', [[0x10A0, 0x10FF]]], ['#ETHIOPIC', [[0x1200, 0x137F]]],
  ['#KOREAN', [[0xAC00, 0xD7AF], [0x1100, 0x11FF], [0x3130, 0x318F]]],
  ['#JAPANESE', [[0x3040, 0x309F], [0x30A0, 0x30FF]]],
  ['#CHINESE', [[0x4E00, 0x9FFF]]],
];

function scriptOf(cp) {
  for (const [name, ranges] of BLOCKS) for (const [a, b] of ranges) if (cp >= a && cp <= b) return name;
  return null;
}

const LETTER = /\p{L}/u;

/** The writing system most of the name's letters use, if it isn't the Latin alphabet (≥ 40 %). */
export function script(name) {
  const counts = new Map();
  let letters = 0;
  for (let i = 0; i < name.length; i++) { // per UTF-16 unit, like Java's charAt loop
    const ch = name[i];
    if (!LETTER.test(ch)) continue;
    letters++;
    const s = scriptOf(ch.charCodeAt(0));
    if (s) counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = null; let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best !== null && bestN * 10 >= letters * 4 ? best : null;
}

const NAMES = new Map();
{
  const p = ['UK', 'United Kingdom', 'US', 'United States', 'CA', 'Canada', 'IE', 'Ireland', 'AU', 'Australia',
    'NZ', 'New Zealand', 'FR', 'France', 'DE', 'Germany', 'ES', 'Spain', 'IT', 'Italy', 'PT', 'Portugal',
    'NL', 'Netherlands', 'BE', 'Belgium', 'PL', 'Poland', 'TR', 'Turkey', 'AR', 'Arabic', 'IN', 'India',
    'PK', 'Pakistan', 'BD', 'Bangladesh', 'AF', 'Africa', 'NG', 'Nigeria', 'ZA', 'South Africa', 'GR', 'Greece',
    'RO', 'Romania', 'AL', 'Albania', 'EX-YU', 'Balkans', 'SE', 'Sweden', 'NO', 'Norway', 'DK', 'Denmark',
    'FI', 'Finland', 'RU', 'Russia', 'UA', 'Ukraine', 'BR', 'Brazil', 'MX', 'Mexico', 'LAT', 'Latino',
    'PH', 'Philippines', 'CN', 'China', 'KR', 'Korea', 'JP', 'Japan', '4K', '4K channels', '8K', '8K channels',
    'EN', 'English', 'VIP', 'VIP', 'PPV', 'Pay-per-view', 'KU', 'Kurdish', 'IR', 'Iran', 'IL', 'Israel',
    'CH', 'Switzerland', 'AT', 'Austria', 'HU', 'Hungary', 'CZ', 'Czechia', 'SK', 'Slovakia', 'BG', 'Bulgaria',
    'HR', 'Croatia', 'RS', 'Serbia', 'BA', 'Bosnia', 'MK', 'North Macedonia', 'LT', 'Lithuania', 'LV', 'Latvia',
    'EE', 'Estonia', 'CY', 'Cyprus', 'MT', 'Malta', 'SA', 'Saudi Arabia', 'AE', 'UAE', 'EG', 'Egypt',
    'MA', 'Morocco', 'DZ', 'Algeria', 'TN', 'Tunisia', 'SO', 'Somalia', 'ET', 'Ethiopia', 'KE', 'Kenya',
    'GH', 'Ghana', 'CAR', 'Caribbean', 'JM', 'Jamaica', 'TH', 'Thailand', 'VN', 'Vietnam', 'ID', 'Indonesia',
    'MY', 'Malaysia', 'LK', 'Sri Lanka', 'NP', 'Nepal', 'AM', 'Armenia', 'AZ', 'Azerbaijan', 'GE', 'Georgia',
    'SC', 'Scotland', 'WAL', 'Wales', 'IRL', 'Ireland', 'SP', 'Spain', 'SW', 'Sweden', 'LU', 'Luxembourg',
    'ASI', 'Asia', 'AFR', 'Africa', 'ARA', 'Arabic', 'HIN', 'Hindi', 'URD', 'Urdu', 'PUN', 'Punjabi',
    'TAM', 'Tamil', 'BEN', 'Bengali', 'SOM', 'Somali', 'KID', 'Kids', 'XXX', 'Adult', 'ADU', 'Adult'];
  for (let i = 0; i + 1 < p.length; i += 2) NAMES.set(p[i], p[i + 1]);
  const w = ['#ARABIC', 'Arabic writing', '#CYRILLIC', 'Cyrillic writing (Russian, Ukrainian…)',
    '#DEVANAGARI', 'Hindi writing (Devanagari)', '#BENGALI', 'Bengali writing', '#GURMUKHI', 'Punjabi writing',
    '#GUJARATI', 'Gujarati writing', '#TAMIL', 'Tamil writing', '#TELUGU', 'Telugu writing', '#KANNADA', 'Kannada writing',
    '#MALAYALAM', 'Malayalam writing', '#SINHALA', 'Sinhala writing', '#THAI', 'Thai writing', '#HEBREW', 'Hebrew writing',
    '#GREEK', 'Greek writing', '#ARMENIAN', 'Armenian writing', '#GEORGIAN', 'Georgian writing', '#ETHIOPIC', 'Amharic writing',
    '#KOREAN', 'Korean writing', '#JAPANESE', 'Japanese writing', '#CHINESE', 'Chinese writing'];
  for (let i = 0; i + 1 < w.length; i += 2) NAMES.set(w[i], w[i + 1]);
}

export const tagName = (t) => NAMES.get(t) || t;

// ------------------------------------------------------------ saved choices (per account)

const readSet = (k) => new Set(store.accountList(k));
const writeSet = (k, s) => store.setAccountList(k, [...s]);

export const hiddenTags = () => readSet('hide_tags');
export function setHiddenTags(tags) { writeSet('hide_tags', tags); changed(); }
export const hiddenCategories = (type) => readSet(`hide_cat_${type}`);
/** Categories you brought back even though a country / writing filter would hide them. */
export const alwaysShown = (type) => readSet(`show_cat_${type}`);

export function setAlwaysShown(type, id, on) {
  const s = alwaysShown(type);
  if (on) s.add(String(id)); else s.delete(String(id));
  writeSet(`show_cat_${type}`, s);
  changed();
}

export function setCategoryHidden(type, id, hidden) {
  const s = hiddenCategories(type);
  if (hidden) s.add(String(id)); else s.delete(String(id));
  writeSet(`hide_cat_${type}`, s);
  changed();
}

// ------------------------------------------------------------ applying them

export function isHidden(cat, tags, cats, shows) {
  if (cats.has(cat.id)) return true; // hidden by you
  if (shows.has(cat.id)) return false; // brought back despite its country / writing
  const t = tag(cat.name);
  return t !== null && tags.has(t);
}

/** Filters.categories: the categories to show. */
export function categories(type, all) {
  if (!all) return all;
  const tags = hiddenTags(); const cats = hiddenCategories(type); const shows = alwaysShown(type);
  const out = []; let same = true;
  for (const c of all) {
    if (isHidden(c, tags, cats, shows)) { same = false; continue; }
    const n = store.catName(type, c.id); // renamed by you (the original name still decides country filters)
    if (n !== null) same = false;
    out.push(n !== null ? { ...c, name: n } : c);
  }
  return same ? all : out;
}

const CACHE = new Map(); // list -> { v, out, ns, forSearch }

async function filterItems(type, all, forSearch) {
  if (!all) return all;
  const tags = hiddenTags(); const catIds = forSearch ? new Set() : hiddenCategories(type);
  if (!tags.size && !catIds.size) return all;
  const v = version; const ns = store.accountNs();
  const c = CACHE.get(all);
  if (c && c.v === v && c.ns === ns && c.forSearch === forSearch) return c.out;
  const hidden = new Set();
  try {
    const shows = alwaysShown(type);
    for (const cat of await repo.categories(type)) if (isHidden(cat, tags, catIds, shows)) hidden.add(cat.id);
  } catch { /* no categories: nothing to hide */ }
  if (!hidden.size) return all;
  const out = all.filter((it) => it.categoryId == null || !hidden.has(String(it.categoryId)));
  if (CACHE.size > 8) CACHE.clear();
  CACHE.set(all, { v, out, ns, forSearch });
  return out;
}

/** Filters.items: the channels / movies / series to show from a whole-section list. */
export const items = (type, all) => filterItems(type, all, false);

/**
 * Filters.searchItems: categories you hid yourself still turn up (you hid the category, not what's
 * in it), but anything from a country / language / writing you've switched off stays out.
 */
export const searchItems = (type, all) => filterItems(type, all, true);

/** Tags found in the provider's category names, most categories first, with counts. */
export async function detectTags() {
  const counts = new Map();
  for (const t of [LIVE, MOVIE, SERIES]) {
    let cats = [];
    try { cats = await repo.categories(t); } catch { continue; }
    for (const c of cats) {
      const g = tag(c.name);
      if (g !== null) counts.set(g, (counts.get(g) || 0) + 1);
    }
  }
  const keys = [...counts.keys()].sort((a, b) => (counts.get(b) - counts.get(a)) || (a < b ? -1 : a > b ? 1 : 0));
  return new Map(keys.map((k) => [k, counts.get(k)]));
}

/** Tests. */
export function _reset() { CACHE.clear(); version = 1; }
