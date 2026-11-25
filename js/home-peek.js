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

  // One preview for the whole of Home: moving off a card hides its video at once and closes the
  // player a moment later (or just before the next card plays), so the move itself never waits on it.
  function getPreview() {
    if (!preview) {
      preview = createPreview({
        box: {
          getBoundingClientRect: () => (box ? box.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 }),
          get el() { return box; },
        },
        logo: { style: {} },
        radius: 'css', // the card's own rounded corners
        holes: () => [document.getElementById('backdrop')],
        enabled: () => store.homePreviews() === 1,
        muted: () => true,
      });
    }
    return preview;
  }
  let box = null; let cover = null;

  /** @param now  close the player straight away (leaving Home, the app hidden) */
  function leave(now = false) {
    seq++;
    clearTimeout(widenTimer); widenTimer = null;
    clearTimeout(playTimer); playTimer = null;
    if (preview) { preview.stop(!now); if (now) preview = null; }
    if (cover) { cover.style.transition = 'none'; cover.style.opacity = '1'; }
    box = null; cover = null;
    if (card) {
      card.classList.remove('peek', 'peek-playing');
      for (const el of card.querySelectorAll('.peek-back, .peek-logo')) el.remove();
      card = null;
    }
  }

  let shownInfo = null;
  const infoOf = (el) => (el && el.closest ? el.closest('.home-row')?.querySelector('.row-info') || null : null);

  /** Under the row, like Netflix: "Series · Thriller · 2026 · 2 Seasons (15)" and the summary. */
  function showInfo(c, d, series) {
    const box = infoOf(c);
    if (!box) return;
    box.replaceChildren();
    const meta = document.createElement('div'); meta.className = 'ri-meta';
    const line = document.createElement('span'); line.textContent = tmdb.detailsLine(d, series);
    meta.appendChild(line);
    if (d.cert) {
      const b = document.createElement('span');
      b.className = `ri-cert c${d.cert.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
      b.textContent = d.cert;
      meta.appendChild(b);
    }
    box.appendChild(meta);
    if (d.overview) { const s = document.createElement('p'); s.className = 'ri-sum'; s.textContent = d.overview; box.appendChild(s); }
    if (shownInfo && shownInfo !== box) shownInfo.hidden = true;
    shownInfo = box;
    box.hidden = false;
    if (o.revealInfo) o.revealInfo(box); // the summary under the row, not cut off at the bottom
  }

  function focus(el) {
    if (el === card) return;
    const was = card;
    // the details under a row stay while you move along it (the next card's replace them)
    if (shownInfo && infoOf(el) !== shownInfo) { shownInfo.hidden = true; shownInfo = null; }
    leave();
    if (store.homePreviews() !== 1) return;
    const it = peekable(el);
    if (!it) return;
    card = el;
    const my = seq;
    const widen = () => {
      widenTimer = null;
      if (my !== seq || card !== document.activeElement) return;
      card.classList.add('peek');
      if (o.reveal) o.reveal(card, was); // straight to where it will be once it has widened
      dress(card, it, my);
      playTimer = setTimeout(async () => {
        playTimer = null;
        if (my !== seq) return;
        const w = await what(it);
        if (!w || my !== seq || !card || card !== document.activeElement) return;
        const art = card.querySelector('.art');
        box = art; cover = (art && art.querySelector('img')) || art;
        const p = getPreview();
        p.setLogo(cover);
        card.classList.add('peek-playing');
        p.start(w.item, w.from);
      }, PLAY_AFTER_MS);
    };
    if (WIDEN_AFTER_MS > 0) widenTimer = setTimeout(widen, WIDEN_AFTER_MS); else widen();
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
    let urls = { logo: null, backdrop: null, details: null };
    try {
      const id = await tmdb.findId(film ? tmdb.MOVIE : tmdb.TV, name, it.tmdb);
      const d = id ? await tmdb.details(film ? tmdb.MOVIE : tmdb.TV, id) : null;
      if (d) urls = { logo: d.logo, backdrop: d.backdrop, details: d };
    } catch { /* no art: the poster stays */ }
    if (my !== seq) return;
    const put = (img, url, fade) => {
      if (!url) return;
      img.onload = () => { if (my === seq) fade.classList.add('shown'); };
      img.src = url;
    };
    put(back, urls.backdrop, back);
    put(logo, urls.logo, layer);
    if (urls.details) showInfo(c, urls.details, !film);
  }

  return {
    focus,
    leave: () => leave(false),
    release: () => leave(true),
    get card() { return card; },
    get playing() { return !!preview && preview.playing; },
  };
}
