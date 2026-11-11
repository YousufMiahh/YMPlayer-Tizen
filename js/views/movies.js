// VOD browser shared by Movies and Series: category rail on the left, poster grid on the right.
// Enter opens the detail view; Menu / long-press OK toggles a favourite (item or category).
import * as api from '../api.js';
import * as store from '../store.js';
import * as nav from '../nav.js';
import { router } from '../router.js';
import { MOVIE } from '../item.js';
import * as favourites from '../favourites.js';

const KEY_MENU = 10133;
const KEY_ENTER = 13;
const HOLD_MS = 600;

/** @param type MOVIE|SERIES  @param detail name of the detail view to open */
export function vodBrowseView(type, detail) {
  return function create() {
    let root; let railEl; let gridEl; let params; let cats = []; let items = [];
    let holdTimer = null; let held = false; let loadSeq = 0;
    let onKeyUp; let onClick; let onActivate; let onBack;

    const catBtn = (id) => railEl.querySelector(`[data-cat="${id}"]`);

    function renderRail() { railEl.replaceChildren(...favourites.railButtons(type, cats)); }

    function renderCard(it) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.item = it.id;
      b.className = `poster${store.isFav(it) ? ' fav' : ''}`;
      const art = document.createElement('span');
      art.className = 'art';
      if (it.icon) {
        const img = document.createElement('img');
        img.src = it.icon; img.alt = ''; img.loading = 'lazy';
        art.appendChild(img);
      }
      const name = document.createElement('span');
      name.className = 'title'; name.textContent = it.name;
      b.append(art, name);
      return b;
    }

    async function selectCategory(id, focusGrid) {
      const seq = ++loadSeq;
      if (params) params.categoryId = id;
      for (const b of railEl.querySelectorAll('.cat')) b.classList.toggle('selected', b.dataset.cat === id);
      let list;
      try { list = await api.streams(type, id); } catch { list = []; }
      if (seq !== loadSeq || !root) return;
      items = list;
      gridEl.replaceChildren(...list.map(renderCard));
      if (!list.length) gridEl.innerHTML = '<p class="empty">Nothing in this category.</p>';
      if (focusGrid) nav.focusFirst(gridEl);
    }

    function openItem(id) {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      if (params) params.itemId = id;
      router.go(detail, { item });
    }

    function toggleFavourite() {
      const el = document.activeElement;
      if (!root || !root.contains(el)) return false;
      if (el.dataset.item) {
        const it = items.find((i) => i.id === el.dataset.item);
        if (!it) return false;
        favourites.toggleItem(it, el);
        return true;
      }
      if (el.dataset.cat) {
        favourites.toggleCategory(type, el.dataset.cat, railEl, cats, params?.categoryId);
        return true;
      }
      return false;
    }

    return {
      async mount(rootEl, p) {
        root = rootEl; params = p || {};
        const el = document.createElement('div');
        el.className = 'live vod';
        el.innerHTML = '<nav class="rail"></nav><section class="grid"></section>';
        railEl = el.querySelector('.rail');
        gridEl = el.querySelector('.grid');
        root.appendChild(el);

        onClick = (e) => {
          const cat = e.target.closest('[data-cat]');
          if (cat) { selectCategory(cat.dataset.cat, true); return; }
          const card = e.target.closest('[data-item]');
          if (card) openItem(card.dataset.item);
        };
        onActivate = (e) => { e.target.closest('button')?.click(); };
        // Back from a poster returns to the rail; from the rail it falls through to the router.
        onBack = (e) => {
          if (e.target.closest?.('[data-item]')) {
            e.stopPropagation();
            (catBtn(params?.categoryId) || railEl.querySelector('[data-cat]'))?.focus();
          }
        };
        onKeyUp = (e) => {
          if (e.keyCode !== KEY_ENTER) return;
          const wasHold = held;
          const pending = holdTimer !== null;
          clearTimeout(holdTimer); holdTimer = null; held = false;
          const el2 = document.activeElement;
          if (pending && !wasHold && root && root.contains(el2) && el2.matches('[data-cat], [data-item]')) el2.click();
        };
        document.addEventListener('keyup', onKeyUp);
        root.addEventListener('click', onClick);
        root.addEventListener('activate', onActivate);
        root.addEventListener('back', onBack);
        nav.register(root);

        try { cats = await api.categories(type); } catch { cats = []; }
        if (!root) return;
        renderRail();
        const first = (params.categoryId && catBtn(params.categoryId)) || railEl.querySelector('[data-cat]');
        if (!first) { gridEl.innerHTML = '<p class="empty">No categories.</p>'; return; }
        first.focus();
        if (params.categoryId) {
          await selectCategory(params.categoryId, false);
          const back = params.itemId && gridEl.querySelector(`[data-item="${params.itemId}"]`);
          if (back) back.focus();
        }
      },
      onKey(e) {
        if (e.keyCode === KEY_MENU) { e.preventDefault(); return toggleFavourite(); }
        // OK is decided on release: short press opens, a hold toggles favourite.
        if (e.keyCode === KEY_ENTER && root && root.contains(document.activeElement)
            && document.activeElement.matches('[data-cat], [data-item]')) {
          e.preventDefault();
          if (!e.repeat && holdTimer === null && !held) {
            holdTimer = setTimeout(() => { holdTimer = null; held = true; toggleFavourite(); }, HOLD_MS);
          }
          return true;
        }
        return false;
      },
      unmount() {
        loadSeq++;
        clearTimeout(holdTimer); holdTimer = null; held = false;
        document.removeEventListener('keyup', onKeyUp);
        if (root) {
          root.removeEventListener('click', onClick);
          root.removeEventListener('activate', onActivate);
          root.removeEventListener('back', onBack);
        }
        root = railEl = gridEl = params = null;
      },
    };
  };
}

export const moviesView = vodBrowseView(MOVIE, 'movie-detail');
