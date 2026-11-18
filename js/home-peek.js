// Home, Netflix-style: rest on a film or series card and it widens into a 16:9 picture, then a
// moment later plays (muted) inside the card: from where you were, or a few minutes in. Moving off
// puts it back. Settings → Film & Series Previews turns it off.
import * as store from './store.js';
import * as api from './api.js';
import { MOVIE, SERIES, EPISODE } from './item.js';
import { followingEpisodes } from './detail.js';
import { createPreview } from './live-preview.js';

export const WIDEN_AFTER_MS = 1200;
export const PLAY_AFTER_MS = 900;
export const FILM_START_MS = 5 * 60000;
export const EPISODE_START_MS = 3 * 60000;

/**
 * @param o.itemOf  (card) => the item behind a Home card, or null
 * @param o.reveal  (card) => keep the card on screen as it widens
 */
export function createHomePeek(o) {
  let card = null; let widenTimer = null; let playTimer = null; let preview = null; let seq = 0;

  const peekable = (el) => {
    if (!el || !el.classList || !el.classList.contains('card')) return null;
    if (!el.classList.contains('poster') && !el.classList.contains('landscape')) return null;
    const it = o.itemOf(el);
    return it && (it.type === MOVIE || it.type === SERIES || it.type === EPISODE) ? it : null;
  };

  /** What to play for this card, and from where. */
  async function what(it) {
    if (it.type === MOVIE || it.type === EPISODE) {
      const pos = store.position(it);
      return { item: it, from: pos > 0 ? pos : (it.type === MOVIE ? FILM_START_MS : EPISODE_START_MS) };
    }
    // A series: the episode you were on, or its first
    const last = store.history(false).find((h) => h.type === EPISODE && String(h.parentId) === String(it.id));
    if (last) { const pos = store.position(last); return { item: last, from: pos > 0 ? pos : EPISODE_START_MS }; }
    const r = await api.seriesInfo(it.id).catch(() => null);
    const eps = followingEpisodes(r, { parentId: it.id, parentName: it.name, parentIcon: it.icon, season: 1 });
    return eps && eps.length ? { item: eps[0], from: EPISODE_START_MS } : null;
  }

  function stopPlaying() {
    if (preview) { preview.stop(); preview = null; }
  }

  function leave() {
    seq++;
    clearTimeout(widenTimer); widenTimer = null;
    clearTimeout(playTimer); playTimer = null;
    stopPlaying();
    if (card) { card.classList.remove('peek', 'peek-playing'); card = null; }
  }

  function focus(el) {
    if (el === card) return;
    leave();
    if (store.homePreviews() !== 1) return;
    const it = peekable(el);
    if (!it) return;
    card = el;
    const my = seq;
    widenTimer = setTimeout(() => {
      widenTimer = null;
      if (my !== seq || card !== document.activeElement) return;
      card.classList.add('peek');
      if (o.reveal) setTimeout(() => { if (my === seq && card) o.reveal(card); }, 380); // once it has widened
      playTimer = setTimeout(async () => {
        playTimer = null;
        if (my !== seq) return;
        const w = await what(it);
        if (!w || my !== seq || !card || card !== document.activeElement) return;
        const art = card.querySelector('.art');
        const img = art && art.querySelector('img');
        preview = createPreview({
          box: art, logo: img || art, radius: 0,
          holes: () => [document.getElementById('backdrop')],
          enabled: () => store.homePreviews() === 1,
          muted: () => true,
        });
        card.classList.add('peek-playing');
        preview.start(w.item, w.from);
      }, PLAY_AFTER_MS);
    }, WIDEN_AFTER_MS);
  }

  return {
    focus,
    leave,
    release: leave,
    get card() { return card; },
    get playing() { return !!preview; },
  };
}
