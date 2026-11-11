// Movie detail. Params: { item }. Shows poster, plot, rating, and Resume / Play from start.
import * as api from '../api.js';
import * as store from '../store.js';
import * as nav from '../nav.js';
import { router } from '../router.js';

export function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function movieDetailView() {
  let root; let item; let onClick; let onActivate; let seq = 0;

  return {
    async mount(rootEl, params) {
      root = rootEl; item = params.item;
      const pos = store.position(item);
      const el = document.createElement('div');
      el.className = 'detail';
      const poster = document.createElement('div');
      poster.className = 'poster-big';
      const body = document.createElement('div');
      body.className = 'body';
      const h = document.createElement('h1'); h.textContent = item.name;
      const meta = document.createElement('p'); meta.className = 'meta'; meta.textContent = item.info ? `★ ${item.info}` : '';
      const plot = document.createElement('p'); plot.className = 'plot'; plot.textContent = item.plot || '';
      const actions = document.createElement('div'); actions.className = 'actions';
      const btn = (action, text) => {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.action = action; b.textContent = text;
        return b;
      };
      if (pos > 0) actions.append(btn('resume', `Resume from ${formatTime(pos)}`));
      actions.append(btn('play', pos > 0 ? 'Play from start' : 'Play'));
      actions.append(btn('fav', store.isFav(item) ? '★ Favourited' : '☆ Favourite'));
      body.append(h, meta, plot, actions);
      el.append(poster, body);
      root.appendChild(el);
      const setPoster = (src) => {
        if (!src) return;
        poster.replaceChildren();
        const img = document.createElement('img'); img.src = src; img.alt = '';
        poster.appendChild(img);
      };
      setPoster(item.icon);

      onClick = (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const a = b.dataset.action;
        if (a === 'fav') {
          b.textContent = store.toggleFav(item) ? '★ Favourited' : '☆ Favourite';
        } else {
          router.go('player-vod', { item, startMs: a === 'resume' ? pos : 0 });
        }
      };
      onActivate = (e) => { e.target.closest('button')?.click(); };
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      nav.register(root);
      nav.focusFirst(actions);

      const mine = ++seq;
      let data = null;
      try { data = await api.vodInfo(item.id); } catch { /* keep list data */ }
      if (mine !== seq || !root) return;
      const info = data?.info || {};
      if (info.plot) plot.textContent = info.plot;
      const rating = info.rating || info.rating_5based;
      if (rating) meta.textContent = `★ ${rating}`;
      setPoster(info.movie_image || info.cover_big);
    },
    unmount() {
      seq++;
      if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('activate', onActivate);
      }
      root = item = null;
    },
  };
}
