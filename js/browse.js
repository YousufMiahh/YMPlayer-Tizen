// The data side of BrowseActivity: the category list with its special entries, which category
// shows on arrival, the special lists, Android's texts, and in-section search.
import * as store from './store.js';
import * as repo from './repo.js';
import * as filters from './filters.js';
import * as match from './match.js';
import { LIVE, MOVIE, CATEGORY } from './item.js';
import { HOLD_OK } from './ui/theme.js';

export const SEARCH = '__search';
export const FAV = '__fav';
export const RECENT = '__recent';
export const CONTINUE = '__continue';
export const ALL = '__all';

/** BrowseActivity timings. */
export const DWELL_MS = 350;          // a category opens 350 ms after the selection stops
export const EPG_DELAY_MS = 400;      // the selected channel's guide loads after 400 ms
export const PREVIEW_DELAY_MS = 450;  // the live preview starts once you pause on a channel
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MAX = 300;
export const TOUR_DELAY_MS = 600;
export const FIRST_REAL = 4;          // index of the first provider category

export const isPseudo = (id) => String(id).startsWith('__');
export const isSpecial = (id) => id === FAV || id === RECENT || id === CONTINUE;

const cat = (id, name, num) => (num ? { type: CATEGORY, id, name, num } : { type: CATEGORY, id, name });

/**
 * Search, Favourites, Recent/Continue, All, then your favourite categories (♥) pinned together in
 * the order you favourited them, then the rest of the provider's categories (already filtered).
 */
export function buildCategoryList(type, rawCats) {
  const live = type === LIVE;
  const all = [
    cat(SEARCH, 'Search'),
    cat(FAV, live ? 'Favourite Channels' : type === MOVIE ? 'Favourite Movies' : 'Favourite Series'),
    live ? cat(RECENT, 'Recent Channels') : cat(CONTINUE, 'Continue Watching'),
    cat(ALL, live ? 'All Channels' : 'All'),
  ];
  const favIds = store.favCategories(type);
  for (const id of favIds) {
    for (const c of rawCats) if (c.id === id) all.push(cat(c.id, c.name, '♥'));
  }
  const fav = new Set(favIds);
  for (const c of rawCats) if (!fav.has(c.id)) all.push(c);
  return all;
}

/** Favourites / Recent·Continue / Continue Watching for this section. */
export function specialList(id, type) {
  if (id === FAV) return store.favs(type);
  if (id === RECENT) return store.history(true);
  if (id === CONTINUE) return type === MOVIE ? store.continueMovies() : store.continueSeries();
  return [];
}

/** The category shown on arrival: Favourites, else Recent/Continue, else the first category, else All. */
export function startIndex(type, list) {
  if (store.favs(type).length) return 1;
  if (specialList(list[2].id, type).length) return 2;
  return list.length > FIRST_REAL ? FIRST_REAL : FIRST_REAL - 1;
}

export const searchHint = (type) => (type === LIVE ? 'Search all channels' : type === MOVIE ? 'Search all movies' : 'Search all series');
const noun = (type) => (type === LIVE ? 'channel' : type === MOVIE ? 'film' : 'series');

export const NO_FAVS = `No favourites yet\n${HOLD_OK} on anything to add it.`;
export const NOTHING = 'Nothing here yet';
export const loadError = (msg) => `Couldn't load this list\n${msg}`;
export const catError = (msg) => `Couldn't load categories\n${msg}`;

/** BrowseActivity.show: the text over an empty list ('' when the list has something). */
export function emptyText(type, catId, size, query = '') {
  if (size) return '';
  if (catId === SEARCH) {
    const q = String(query || '').trim();
    return q.length < 2 ? `Type the name of a ${noun(type)}` : `No results for "${q}"`;
  }
  return catId === FAV ? NO_FAVS : NOTHING;
}

/** Hints (Samsung remotes have no ☰ key: Android's "Hold OK" wording). */
export const CAT_HINT = `${HOLD_OK}  Favourite, rename or hide`;
export const PANEL_HINT = `▶  TV guide      ${HOLD_OK}  Favourite`;
export const GUIDE_PANEL_HINT = `OK  Watch      ${HOLD_OK}  Full programme details      ◀  Back to channels`;
/** The TV guide's button hints, in a line along the bottom (applyMode, MODE_GUIDE). */
export const GUIDE_HINT = `OK  Watch        ${HOLD_OK}  Full programme details        ▲▼  Channels        ◀ ▶  Programmes        Back  Channel list`;

/** Live TV layout changes (applyMode): bounds glide 420 ms DecelerateInterpolator(2.2), fades in 320 / out 220 ms. */
export const LAYOUT_MS = 420;
export const FADE_IN_MS = 320;
export const FADE_OUT_MS = 220;

/** The guide's info panel time line: "HH:mm – HH:mm", plus "   ·   later" when it isn't on now. */
export const guideTime = (p, now) => p.timeRange() + (p.start <= now && now < p.stop ? '' : '   ·   later');

/** "HH:mm   Title" for the next programme (the first five characters of its time range). */
export function nextLine(p) {
  const t = p.timeRange();
  return `${t ? `${t.slice(0, 5)}   ` : ''}${p.title || ''}`;
}

/**
 * BrowseActivity.showProgrammeDetails: the dialog's title and message.
 * @returns {{ title: string, message: string, positive: string, negative: string }}
 */
export function programmeDetails(ch, p, now) {
  let b = ch.name || '';
  if (p) {
    b += `\n${p.timeRange()}`;
    if (p.start <= now && now < p.stop) b += `   ·   On now, ${Math.floor((p.stop - now) / 60)} min left`;
    else if (p.start > now) {
      const m = Math.floor((p.start - now + 59) / 60);
      b += `   ·   Starts in ${m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`}`;
    }
    if (p.desc) b += `\n\n${p.desc}`;
  } else {
    b += '\n\nNo guide information for this time.';
  }
  return { title: p ? (p.title || '') : (ch.name || ''), message: b, positive: `Watch ${ch.name || ''}`, negative: 'Close' };
}

export const favCategoryToast = (now, name) => `${now ? 'Added to favourite categories — ' : 'Removed from favourite categories — '}${name}`;
export const hiddenToast = (name) => `Hidden: ${name}  (Settings → Hidden Categories to bring it back)`;
export const categoryMenuItems = (fav) => [fav ? '♥  Remove from favourites' : '♡  Favourite', '✎  Rename', 'Hide'];

/** BrowseActivity.catTip (non-Fire wording). */
export const CAT_TIP = 'Hold OK on a category to make it a favourite (it moves near the top with a ♥), to rename it or to hide it.';

/** The section tour (Coach): Live TV has four tips, Movies / Series two. */
export function tourSteps(type, t) {
  if (type === LIVE) {
    return [
      { target: t.cats, title: 'Categories', body: `Search is at the top. ${CAT_TIP}` },
      { target: t.mid, title: 'Channels', body: `Pause on a channel to see a live preview. OK watches it full screen. ${HOLD_OK} on a channel to add it to your favourites.` },
      { target: t.info, title: "What's on", body: 'The preview, what\'s on now and what\'s on next.' },
      { target: null, title: 'The TV guide', body: 'Press ▶ from the channel list to open the TV guide. ▲▼ moves through channels, ◀▶ through programmes, '
        + 'OK watches. ◀ on what\'s on now, or Back, takes you out again.' },
    ];
  }
  return [
    { target: t.cats, title: 'Categories', body: `Search this section at the top, then your favourites, Continue Watching and everything else. ${CAT_TIP}` },
    { target: t.mid, title: 'Pick something', body: `OK opens the details page, with Play, Resume, the trailer and Favourite. ${HOLD_OK} here for Favourite, Add to Queue and Mark as Watched.` },
  ];
}

/** The Coach screen key for this section's tour. */
export const tourKey = (type) => (type === LIVE ? 'live' : 'vod');

/** BrowseActivity.runSearch: the whole section (country filters apply), best matches first. */
export async function search(type, q) {
  if (!match.query(q).usable) return [];
  const all = await filters.searchItems(type, await repo.streams(type, null));
  return match.rank(all, q, SEARCH_MAX);
}

/** What "All" or a provider category holds. */
export async function categoryItems(type, id) {
  if (id === ALL) return filters.items(type, await repo.streams(type, null));
  return repo.streams(type, id);
}

/** The categories to list: the provider's, minus hidden ones and hidden countries. */
export async function visibleCategories(type) {
  return filters.categories(type, await repo.categories(type));
}
