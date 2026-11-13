// Home (HomeActivity.java + Cards.shelf/card): one vertical scroller holding the top bar, the
// rows kept on the TV (Continue Watching, Recent Channels, favourites) and the rows that need the
// library or the internet (Netflix UK Top 10, Recently Added). Row data and card routing live in
// js/home-rows.js; Top 10 in js/top10.js.
import * as store from '../store.js';
import * as repo from '../repo.js';
import * as nav from '../nav.js';
import * as top10 from '../top10.js';
import { router } from '../router.js';
import { MOVIE, SERIES, EPISODE, key } from '../item.js';
import {
  localRows, remoteRows, recentlyAdded, cwCard, sig, liveSiblings, openTarget, favToast, removeName,
  LANDSCAPE, POSTER, CW_HINT, FIRST_RUN, WELCOME,
} from '../home-rows.js';
import { mountSection, tabFocused } from '../ui/topbar.js';
import { shelfTitle, initials } from '../ui/widgets.js';
import { LONG_PRESS_MS } from '../ui/theme.js';
import { showDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import * as coach from '../ui/coach.js';
import { bringIntoView } from '../ui/scroll.js';

export { deltaToShow } from '../ui/scroll.js';

export { FIRST_RUN, WELCOME };

const KEY_ENTER = 13;
const KEY_MENU = 10133;
export const TOP10_EVERY = 60 * 60000; // HomeActivity.TOP10_EVERY
export const COACH_DELAY_MS = 1500;

// ------------------------------------------------------------ state kept between visits
// Android keeps HomeActivity alive under the screens it opens, with its loaded rows and focus.
// The router remounts Home instead, so that state lives here, per account.

const fresh = (acct) => ({
  acct, newMovies: null, newSeries: null, topMovies: null, topSeries: null, topSig: '',
  loadingNew: false, focus: null, scrollTop: 0,
});
let memo = fresh('');
const accountKey = () => { const a = store.current(); return a ? `${a.id}|${a.server}|${a.user}` : ''; };
function memoNow() {
  const k = accountKey();
  if (memo.acct !== k) memo = fresh(k);
  return memo;
}
let mounted = null; // the Home on screen (or null)

/** Tests: forget everything kept between visits. */
export function _reset() { memo = fresh(''); mounted = null; }
export const _memo = () => memo;

/** HomeActivity.loadNewArrivals: movies, then series; each fills its row when ready. */
async function loadNewArrivals() {
  const m = memoNow();
  m.loadingNew = true;
  let r = null;
  try { r = await recentlyAdded(MOVIE); } catch { r = null; }
  if (m !== memo) return;
  if (r) m.newMovies = r;
  if (mounted) mounted.remoteChanged(false);
  let r2 = null;
  try { r2 = await recentlyAdded(SERIES); } catch { r2 = null; }
  m.loadingNew = false;
  if (m !== memo) return;
  if (r2) m.newSeries = r2;
  if (mounted) mounted.remoteChanged(true);
}

/** HomeActivity.loadTop10: Netflix UK Top 10 matched to this library; rows rebuild only if it changed. */
async function loadTop10() {
  const m = memoNow();
  const r = await top10.enqueue(async () => {
    const d = await top10.refresh();
    if (!d) return null;
    let movies = repo.cached(MOVIE); let series = repo.cached(SERIES);
    if (!movies && repo.hasLibrary()) movies = await repo.streams(MOVIE).catch(() => null);
    if (!series && repo.hasLibrary()) series = await repo.streams(SERIES).catch(() => null);
    return [await top10.matchAsync(d.films, movies), await top10.matchAsync(d.tv, series)];
  }).catch(() => null);
  if (!r || m !== memo) return;
  const s = `${sig(r[0])}|${sig(r[1])}`;
  if (s === m.topSig) return;
  m.topSig = s;
  [m.topMovies, m.topSeries] = r;
  if (mounted) mounted.remoteChanged(true);
}

// ------------------------------------------------------------ cards

/** Cards.card + Cards.shelf's per-item extras (progress, "… left", series art for episodes). */
export function renderCard(row, it, i) {
  const shape = row.shape;
  let image = it.icon || null; let sub = null; let progress = 0;
  if (shape === LANDSCAPE) ({ image, sub, progress } = cwCard(it));
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `card ${shape}`;
  b.dataset.tile = String(i); b.dataset.row = row.key; b.dataset.item = it.id; b.dataset.key = key(it);
  if (image) b.dataset.art = image;
  const art = document.createElement('span');
  art.className = 'art';
  if (image) {
    const img = document.createElement('img');
    img.src = image; img.alt = ''; img.decoding = 'async';
    art.appendChild(img);
  } else if (shape !== POSTER) {
    const ph = document.createElement('span');
    ph.className = 'initials'; ph.textContent = initials(it.name);
    art.appendChild(ph);
  }
  if (progress > 0) {
    const bar = document.createElement('span');
    bar.className = 'progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(2, Math.min(100, progress * 100))}%`;
    bar.appendChild(fill);
    art.appendChild(bar);
  }
  const title = document.createElement('span');
  title.className = 'title'; title.textContent = it.name || '';
  b.append(art, title);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'sub'; s.textContent = sub;
    b.appendChild(s);
  }
  return b;
}

/** Cards.shelf: title (+ hint on Continue Watching), then a horizontal strip of cards. */
function renderShelf(row) {
  const sec = document.createElement('section');
  sec.className = 'home-row';
  sec.dataset.row = row.key; sec.dataset.title = row.title;
  const strip = document.createElement('div');
  strip.className = 'strip';
  row.items.forEach((it, i) => strip.appendChild(renderCard(row, it, i)));
  sec.append(shelfTitle(row.title, row.key === 'continue' ? CW_HINT : ''), strip);
  sec._row = row;
  return sec;
}

// ------------------------------------------------------------ the view

export function homeView() {
  let root; let screen; let bar; let localEl; let remoteEl; let emptyEl;
  let firstRun = false; let timers = []; let tick = null; let cancelTour = () => {};
  let holdTimer = null; let held = false; let holdCard = null;
  let onKeyUp; let onClick; let onFocusIn; let onVisibility;

  const active = () => document.activeElement;
  const noFocus = () => !active() || active() === document.body || !active().isConnected;
  const cards = (sec) => [...sec.querySelectorAll('.card')];
  const shelves = () => [...localEl.children, ...remoteEl.children];

  function focusCard(card, smooth = false) {
    if (!card) return;
    card.focus({ preventScroll: true });
    reveal(card, smooth);
  }

  function reveal(el, smooth = true) {
    if (!el || !screen) return;
    if (el.classList.contains('card')) bringIntoView(el, el.parentElement, false, smooth);
    bringIntoView(el, screen, true, smooth);
  }

  /** HomeActivity.focusFirstCard. With no cards at all, the window's first focusable is the Home tab. */
  function focusFirstCard() {
    const first = localEl.querySelector('.card') || remoteEl.querySelector('.card');
    if (first) { focusCard(first); return; }
    if (noFocus()) bar.el.querySelector('[data-current]')?.focus({ preventScroll: true });
  }

  function updateEmpty() {
    const none = !localEl.children.length && !remoteEl.children.length;
    emptyEl.textContent = none ? (firstRun ? FIRST_RUN : WELCOME) : '';
    emptyEl.hidden = !none;
  }

  function buildLocal() {
    localEl.replaceChildren(...localRows().map(renderShelf));
    updateEmpty();
  }

  function buildRemote() {
    remoteEl.replaceChildren(...remoteRows(memo).map(renderShelf));
    updateEmpty();
  }

  /** A remote list changed: rebuild those rows; focus goes back to the first card if it was in them. */
  function remoteChanged(checkInside) {
    if (!root) return;
    const inRemote = checkInside && remoteEl.contains(active());
    buildRemote();
    if (inRemote || noFocus()) focusFirstCard();
  }

  /** HomeActivity.refreshKeepingPlace: rebuild the local rows, keep focus on the same shelf and card. */
  function refreshKeepingPlace(card) {
    let shelfTitleText = null; let shelfIndex = -1; let cardIndex = 0;
    const sec = card && card.closest('.home-row');
    if (sec) {
      cardIndex = Number(card.dataset.tile) || 0;
      if (sec.parentElement === localEl) {
        shelfIndex = [...localEl.children].indexOf(sec);
        shelfTitleText = sec.dataset.title;
      }
    }
    buildLocal();
    if (shelfIndex < 0) { if (!noFocus()) reveal(active(), false); return; }
    let target = [...localEl.children].find((s) => s.dataset.title === shelfTitleText) || null;
    if (!target && localEl.children.length) {
      target = localEl.children[Math.min(shelfIndex, localEl.children.length - 1)];
      cardIndex = 0;
    }
    if (!target) { focusFirstCard(); return; }
    const list = cards(target);
    if (!list.length) return;
    focusCard(list[Math.min(cardIndex, list.length - 1)]);
  }

  const itemOf = (card) => {
    const sec = card.closest('.home-row');
    return sec && sec._row ? { row: sec._row, it: sec._row.items[Number(card.dataset.tile)] } : null;
  };

  /** HomeActivity.pick -> Open.item. */
  function pick(card) {
    const x = itemOf(card);
    if (!x || !x.it) return;
    const t = openTarget(x.it, x.it.type === 'live' ? liveSiblings(x.it) : null);
    router.go(t.name, t.params);
  }

  /** Hold OK / ☰: Continue Watching asks to remove; any other row toggles the favourite. */
  function menu(card) {
    const x = itemOf(card);
    if (!x || !x.it) return;
    const { row, it } = x;
    if (row.key === 'continue') {
      card.classList.add('keep-focus'); // the dialog has focus; the card still looks focused beneath it
      showDialog({
        title: 'Remove from Continue Watching?', message: removeName(it),
        positive: 'Remove', negative: 'Cancel', focus: 'negative', // a stray OK won't remove anything
      }).result.then((v) => {
        card.classList.remove('keep-focus');
        if (v !== 'positive' || !root) return;
        store.setPosition(it, 0); // no resume point = off the list
        refreshKeepingPlace(card.isConnected ? card : active());
      });
      return;
    }
    if (it.type === EPISODE) return;
    const now = store.toggleFav(it);
    toast(favToast(now, it));
    refreshKeepingPlace(card);
  }

  /** HomeActivity.homeTour (Settings → Show Tutorial runs it again). */
  function homeTour() {
    cancelTour = coach.show('home', [
      { target: bar.el, title: 'Getting around',
        body: 'Move along the top bar to switch between Home, Live TV, Movies, Series, Search and Settings. Just pause on one and it opens.' },
      { target: () => localEl.firstElementChild || remoteEl.firstElementChild, title: 'Your Home screen',
        body: 'Continue Watching, Recent Channels, your favourites and the UK Top 10 all live here. '
          + 'Hold OK on a card to favourite it, or to remove it from Continue Watching.' },
      { target: null, title: 'Make it yours',
        body: 'In Settings you can choose which rows Home shows, hide countries and categories you never watch, '
          + 'change subtitle style and switch accounts. You can watch this tour again from Settings too.' },
    ], () => !!root);
  }

  /** HomeActivity.startLibrary: the saved library (instant), refreshed in the background when due. */
  function startLibrary() {
    if (repo.isRefreshing()) { loadNewArrivals(); return; } // Setup is still finishing Movies & Series
    if (repo.isDue() && !repo.hasLibrary()) {
      // First run for this account: download everything once, then fill the rows.
      if (!localEl.children.length) { firstRun = true; updateEmpty(); }
      repo.refreshAll().catch(() => {}).then(() => {
        firstRun = false;
        if (root) updateEmpty();
        loadNewArrivals();
      });
    } else {
      loadNewArrivals();
      repo.preload();
      repo.refreshIfDue(() => loadNewArrivals());
    }
  }

  /** onStart: Top 10 now (cheap when not due), then hourly while Home is on screen. */
  function startTop10() {
    clearInterval(tick);
    loadTop10();
    tick = setInterval(loadTop10, TOP10_EVERY);
  }

  /** Where focus was, so coming back lands as HomeActivity.onResume / TopBar.onHomeResumed do. */
  function rememberFocus() {
    const f = active();
    if (!f || !screen || !screen.contains(f)) { memo.focus = null; return; }
    if (bar.el.contains(f)) { memo.focus = { where: 'bar' }; return; }
    const sec = f.closest('.home-row');
    memo.focus = sec ? {
      where: localEl.contains(sec) ? 'local' : 'remote', title: sec.dataset.title, index: Number(f.dataset.tile) || 0,
    } : null;
  }

  function restoreFocus(saved) {
    if (tabFocused()) return; // came by hover: the tab keeps it
    if (!saved || saved.where === 'local') { focusFirstCard(); return; }
    if (saved.where === 'bar') { bar.el.querySelector('[data-current]')?.focus({ preventScroll: true }); return; }
    const sec = [...remoteEl.children].find((s) => s.dataset.title === saved.title);
    const list = sec ? cards(sec) : [];
    if (list.length) focusCard(list[Math.min(saved.index, list.length - 1)]);
    else focusFirstCard();
  }

  return {
    async mount(rootEl) {
      // Back/backTo remount the entry that is already on top; go/replace/resetTo create a new Home.
      const resumed = router.current()?.name === 'home';
      if (!resumed) memo = fresh(accountKey());
      else memoNow();
      root = rootEl;
      mounted = { remoteChanged };
      const sec = mountSection(root, 'home');
      bar = sec.bar; screen = sec.el;
      screen.dataset.ownScroll = '';
      const body = document.createElement('div');
      body.className = 'home';
      localEl = document.createElement('div'); localEl.className = 'home-local';
      remoteEl = document.createElement('div'); remoteEl.className = 'home-remote';
      emptyEl = document.createElement('p'); emptyEl.className = 'home-empty'; emptyEl.hidden = true;
      body.append(localEl, remoteEl, emptyEl);
      sec.page.appendChild(body);

      onFocusIn = (e) => reveal(e.target, true);
      screen.addEventListener('focusin', onFocusIn);
      onClick = (e) => {
        const card = e.target.closest && e.target.closest('.card');
        if (card && localEl.contains(card) || card && remoteEl.contains(card)) pick(card);
      };
      body.addEventListener('click', onClick);
      onKeyUp = (e) => {
        if (e.keyCode !== KEY_ENTER) return;
        const wasHold = held; const pending = holdTimer !== null; const card = holdCard;
        clearTimeout(holdTimer); holdTimer = null; held = false; holdCard = null;
        if (pending && !wasHold && root && card && card === active()) pick(card);
      };
      document.addEventListener('keyup', onKeyUp);
      onVisibility = () => {
        if (document.hidden) { clearInterval(tick); tick = null; } else if (root && !tick) startTop10();
      };
      document.addEventListener('visibilitychange', onVisibility);
      nav.register(root);

      repo.setOnUpdated(() => { loadNewArrivals(); loadTop10(); }); // Movies/Series replaced in the background

      buildLocal();
      if (resumed) {
        buildRemote();
        const saved = memo.focus;
        screen.scrollTop = memo.scrollTop;
        restoreFocus(saved);
        if ((!memo.newMovies || !memo.newSeries) && !memo.loadingNew) loadNewArrivals();
      } else {
        buildRemote();
        startLibrary();
        if (!tabFocused()) focusFirstCard();
        timers.push(setTimeout(() => { if (root) coach.offer(homeTour); }, COACH_DELAY_MS));
      }
      startTop10();
    },
    onKey(e) {
      const f = active();
      const onCard = root && f && f.classList && f.classList.contains('card') && root.contains(f);
      if (!onCard) return false;
      if (e.keyCode === KEY_MENU) { e.preventDefault(); menu(f); return true; }
      if (e.keyCode === KEY_ENTER) {
        // OK is decided on release: a short press opens, a hold (LONG_PRESS_MS) is the menu.
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
      if (screen) { rememberFocus(); memo.scrollTop = screen.scrollTop; }
      mounted = null;
      cancelTour(); coach.dismiss();
      timers.forEach(clearTimeout); timers = [];
      clearInterval(tick); tick = null;
      clearTimeout(holdTimer); holdTimer = null; held = false; holdCard = null;
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibility);
      if (screen) screen.removeEventListener('focusin', onFocusIn);
      root = screen = bar = localEl = remoteEl = emptyEl = null;
    },
  };
}
