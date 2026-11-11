// Live TV browser: category rail on the left, channel rows (logo, num, name, Now/Next) on the right.
// Enter opens the channel in `player-live`; Menu toggles a favourite; Back goes to the rail first.
import * as api from '../api.js';
import * as store from '../store.js';
import * as nav from '../nav.js';
import { router } from '../router.js';
import { LIVE } from '../item.js';

const KEY_MENU = 10133;
const KEY_ENTER = 13;
const HOLD_MS = 600; // long-press OK toggles favourite instead of opening
const EAGER_EPG = 8; // rows whose Now/Next is fetched up front; the rest load when focused

export function liveView() {
  let root; let railEl; let listEl; let params; let cats = []; let channels = [];
  let holdTimer = null; let held = false; let onKeyUp;
  let loadSeq = 0; let epgCache; let onClick; let onActivate; let onBack; let onFocusIn;

  const catBtn = (id) => railEl.querySelector(`[data-cat="${id}"]`);

  function renderRail() {
    const fav = (c) => store.isFavCategory(LIVE, c.id);
    const ordered = [...cats.filter(fav), ...cats.filter((c) => !fav(c))];
    railEl.replaceChildren(...ordered.map((c) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.cat = c.id;
      b.className = `cat${fav(c) ? ' fav' : ''}`;
      b.textContent = (fav(c) ? '★ ' : '') + c.name;
      return b;
    }));
  }

  function fillEpg(row, ch) {
    if (epgCache.has(ch.id)) return;
    const seq = loadSeq;
    epgCache.set(ch.id, null);
    api.shortEpg(ch.id).then(([now, next]) => {
      epgCache.set(ch.id, [now, next]);
      if (seq !== loadSeq || !root || !row.isConnected) return;
      row.querySelector('.now').textContent = now || '';
      row.querySelector('.next').textContent = next || '';
    }, () => { epgCache.delete(ch.id); });
  }

  function renderRow(ch) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.channel = ch.id;
    b.className = `channel${store.isFav(ch) ? ' fav' : ''}`;
    const logo = document.createElement('span');
    logo.className = 'logo';
    if (ch.icon) {
      const img = document.createElement('img');
      img.src = ch.icon; img.alt = '';
      logo.appendChild(img);
    }
    const num = document.createElement('span');
    num.className = 'num'; num.textContent = ch.num || '';
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = ch.name;
    const epg = document.createElement('span');
    epg.className = 'epg';
    epg.innerHTML = '<span class="now"></span><span class="next"></span>';
    b.append(logo, num, name, epg);
    return b;
  }

  async function selectCategory(id, focusList) {
    const seq = ++loadSeq;
    epgCache = new Map();
    if (params) params.categoryId = id;
    for (const b of railEl.querySelectorAll('.cat')) b.classList.toggle('selected', b.dataset.cat === id);
    let list;
    try { list = await api.streams(LIVE, id); } catch { list = []; }
    if (seq !== loadSeq || !root) return;
    channels = list;
    listEl.replaceChildren(...list.map(renderRow));
    if (!list.length) listEl.innerHTML = '<p class="empty">No channels in this category.</p>';
    [...listEl.querySelectorAll('[data-channel]')].slice(0, EAGER_EPG)
      .forEach((row, i) => fillEpg(row, list[i]));
    if (focusList) nav.focusFirst(listEl);
  }

  function openChannel(id) {
    const index = channels.findIndex((c) => c.id === id);
    if (index < 0) return;
    if (params) params.channelId = id;
    router.go('player-live', { channels, index });
  }

  function toggleFavourite() {
    const el = document.activeElement;
    if (!root || !root.contains(el)) return false;
    if (el.dataset.channel) {
      const ch = channels.find((c) => c.id === el.dataset.channel);
      if (!ch) return false;
      el.classList.toggle('fav', store.toggleFav(ch));
      return true;
    }
    if (el.dataset.cat) {
      store.toggleFavCategory(LIVE, el.dataset.cat);
      renderRail();
      const b = catBtn(el.dataset.cat);
      if (b) b.focus();
      if (params?.categoryId) catBtn(params.categoryId)?.classList.add('selected');
      return true;
    }
    return false;
  }

  return {
    async mount(rootEl, p) {
      root = rootEl; params = p;
      epgCache = new Map();
      const el = document.createElement('div');
      el.className = 'live';
      el.innerHTML = '<nav class="rail"></nav><section class="channels"></section>';
      railEl = el.querySelector('.rail');
      listEl = el.querySelector('.channels');
      root.appendChild(el);

      onClick = (e) => {
        const cat = e.target.closest('[data-cat]');
        if (cat) { selectCategory(cat.dataset.cat, true); return; }
        const ch = e.target.closest('[data-channel]');
        if (ch) openChannel(ch.dataset.channel);
      };
      onActivate = (e) => { if (e.target.closest('button')) e.target.closest('button').click(); };
      onFocusIn = (e) => {
        const row = e.target.closest?.('[data-channel]');
        const ch = row && channels.find((c) => c.id === row.dataset.channel);
        if (ch) fillEpg(row, ch);
      };
      // Back from a channel row returns to the rail; from the rail it falls through to the router.
      onBack = (e) => {
        if (e.target.closest?.('[data-channel]')) {
          e.stopPropagation();
          (catBtn(params?.categoryId) || railEl.querySelector('[data-cat]'))?.focus();
        }
      };
      onKeyUp = (e) => {
        if (e.keyCode !== KEY_ENTER) return;
        const wasHold = held;
        const pending = holdTimer !== null;
        clearTimeout(holdTimer); holdTimer = null; held = false;
        const el = document.activeElement;
        if (pending && !wasHold && root && root.contains(el) && el.matches('[data-cat], [data-channel]')) el.click();
      };
      document.addEventListener('keyup', onKeyUp);
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      root.addEventListener('focusin', onFocusIn);
      root.addEventListener('back', onBack);
      nav.register(root);

      try { cats = await api.categories(LIVE); } catch { cats = []; }
      if (!root) return; // unmounted while loading
      renderRail();
      const first = (params?.categoryId && catBtn(params.categoryId)) || railEl.querySelector('[data-cat]');
      if (!first) { listEl.innerHTML = '<p class="empty">No categories.</p>'; return; }
      first.focus();
      if (params?.categoryId) {
        await selectCategory(params.categoryId, false);
        const back = params.channelId && listEl.querySelector(`[data-channel="${params.channelId}"]`);
        if (back) back.focus();
      }
    },
    onKey(e) {
      if (e.keyCode === KEY_MENU) {
        e.preventDefault();
        return toggleFavourite();
      }
      // OK is decided on release: short press activates, a hold (HOLD_MS) toggles favourite.
      if (e.keyCode === KEY_ENTER && root && root.contains(document.activeElement)
          && document.activeElement.matches('[data-cat], [data-channel]')) {
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
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('back', onBack);
      }
      root = railEl = listEl = params = null;
    },
  };
}
