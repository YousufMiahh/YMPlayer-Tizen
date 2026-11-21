// Home, Netflix-style: the film or series card you're on widens straight away into a 16:9 picture
// (its TMDB backdrop with the title's logo over it, when there is one), then plays (muted) inside
// the card as soon as you stop on it: from where you were, or a few minutes in. Moving on puts it
// back and widens the next at once. Settings → Film & Series Previews turns it off.
import * as store from './store.js';
import * as api from './api.js';
import { MOVIE, SERIES, EPISODE } from './item.js';
import { followingEpisodes } from './detail.js';
import { createPreview } from './live-preview.js';
import * as tmdb from './tmdb.js';

export const WIDEN_AFTER_MS = 0;
export const PLAY_AFTER_MS = 450;
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
    if (card) {
      card.classList.remove('peek', 'peek-playing');
      for (const el of card.querySelectorAll('.peek-back, .peek-logo')) el.remove();
      card = null;
    }
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
      dress(card, it, my);
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

  /** The widened card's picture: TMDB's wide backdrop and the title's logo, faded in when they're here. */
  async function dress(c, it, my) {
    const art = c.querySelector('.art');
    if (!art) return;
    const back = document.createElement('img'); back.className = 'peek-back'; back.alt = '';
    const layer = document.createElement('span'); layer.className = 'peek-logo';
    const logo = document.createElement('img'); logo.alt = '';
    layer.appendChild(logo);
    const first = art.querySelector('img');
    if (first && first.nextSibling) art.insertBefore(back, first.nextSibling); else art.appendChild(back);
    art.appendChild(layer);
    const film = it.type === MOVIE;
    const name = it.type === EPISODE && it.parentName ? it.parentName : it.name;
    let urls = { logo: null, backdrop: null };
    try {
      const id = await tmdb.findId(film ? tmdb.MOVIE : tmdb.TV, name, it.tmdb);
      if (id) urls = await tmdb.art(film ? tmdb.MOVIE : tmdb.TV, id);
    } catch { /* no art: the poster stays */ }
    if (my !== seq) return;
    const put = (img, url, fade) => {
      if (!url) return;
      img.onload = () => { if (my === seq) fade.classList.add('shown'); };
      img.src = url;
    };
    put(back, urls.backdrop, back);
    put(logo, urls.logo, layer);
  }

  return {
    focus,
    leave,
    release: leave,
    get card() { return card; },
    get playing() { return !!preview; },
  };
}
