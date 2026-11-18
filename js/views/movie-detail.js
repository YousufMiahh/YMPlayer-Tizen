// Movie page (MovieActivity.java). Params: { item }.
// Full-bleed backdrop (the poster first, then backdrop_path[0] / movie_image) under Android's
// left and bottom page scrims; a 900u column anchored bottom-left with the title, the
// "year · duration · genre · ★ rating" line, the plot, "Director: … · Cast: …" and, Netflix-style,
// the big stacked buttons
//   ▶  Resume (with its progress bar) | ↻  Play From Beginning     (with a saved point)
//   ▶  Play | Audio & Subtitles                                    (otherwise)
// then on a line: ▶  Trailer (once get_vod_info names one) | ♡  Favourite | ＋  Queue | ○  Mark Watched.
// Focus starts on Play. Coming back from the player or a trailer rebuilds the buttons (onResume),
// so the progress is current and focus is on Play again. Something part way through plays muted
// behind the page after a moment, from where you were (Settings → Film & Series Previews).
import * as api from '../api.js';
import * as store from '../store.js';
import * as nav from '../nav.js';
import { play } from '../open.js';
import { openTrailer } from '../trailer.js';
import { movieInfo, movieButtons, favLabel, queueLabel } from '../detail.js';
import { pillButton } from '../ui/widgets.js';
import { renderButtons, askAudioSubtitles, pagePreview } from '../ui/hero.js';

export const FADE_MS = 500; // loadBackdrop: alpha 0 -> 1 over 500 ms

/**
 * The page frame both detail screens share: BG, the centre-cropped backdrop that fades in, then
 * Ui.scrimLeft() and Ui.pageScrimBottom() over it.
 */
export function detailFrame(className) {
  const el = document.createElement('div');
  el.className = `detail-page ${className}`;
  const img = document.createElement('img');
  img.className = 'dp-backdrop'; img.alt = '';
  const left = document.createElement('div'); left.className = 'dp-scrim-left';
  const bottom = document.createElement('div'); bottom.className = 'dp-scrim-bottom';
  el.append(img, left, bottom);
  let token = 0;
  /** ImageLoader.load + animate().alpha(1): the picture is swapped in once it has loaded. */
  const setBackdrop = (url, { fade = true } = {}) => {
    if (!url) return;
    const mine = ++token;
    if (!fade) img.classList.add('now');
    const show = () => {
      if (mine !== token) return;
      img.src = url;
      img.classList.add('on');
    };
    if (typeof Image === 'undefined' || !fade) { show(); return; }
    const pre = new Image();
    pre.onload = show;
    pre.onerror = () => { if (mine === token) img.classList.add('on'); }; // alpha still goes to 1
    pre.src = url;
  };
  return { el, setBackdrop, backdrop: img };
}

export function movieDetailView() {
  let root; let item; let params; let page; let buttonsEl; let metaEl; let plotEl; let creditsEl;
  let trailer = null; let seq = 0; let onActivate; let onClick; let preview = null;

  const all = () => [...buttonsEl.querySelectorAll('button')];

  function buildButtons() {
    renderButtons(buttonsEl, movieButtons(item, trailer), (b) => pillButton(b.label, { action: b.action }));
    // `if (!buttons.hasFocus()) playBtn.requestFocus()`: the old buttons are gone, so Play.
    all()[0].focus();
    if (preview) preview.schedule(item, store.position(item));
  }

  function act(action, btn) {
    if (action === 'fav') { store.toggleFav(item); btn.textContent = favLabel(item); return; }
    if (action === 'queue') {
      if (store.inQueue(item)) store.queueRemove(item); else store.queueAdd(item);
      btn.textContent = queueLabel(item);
      return;
    }
    if (action === 'watched') { // watched also clears the resume point, so the row is rebuilt
      store.setWatched(item, !store.isWatched(item));
      buildButtons();
      all().at(-1).focus();
      return;
    }
    if (action === 'audio') { askAudioSubtitles(); return; }
    if (preview) preview.stop();
    if (action === 'trailer') { openTrailer(trailer); return; }
    if (action === 'over') store.setPosition(item, 0); // Start Over forgets the saved point first
    play([item], 0);
  }

  /** MovieActivity.loadInfo's callback. */
  function apply(r, { fade }) {
    const m = movieInfo(r, item);
    if (!m) return;
    if (m.plot !== null) { plotEl.textContent = m.plot; item.plot = m.plot; }
    if (m.meta !== null) metaEl.textContent = m.meta;
    creditsEl.textContent = m.credits;
    if (m.backdrop) page.setBackdrop(m.backdrop, { fade });
    if (m.trailer && trailer === null) {
      trailer = m.trailer;
      const f = document.activeElement;
      const idx = f && buttonsEl.contains(f) ? all().indexOf(f) : 0;
      buildButtons();
      const b = all()[idx];
      if (b) b.focus();
    }
    if (m.ext && !item.ext) item.ext = m.ext;
    if (m.tmdb && !item.tmdb) item.tmdb = m.tmdb;
  }

  return {
    async mount(rootEl, p) {
      root = rootEl; params = p; trailer = null;
      // Android works on its own copy of the item (ext and plot are filled in from the info).
      item = params.movie || (params.movie = { ...params.item });
      page = detailFrame('movie-page');
      const col = document.createElement('div');
      col.className = 'mp-col';
      const title = document.createElement('h1'); title.className = 'dp-title'; title.textContent = item.name || '';
      metaEl = document.createElement('div'); metaEl.className = 'dp-meta'; metaEl.textContent = item.info || '';
      plotEl = document.createElement('div'); plotEl.className = 'dp-plot';
      creditsEl = document.createElement('div'); creditsEl.className = 'dp-credits';
      buttonsEl = document.createElement('div'); buttonsEl.className = 'dp-buttons';
      col.append(title, metaEl, plotEl, creditsEl, buttonsEl);
      page.el.appendChild(col);
      root.appendChild(page.el);
      preview = pagePreview(page);

      onClick = (e) => {
        const b = e.target.closest && e.target.closest('[data-action]');
        if (b && buttonsEl.contains(b)) act(b.dataset.action, b);
      };
      onActivate = (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.click(); };
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      nav.register(root);
      buildButtons();

      // The Activity stays alive under the player: what it loaded is still there on the way back.
      if (params.vodInfo) {
        if (item.icon) page.setBackdrop(item.icon, { fade: false });
        apply(params.vodInfo, { fade: false });
        return;
      }
      if (item.icon) page.setBackdrop(item.icon);
      const mine = ++seq;
      let r = null;
      try { r = await api.vodInfo(item.id); } catch { r = null; } // Android: nothing changes
      if (mine !== seq || !root || !r) return;
      params.vodInfo = r;
      apply(r, { fade: true });
    },
    unmount() {
      seq++;
      if (preview) { preview.stop(); preview = null; }
      if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('activate', onActivate);
      }
      root = item = params = page = buttonsEl = metaEl = plotEl = creditsEl = null;
    },
  };
}
