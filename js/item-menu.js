// ItemMenu.java: Hold OK / ☰ on a film, series or episode: Favourite, Add to Queue, Mark as
// Watched (and for an episode, the whole season), Remove from Continue Watching.
import * as store from './store.js';
import { toggleFav } from './open.js';
import { showDialog } from './ui/dialog.js';
import { toast } from './ui/toast.js';
import { EPISODE, SERIES, LIVE } from './item.js';

/** The rows for this item, in order: [{label, run}]. `season` is the episode's season list, or null. */
export function menuItems(it, season = null) {
  const episode = it.type === EPISODE; const series = it.type === SERIES; const live = it.type === LIVE;
  const out = [];
  if (!episode) {
    out.push({ label: store.isFav(it) ? '♥  Remove from Favourites' : '♡  Add to Favourites', run: () => { toggleFav(it); } });
  }
  if (!series && !live) {
    const queued = store.inQueue(it);
    out.push({
      label: queued ? '−  Remove from Queue' : '＋  Add to Queue',
      run: () => {
        if (queued) store.queueRemove(it); else store.queueAdd(it);
        toast(`${queued ? 'Removed from your Queue — ' : 'Added to your Queue — '}${it.name || ''}`);
      },
    });
    const watched = store.isWatched(it);
    out.push({ label: watched ? '○  Mark as Unwatched' : '✓  Mark as Watched', run: () => store.setWatched(it, !watched) });
  }
  if (episode && season && season.length) {
    const all = store.watchedCount(season) === season.length;
    out.push({ label: all ? '○  Mark Season as Unwatched' : '✓  Mark Season as Watched', run: () => store.setWatched(season, !all) });
  }
  if (live && store.inHistory(it)) {
    out.push({ label: '✕  Remove from Recent Channels', run: () => store.removeHistory(it) });
  }
  if (!series && !live && (store.position(it) > 0 || store.isUpNext(it))) {
    out.push({ label: '✕  Remove from Continue Watching', run: () => store.setPosition(it, 0) });
  }
  return out;
}

export const menuTitle = (it) => (it.type === EPISODE && it.parentName ? `${it.parentName}  ·  ${it.name || ''}` : (it.name || ''));

/**
 * Show the menu. Resolves true when something was done (the caller refreshes its screen),
 * false when it was closed with Back.
 */
export async function showItemMenu(it, season = null) {
  const items = menuItems(it, season);
  const which = await showDialog({ title: menuTitle(it), items: items.map((x) => x.label) }).result;
  if (typeof which !== 'number' || !items[which]) return false;
  items[which].run();
  return true;
}
