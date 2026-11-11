// Search: a text box plus a Live/Movies/Series toggle; filters the section's loaded list by name.
// Enter opens the result (channel -> player-live, movie -> movie-detail, series -> series-detail);
// Menu toggles a favourite. No server-side search: lists come from api.streams(type, null), cached per mount.
import * as api from '../api.js';
import * as nav from '../nav.js';
import { router } from '../router.js';
import { LIVE, MOVIE, SERIES } from '../item.js';
import * as favourites from '../favourites.js';
import * as store from '../store.js';

const KEY_MENU = 10133;
const DEBOUNCE_MS = 120;
const MAX_RESULTS = 200;
const SECTIONS = [[LIVE, 'Live'], [MOVIE, 'Movies'], [SERIES, 'Series']];

export function searchView() {
  let root; let box; let listEl; let section = LIVE; let results = [];
  let timer = null; let seq = 0; let cache; let onClick; let onActivate; let onInput;

  async function list(type) {
    if (!cache.has(type)) cache.set(type, api.streams(type, null).catch(() => { cache.delete(type); return []; }));
    return cache.get(type);
  }

  function message(text) {
    results = [];
    const p = document.createElement('p');
    p.className = 'empty'; p.textContent = text;
    listEl.replaceChildren(p);
  }

  function renderResult(it) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.result = it.id;
    b.className = `result${store.isFav(it) ? ' fav' : ''}`;
    const art = document.createElement('span'); art.className = 'art';
    if (it.icon) { const img = document.createElement('img'); img.src = it.icon; img.alt = ''; art.appendChild(img); }
    const name = document.createElement('span'); name.className = 'name'; name.textContent = it.name;
    b.append(art, name);
    return b;
  }

  async function run() {
    const mine = ++seq;
    const q = box.value.trim().toLowerCase();
    if (!q) { message('Type to search'); return; }
    const all = await list(section);
    if (mine !== seq || !root) return;
    results = all.filter((i) => (i.name || '').toLowerCase().includes(q)).slice(0, MAX_RESULTS);
    if (!results.length) { message('No results'); return; }
    listEl.replaceChildren(...results.map(renderResult));
  }

  function open(index) {
    const item = results[index];
    if (!item) return;
    if (section === LIVE) router.go('player-live', { channels: results, index });
    else router.go(section === MOVIE ? 'movie-detail' : 'series-detail', { item });
  }

  return {
    mount(rootEl) {
      root = rootEl; cache = new Map();
      const el = document.createElement('div');
      el.className = 'search';
      const head = document.createElement('header');
      box = document.createElement('input');
      box.type = 'text'; box.placeholder = 'Search'; box.autocomplete = 'off';
      head.appendChild(box);
      for (const [type, label] of SECTIONS) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.section = type; b.textContent = label;
        b.className = type === section ? 'selected' : '';
        head.appendChild(b);
      }
      listEl = document.createElement('section');
      listEl.className = 'results';
      el.append(head, listEl);
      root.appendChild(el);
      message('Type to search');

      onInput = () => { clearTimeout(timer); timer = setTimeout(run, DEBOUNCE_MS); };
      onClick = (e) => {
        const s = e.target.closest('[data-section]');
        if (s) {
          section = s.dataset.section;
          for (const b of head.querySelectorAll('[data-section]')) b.classList.toggle('selected', b === s);
          clearTimeout(timer);
          run();
          return;
        }
        const r = e.target.closest('[data-result]');
        if (r) open([...listEl.querySelectorAll('[data-result]')].indexOf(r));
      };
      onActivate = (e) => { e.target.closest('button')?.click(); };
      box.addEventListener('input', onInput);
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      nav.register(root);
      box.focus();
    },
    onKey(e) {
      if (e.keyCode !== KEY_MENU) return false;
      e.preventDefault();
      const el = document.activeElement;
      if (!root || !root.contains(el) || !el.dataset.result) return false;
      const it = results.find((r) => r.id === el.dataset.result);
      if (!it) return false;
      favourites.toggleItem(it, el);
      return true;
    },
    unmount() {
      seq++; clearTimeout(timer);
      if (box) box.removeEventListener('input', onInput);
      if (root) { root.removeEventListener('click', onClick); root.removeEventListener('activate', onActivate); }
      root = box = listEl = null; results = [];
    },
  };
}
