// Home: the shared top bar (Home tab current), then shelves of cards (see js/home-rows.js).
// Phase 1 hosts the bar, Android card shapes and focus styles; row content is rebuilt in a later phase.
import * as store from '../store.js';
import { router } from '../router.js';
import * as nav from '../nav.js';
import { buildRows } from '../home-rows.js';
import * as repo from '../repo.js';
import { mountSection, tabFocused } from '../ui/topbar.js';
import { shelfTitle, initials } from '../ui/widgets.js';
import { HOLD_OK } from '../ui/theme.js';

/** Card shape per row (HomeActivity.java:276-283). */
export function shapeFor(rowKey) {
  if (rowKey === 'continue') return 'landscape';
  if (rowKey === 'recent' || rowKey === 'fav_live') return 'channel';
  return 'poster';
}

/** Where selecting a tile goes. */
export function openTarget(rowKey, items, index) {
  const item = items[index];
  if (item.type === 'live') { router.go('player-live', { channels: items, index }); return; }
  if (item.type === 'series') { router.go('series-detail', { item }); return; }
  if (rowKey === 'continue') { router.go('player-vod', { item, startMs: store.position(item) }); return; }
  router.go('movie-detail', { item });
}

/** One Cards.card(): rounded art (+ ring on focus), title, optional progress. */
export function renderCard(rowKey, it, i) {
  const shape = shapeFor(rowKey);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `card ${shape}`;
  b.dataset.tile = i; b.dataset.row = rowKey; b.dataset.item = it.id;
  const icon = it.icon || it.parentIcon;
  if (icon) b.dataset.art = icon;
  const art = document.createElement('span');
  art.className = 'art';
  if (icon) {
    const img = document.createElement('img');
    img.src = icon; img.alt = ''; img.loading = 'lazy';
    art.appendChild(img);
  } else if (shape !== 'poster') {
    const ph = document.createElement('span');
    ph.className = 'initials'; ph.textContent = initials(it.name);
    art.appendChild(ph);
  }
  if (shape === 'landscape') {
    const pos = store.position(it); const dur = store.duration(it);
    if (pos > 0 && dur > 0) {
      const bar = document.createElement('span');
      bar.className = 'progress';
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(2, Math.min(100, (pos / dur) * 100))}%`;
      bar.appendChild(fill);
      art.appendChild(bar);
    }
  }
  const title = document.createElement('span');
  title.className = 'title'; title.textContent = it.name || '';
  b.append(art, title);
  return b;
}

export const FIRST_RUN = 'Getting your channels, movies and series ready…\nThis only takes a while the first time.';

export function homeView() {
  let root; let body; let onClick; let onActivate; let rows = []; let seq = 0;

  /** Rebuilds the shelves, keeping focus on the same card when it is still there. */
  function render(built) {
    const f = document.activeElement;
    const had = f && body.contains(f) && f.dataset ? { row: f.dataset.row, tile: f.dataset.tile } : null;
    rows = built;
    body.replaceChildren();
    for (const r of rows) {
      const sec = document.createElement('section');
      sec.className = 'home-row'; sec.dataset.row = r.key;
      const strip = document.createElement('div'); strip.className = 'strip';
      r.items.forEach((it, i) => strip.appendChild(renderCard(r.key, it, i)));
      sec.append(shelfTitle(r.title, r.key === 'continue' ? `${HOLD_OK} to remove from list` : ''), strip);
      body.appendChild(sec);
    }
    const again = had && (body.querySelector(`[data-row="${had.row}"][data-tile="${had.tile}"]`)
      || body.querySelector(`[data-row="${had.row}"][data-tile]`));
    if (again) again.focus({ preventScroll: true });
    // HomeActivity: focus starts on the first card, unless the Home tab kept it (arrived by hover).
    else if (!tabFocused() && !root.contains(document.activeElement)) body.querySelector('.card')?.focus({ preventScroll: true });
  }

  function showEmpty(text) {
    const p = document.createElement('p');
    p.className = 'home-empty';
    p.textContent = text;
    body.replaceChildren(p);
  }

  async function load(opts) {
    const mine = ++seq;
    const built = await buildRows(opts);
    if (!root || mine !== seq) return built;
    render(built);
    return built;
  }

  /** HomeActivity.startLibrary: the saved library (instant), refreshed in the background when due. */
  async function startLibrary() {
    repo.setOnUpdated(() => { if (root) load(); }); // a section was replaced: reload the rows
    if (repo.isRefreshing()) { await load(); return; } // Setup is still finishing Movies & Series
    if (repo.isDue() && !repo.hasLibrary()) {
      // First run for this account: download everything once, then fill the rows.
      const local = await load({ library: false });
      if (root && !local.length) showEmpty(FIRST_RUN);
      await repo.refreshAll().catch(() => {});
      if (root) await load();
      return;
    }
    await load();
    repo.preload();
    repo.refreshIfDue(() => { if (root) load(); });
  }

  return {
    async mount(rootEl) {
      root = rootEl;
      const { page } = mountSection(root, 'home');
      body = document.createElement('div');
      body.className = 'home';
      page.appendChild(body);

      onClick = (e) => {
        const t = e.target.closest('[data-tile]');
        if (!t) return;
        const row = rows.find((r) => r.key === t.dataset.row);
        if (row) openTarget(row.key, row.items, Number(t.dataset.tile));
      };
      body.addEventListener('click', onClick);
      onActivate = (e) => { e.target.closest('button')?.click(); };
      body.addEventListener('activate', onActivate);
      nav.register(root);

      await startLibrary();
    },
    unmount() {
      repo.setOnUpdated(null);
      seq++;
      root = body = null; rows = []; onClick = onActivate = null;
    },
  };
}
