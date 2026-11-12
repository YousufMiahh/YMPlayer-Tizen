// Open.java: what happens when you pick something anywhere in the app (Home cards, Browse grids
// and lists, Search results, Continue Watching, the TV guide).
//   movie   -> the movie page (MovieActivity)
//   series  -> the series page (SeriesActivity)
//   live    -> the player, zapping through the live channels of the list it came from
//   episode -> straight into the player with a one-item queue (PlayerActivity resumes by itself)
import * as store from './store.js';
import { router } from './router.js';
import { toast } from './ui/toast.js';
import { LIVE, MOVIE, SERIES, key } from './item.js';

/** Open.item, as a route: {name, params}. */
export function openTarget(it, siblings = null) {
  if (it.type === MOVIE) return { name: 'movie-detail', params: { item: it } };
  if (it.type === SERIES) return { name: 'series-detail', params: { item: it } };
  if (it.type === LIVE) {
    let q = (siblings || []).filter((s) => s.type === LIVE);
    let idx = q.findIndex((s) => key(s) === key(it)); // the list may hold a different copy of it
    if (idx < 0) { q = [it]; idx = 0; }
    return { name: 'player-live', params: { channels: q, index: idx } };
  }
  return playTarget([it], 0);
}

/** Open.play: the player with this queue (Queue.set) starting at index. */
export function playTarget(queue, index) {
  return { name: 'player-vod', params: { queue, index } };
}

/** Open.item: go there. */
export function openItem(it, siblings = null) {
  const t = openTarget(it, siblings);
  router.go(t.name, t.params);
}

/** Open.play: go there. */
export function play(queue, index) {
  const t = playTarget(queue, index);
  router.go(t.name, t.params);
}

/** Open.toggleFav's toast text. */
export function favToast(now, it) {
  return `${now ? 'Added to Favourites — ' : 'Removed from Favourites — '}${it.name || ''}`;
}

/** Open.toggleFav: toggle and say so. @returns the new state */
export function toggleFav(it) {
  const now = store.toggleFav(it);
  toast(favToast(now, it));
  return now;
}
