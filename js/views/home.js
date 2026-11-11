// Apple-TV style Home: top menu to the sections, then content rows (see js/home-rows.js).
import * as nav from '../nav.js';
import * as store from '../store.js';
import { router } from '../router.js';
import { buildRows } from '../home-rows.js';

const MENU = [['live', 'Live'], ['movies', 'Movies'], ['series', 'Series'], ['search', 'Search'], ['settings', 'Settings'], ['ambient', 'Ambient'], ['phonelink', 'Phone']];

/** Where selecting a tile goes. */
export function openTarget(rowKey, items, index) {
  const item = items[index];
  if (item.type === 'live') { router.go('player-live', { channels: items, index }); return; }
  if (item.type === 'series') { router.go('series-detail', { item }); return; }
  if (rowKey === 'continue') { router.go('player-vod', { item, startMs: store.position(item) }); return; }
  router.go('movie-detail', { item });
}

export function homeView() {
  let root; let onClick; let onActivate; let rows = [];
  return {
    async mount(rootEl, params) {
      root = rootEl;
      const el = document.createElement('div');
      el.className = 'home';
      const header = document.createElement('header');
      header.className = 'home-menu';
      for (const [name, label] of MENU) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.menu = name; b.textContent = label;
        header.appendChild(b);
      }
      if (params && params.status) {
        const chip = document.createElement('span');
        chip.className = 'status-chip'; chip.textContent = params.status;
        header.appendChild(chip);
      }
      const body = document.createElement('div');
      body.className = 'home-rows';
      el.append(header, body);
      root.appendChild(el);

      onClick = (e) => {
        const m = e.target.closest('[data-menu]');
        if (m) { router.go(m.dataset.menu); return; }
        const t = e.target.closest('[data-tile]');
        if (!t) return;
        const row = rows.find((r) => r.key === t.dataset.row);
        if (row) openTarget(row.key, row.items, Number(t.dataset.tile));
      };
      root.addEventListener('click', onClick);
      onActivate = (e) => { e.target.closest('button')?.click(); };
      root.addEventListener('activate', onActivate);
      nav.register(root);
      nav.focusFirst(header);

      const built = await buildRows();
      if (!root) return;
      rows = built;
      for (const r of rows) {
        const sec = document.createElement('section');
        sec.className = 'home-row'; sec.dataset.row = r.key;
        const h = document.createElement('h2'); h.textContent = r.title;
        const strip = document.createElement('div'); strip.className = 'strip';
        r.items.forEach((it, i) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'tile'; b.dataset.tile = i; b.dataset.row = r.key; b.dataset.item = it.id;
          const art = document.createElement('span'); art.className = 'art';
          const icon = it.icon || it.parentIcon;
          if (icon) { const img = document.createElement('img'); img.src = icon; img.alt = ''; img.loading = 'lazy'; art.appendChild(img); }
          const title = document.createElement('span'); title.className = 'title'; title.textContent = it.name || '';
          b.append(art, title);
          strip.appendChild(b);
        });
        sec.append(h, strip);
        body.appendChild(sec);
      }
    },
    unmount() {
      if (root) {
        if (onClick) root.removeEventListener('click', onClick);
        if (onActivate) root.removeEventListener('activate', onActivate);
      }
      root = null; rows = []; onClick = onActivate = null;
    },
  };
}
