// Search (SearchActivity.java): channels, movies and series at once.
//   - one box ("Channels, movies and series", 820u, centred text), chips All / Live TV / Movies /
//     Series under it (All by default), a status line, then up to three sections in the order
//     Channels, Movies, Series.
//   - All: each section is a horizontal shelf of up to 40 cards, headed "Movies  ·  40+".
//     One chip, or All with hits in only one section: a full-width grid of up to 120.
//   - 2 characters minimum, 300 ms after the last key; ranking is Match.rank (js/match.js) over
//     Filters.searchItems (hidden countries / languages left out). Lists come from js/repo.js;
//     each section fills as soon as its list is ready and stale results are dropped.
//   - OK on a card opens it through Open.item (js/open.js) with the hits as the zap list;
//     Hold OK / Menu toggles the favourite with a toast.
//   - IME Done / Enter searches now and leaves the box (first result, else the Search tab);
//     Back (or the IME's Cancel) in the box does the same; Back elsewhere is TopBar.back.
//   - OK on the Search tab jumps back into the box.
import * as repo from '../repo.js';
import * as nav from '../nav.js';
import * as match from '../match.js';
import * as filters from '../filters.js';
import * as coach from '../ui/coach.js';
import { openItem, toggleFav } from '../open.js';
import { LIVE, MOVIE, SERIES } from '../item.js';
import { mountSection, tabFocused } from '../ui/topbar.js';
import { card as cardEl, pillInput, shelfTitle } from '../ui/widgets.js';
import { bringIntoView } from '../ui/scroll.js';
import { u, LONG_PRESS_MS } from '../ui/theme.js';

export const TYPES = [LIVE, MOVIE, SERIES];
export const TITLES = ['Channels', 'Movies', 'Series'];
export const CHIPS = ['All', 'Live TV', 'Movies', 'Series'];
export const HINT = 'Channels, movies and series';
export const MAX = 40;
export const GRID_MAX = 120;
export const DEBOUNCE_MS = 300;
export const IDLE = 'Type to search everything';
export const LOADING = 'Getting your library ready…';
export const SEARCHING = 'Searching…';
export const noResults = (q) => `No results for "${q}"`;
export const COACH_STEPS = [
  ['Search everything', "Type a channel, film or series. Spaces, dashes and accents don't matter, and the best matches come first."],
  ['Narrow it down', 'Choose Live TV, Movies or Series to see only those, laid out across the whole screen.'],
];

const K = { ENTER: 13, BACK: 10009, ESC: 27, MENU: 10133, IME_DONE: 65376, IME_CANCEL: 65385 };
const SHAPES = ['channel', 'poster', 'poster'];
const CARD_W = { poster: 160, channel: 220, landscape: 300 };

/** The section heading: "Movies  ·  12", with "+" when the list was cut at the maximum. */
export const heading = (slot, n, max) => `${TITLES[slot]}  ·  ${n}${n >= max ? '+' : ''}`;

/** Cards.grid: as many columns as fit in the screen width less 64u each side, 32u apart. */
export function gridColumns(shape, width = 1920) {
  const cardW = u(CARD_W[shape] || CARD_W.landscape); const gap = u(32);
  const usable = width - u(128);
  return Math.max(1, Math.floor((usable + gap) / (cardW + gap)));
}

/** The query as SearchActivity reads it: trimmed and lower-cased. */
export const queryOf = (text) => String(text || '').trim().toLowerCase();

/** SearchActivity.updateStatus. */
export function statusText(q, ready, found) {
  const all = ready.every(Boolean);
  if (q.length < 2) return all ? IDLE : LOADING;
  const total = found.reduce((a, b) => a + b, 0);
  if (!all) return total === 0 ? SEARCHING : '';
  return total === 0 ? noResults(q) : '';
}

/**
 * The matcher: Match.rank over Filters.searchItems, best first, at most `max`, worked through in
 * slices so a big library never blocks the remote. null = not loaded (or `cancelled` said stop).
 */
export async function rankSection(type, q, max, all = repo.cached(type, null), cancelled = null) {
  if (!all) return null;
  return match.rankAsync(await filters.searchItems(type, all), q, max, { cancelled });
}

export function searchView() {
  let root; let st; let screen; let bar; let box; let chipRow; let statusEl; let slots;
  let filter = 0; let token = 0; let timer = null; let cancelTour = () => {};
  let ready = [false, false, false]; let found = [0, 0, 0]; let hits = [[], [], []];
  let doneMask = 0; let hitMask = 0;
  let holdTimer = null; let held = false; let holdCard = null;
  const listeners = [];
  const listen = (el, ev, fn) => { el.addEventListener(ev, fn); listeners.push([el, ev, fn]); };
  const alive = () => !!root;
  const query = () => queryOf(box.value);
  const shows = (slot) => filter === 0 || filter === slot + 1;
  const active = () => document.activeElement;

  function paintChips() {
    [...chipRow.children].forEach((c, i) => {
      c.classList.toggle('on', i === filter);
      c.setAttribute('aria-pressed', String(i === filter));
    });
  }

  function updateStatus() {
    statusEl.textContent = statusText(query(), ready, found);
  }

  /** SearchActivity.setFilter: one type shows its results as a full-width grid. */
  function setFilter(f) {
    if (f === filter) return;
    filter = f;
    paintChips();
    search();
  }

  /** @returns a promise that settles when every ready section has its results. */
  function search() {
    token++;
    doneMask = 0; hitMask = 0;
    const q = query(); const work = [];
    for (let i = 0; i < 3; i++) {
      found[i] = 0;
      if (q.length < 2 || !shows(i)) { slots[i].replaceChildren(); hits[i] = []; } else if (ready[i]) work.push(searchSlot(i, q, token));
    }
    updateStatus();
    return Promise.all(work);
  }

  function renderSection(slot, list, asGrid, max) {
    const shape = SHAPES[slot];
    const sec = document.createElement('section');
    sec.className = asGrid ? 's-grid' : 's-shelf';
    sec.dataset.slot = String(slot);
    sec.appendChild(shelfTitle(heading(slot, list.length, max)));
    const cards = list.map((it, i) => {
      const c = cardEl({ shape, image: it.icon || null, title: it.name || '' });
      c.dataset.slot = String(slot); c.dataset.idx = String(i);
      return c;
    });
    if (asGrid) {
      const cols = gridColumns(shape, (screen && screen.clientWidth) || 1920);
      for (let i = 0; i < cards.length; i += cols) {
        const row = document.createElement('div');
        row.className = 'grid-row';
        row.append(...cards.slice(i, i + cols));
        sec.appendChild(row);
      }
    } else {
      const strip = document.createElement('div');
      strip.className = 'strip';
      strip.append(...cards);
      sec.appendChild(strip);
    }
    return sec;
  }

  /**
   * Matches, then swaps that section's results; stale results are dropped.
   * @param forceGrid "All" found results in only this section: show them as a full grid.
   */
  async function searchSlot(slot, q, t, forceGrid = false) {
    if (q.length < 2 || !shows(slot)) return;
    const asGrid = filter !== 0 || forceGrid;
    const max = asGrid ? GRID_MAX : MAX;
    const list = await rankSection(TYPES[slot], q, max, undefined, () => t !== token || !alive());
    if (!list || t !== token || !alive()) return;
    const focusInside = slots[slot].contains(active());
    hits[slot] = list;
    found[slot] = list.length;
    slots[slot].replaceChildren(...(list.length ? [renderSection(slot, list, asGrid, max)] : []));
    if (focusInside) box.focus({ preventScroll: true });
    updateStatus();
    if (filter === 0 && !forceGrid) {
      doneMask |= 1 << slot;
      if (list.length) hitMask |= 1 << slot;
      let allDone = true;
      for (let k = 0; k < 3; k++) if (ready[k] && !(doneMask & (1 << k))) allDone = false;
      const one = [0, 1, 2].filter((k) => hitMask & (1 << k));
      // Only one section had anything: lay it out as the full grid, like picking that section.
      if (allDone && ready.every(Boolean) && one.length === 1) await searchSlot(one[0], q, t, true);
    }
  }

  /** SearchActivity.loadLibrary: the saved lists; a section fills as soon as its list arrives. */
  function loadLibrary() {
    for (let i = 0; i < 3; i++) ready[i] = repo.cached(TYPES[i], null) !== null;
    updateStatus();
    for (let i = 0; i < 3; i++) {
      if (ready[i]) continue;
      repo.streams(TYPES[i], null).catch(() => null).then(() => {
        if (!alive()) return;
        ready[i] = true;
        updateStatus();
        return searchSlot(i, query(), token); // fill this section as soon as it arrives
      });
    }
  }

  function firstCard() {
    for (const s of slots) { const c = s.querySelector('.card'); if (c) return c; }
    return null;
  }

  /** SearchActivity.closeKeyboard: leave the box for the first result, else the Search tab. */
  function closeKeyboard() {
    box.blur();
    const first = firstCard();
    if (first) focusCard(first);
    else bar.focusCurrent();
  }

  function focusCard(c) {
    c.focus({ preventScroll: true });
    reveal(c);
  }

  function reveal(el) {
    if (!screen || !el) return;
    const strip = el.classList.contains('card') && el.parentElement.classList.contains('strip') ? el.parentElement : null;
    if (strip) bringIntoView(el, strip, false, true);
    bringIntoView(el, screen, true, true);
  }

  const itemOf = (c) => hits[Number(c.dataset.slot)][Number(c.dataset.idx)];

  function pick(c) {
    const slot = Number(c.dataset.slot);
    const it = itemOf(c);
    if (it) openItem(it, hits[slot]);
  }

  function menu(c) {
    const it = itemOf(c);
    if (it) toggleFav(it);
  }

  function remember() {
    if (!st) return;
    const f = active();
    st.query = box.value; st.filter = filter; st.scrollTop = screen.scrollTop;
    st.focus = null;
    if (f && f.dataset && f.dataset.slot !== undefined && f.classList.contains('card')) {
      st.focus = { slot: Number(f.dataset.slot), idx: Number(f.dataset.idx), left: f.parentElement.scrollLeft };
    } else if (f && f.dataset && f.dataset.chip !== undefined) st.focus = { chip: Number(f.dataset.chip) };
  }

  function restore() {
    const f = st.focus;
    screen.scrollTop = st.scrollTop || 0;
    if (f && f.chip !== undefined) { chipRow.children[f.chip]?.focus({ preventScroll: true }); return; }
    if (f && f.slot !== undefined) {
      const c = slots[f.slot].querySelector(`.card[data-idx="${f.idx}"]`) || firstCard();
      if (c) {
        if (c.parentElement.classList.contains('strip')) c.parentElement.scrollLeft = f.left || 0;
        c.focus({ preventScroll: true }); reveal(c);
        return;
      }
    }
    box.focus({ preventScroll: true });
  }

  return {
    mount(rootEl, params) {
      root = rootEl;
      st = params && typeof params === 'object' ? params : {};
      const sec = mountSection(root, 'search', {
        onReselect: () => box.focus(), // OK on the Search tab: into the box (keyboard up)
        onDown: () => box.focus(),
      });
      bar = sec.bar; screen = sec.el;
      screen.dataset.ownScroll = '';
      const page = document.createElement('div');
      page.className = 'search';
      box = pillInput(HINT, 'text');
      box.className += ' s-box';
      box.enterKeyHint = 'search';
      box.spellcheck = false;
      chipRow = document.createElement('div');
      chipRow.className = 's-chips';
      CHIPS.forEach((name, i) => {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 's-chip'; c.textContent = name; c.dataset.chip = String(i);
        chipRow.appendChild(c);
      });
      statusEl = document.createElement('p');
      statusEl.className = 's-status';
      slots = [0, 1, 2].map((i) => { const s = document.createElement('div'); s.className = 's-slot'; s.dataset.slot = String(i); return s; });
      page.append(box, chipRow, statusEl, ...slots);
      sec.page.appendChild(page);

      if (typeof st.filter === 'number') filter = st.filter;
      if (st.query) box.value = st.query;
      paintChips();

      listen(box, 'input', () => { clearTimeout(timer); timer = setTimeout(search, DEBOUNCE_MS); });
      listen(chipRow, 'click', (e) => {
        const c = e.target.closest('[data-chip]');
        if (c) setFilter(Number(c.dataset.chip));
      });
      listen(page, 'click', (e) => { // pointer; the remote's OK is decided on key-up below
        const c = e.target.closest('.card');
        if (c) pick(c);
      });
      listen(root, 'activate', (e) => { const c = e.target.closest && e.target.closest('[data-chip]'); if (c) c.click(); });
      listen(screen, 'focusin', (e) => reveal(e.target));
      listen(document, 'keyup', (e) => {
        if (e.keyCode !== K.ENTER) return;
        const wasHold = held; const pending = holdTimer !== null; const c = holdCard;
        clearTimeout(holdTimer); holdTimer = null; held = false; holdCard = null;
        if (pending && !wasHold && root && c && c === active()) pick(c);
      });
      nav.register(root);

      loadLibrary();
      if (st.query !== undefined) search().then(() => { if (root && !tabFocused()) restore(); });
      else if (!tabFocused()) box.focus({ preventScroll: true });
      cancelTour = coach.show('search', [
        { target: box, title: COACH_STEPS[0][0], body: COACH_STEPS[0][1] },
        { target: chipRow, title: COACH_STEPS[1][0], body: COACH_STEPS[1][1] },
      ], alive);
    },
    onKey(e) {
      const k = e.keyCode; const f = active();
      if (!root || !f || !root.contains(f)) return false;
      if (f === box) {
        if (k === K.ENTER || k === K.IME_DONE) {
          // Search now, then leave the box (Android closes the keyboard straight away and its
          // results land a moment later; here focus waits for them so it can go to the first one).
          e.preventDefault(); clearTimeout(timer);
          const t = token + 1;
          search().then(() => { if (root && t === token && active() === box) closeKeyboard(); });
          return true;
        }
        if (k === K.BACK || k === K.ESC || k === K.IME_CANCEL) { e.preventDefault(); closeKeyboard(); return true; }
        return false;
      }
      if (!f.classList.contains('card')) return false;
      if (k === K.MENU) { e.preventDefault(); menu(f); return true; }
      if (k === K.ENTER) {
        e.preventDefault();
        if (!e.repeat && holdTimer === null && !held) {
          holdCard = f;
          holdTimer = setTimeout(() => { holdTimer = null; held = true; if (root && holdCard === active()) menu(holdCard); }, LONG_PRESS_MS);
        }
        return true;
      }
      return false;
    },
    unmount() {
      if (root && screen) remember();
      token++;
      cancelTour(); coach.dismiss();
      clearTimeout(timer); clearTimeout(holdTimer);
      for (const [el, ev, fn] of listeners) el.removeEventListener(ev, fn);
      listeners.length = 0;
      root = screen = bar = box = chipRow = statusEl = slots = null;
      hits = [[], [], []];
    },
  };
}
