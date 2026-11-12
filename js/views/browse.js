// BrowseActivity: categories on the left, content on the right — a channel list with the Now/Next
// info panel and the live preview for Live TV, a poster grid for Movies and Series.
//
// Keys (BrowseActivity.dispatchKeyEvent / onKeyDown / onBackPressed, Samsung = no ☰ key):
//   categories  ▲▼ move (a category opens 350 ms after you stop), ▶ / OK open it and go to its
//               first item (Search: the box), Hold OK = Favourite / Hide dialog, Menu = Hide,
//               ▲ on the top row = the current tab, Back = Home
//   content     ▲▼◀▶ move, ◀ from the first column = back to the categories (on the open one),
//               OK opens / plays, Hold OK or Menu = favourite, Back = categories,
//               Live: ▶ = the TV guide (Phase 5 hook)
//   search box  ▼ = results, Enter / IME Done = search now and go to the first result,
//               Back = categories
import * as api from '../api.js';
import * as store from '../store.js';
import * as filters from '../filters.js';
import * as nav from '../nav.js';
import * as coach from '../ui/coach.js';
import * as B from '../browse.js';
import * as match from '../match.js';
import { router } from '../router.js';
import { LIVE, MOVIE } from '../item.js';
import { openTarget, favToast } from '../home-rows.js';
import { mountSection, tabFocused } from '../ui/topbar.js';
import { createGlider } from '../ui/glider.js';
import { createVList } from '../ui/vlist.js';
import { showDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { rowCell, pillInput } from '../ui/widgets.js';
import { u, LONG_PRESS_MS } from '../ui/theme.js';
import { createPreview } from '../live-preview.js';

const K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, MENU: 10133, IME_DONE: 65376, IME_CANCEL: 65385 };
const DIRS = { [K.LEFT]: 'left', [K.UP]: 'up', [K.RIGHT]: 'right', [K.DOWN]: 'down' };

// Geometry (Adapters.RowCell / PosterCell, BrowseActivity) in px.
export const CAT_ROW_H = u(14 * 2) + u(19) * 1.15;   // padding + one line of 19u text
export const CHANNEL_ROW_H = u(14 * 2 + 44);          // padding + the 44u logo box
export const ROW_GAP = u(2);                          // ListView divider
export const POSTER_COL_W = u(178);
export const POSTER_CELL_H = u(12 + 225 + 10 + 12) + 2 * u(15) * 1.15; // image + two title lines
export const POSTER_GAP = u(10);
const SLIDE = u(56);

export function browseView(type) {
  const live = type === LIVE;
  const section = live ? 'live' : type === MOVIE ? 'movies' : 'series';

  return function create() {
    let root = null; let params; let st; let bar; let screen;
    let catsBox; let catScroller; let catHint; let mid; let searchBox; let frame; let contentScroller;
    let emptyEl; let spinner; let info = null; let preview = null;
    let catList; let content; let catGlider; let contentGlider = null;
    let cats = []; let items = []; let favSet = new Set();
    let currentCat = null; let activeIdx = -1; let picked = false; let hideActive = true; let slideDir = 1;
    let loadToken = 0; let searchToken = 0; let searchResults = [];
    let pendingCat = null; let pendingEpg = null; let pendingSearch = null; let tourTimer = null; let cancelTour = null;
    let hold = null; // { zone, timer, held }
    let zoneNow = null;
    const off = [];

    const alive = () => root !== null;
    const listen = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); off.push(() => target.removeEventListener(ev, fn, opt)); };

    function zoneOf(el) {
      if (!el || !screen || !screen.contains(el)) return null;
      if (catScroller.contains(el)) return 'cats';
      if (el === searchBox) return 'search';
      if (contentScroller.contains(el)) return 'content';
      if (el.closest('[data-topbar]') || el.closest('.topbar')) return 'bar';
      return null;
    }
    const zone = () => zoneOf(document.activeElement);

    // ------------------------------------------------------------ cells

    function catCell(i, el) {
      const c = cats[i];
      const on = !hideActive && i === activeIdx;
      if (el && el.dataset.cat === c.id) { el.classList.toggle('active', on); return el; }
      const b = rowCell({ title: c.name, trail: c.num || '' });
      b.classList.add('cat');
      b.classList.toggle('active', on);
      b.dataset.cat = c.id;
      b.tabIndex = -1;
      return b;
    }

    function channelCell(i, el) {
      const it = items[i];
      const trail = favSet.has(it.id) ? '♥' : '';
      if (el && el.dataset.id === it.id) {
        let t = el.querySelector('.rc-trail');
        if (trail && !t) { t = document.createElement('span'); t.className = 'rc-trail'; el.appendChild(t); }
        if (t) { t.textContent = trail; t.hidden = !trail; }
        return el;
      }
      const b = rowCell({ num: it.num == null || it.num === '' ? String(i + 1) : String(it.num), logo: it.icon || '', title: it.name || '', trail });
      b.classList.add('channel');
      b.dataset.id = it.id;
      b.tabIndex = -1;
      if (it.icon) b.dataset.art = it.icon;
      const img = b.querySelector('img');
      if (img) img.onerror = () => img.remove();
      return b;
    }

    function posterCell(i, el) {
      const it = items[i];
      const title = favSet.has(it.id) ? `♥ ${it.name || ''}` : (it.name || '');
      if (el && el.dataset.id === it.id) { el.querySelector('.title').textContent = title; return el; }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'poster-cell'; b.tabIndex = -1;
      b.dataset.id = it.id;
      if (it.icon) b.dataset.art = it.icon;
      const art = document.createElement('span'); art.className = 'art';
      if (it.icon) {
        const img = document.createElement('img'); img.src = it.icon; img.alt = '';
        img.onerror = () => img.remove();
        art.appendChild(img);
      }
      const name = document.createElement('span'); name.className = 'title'; name.textContent = title;
      b.append(art, name);
      return b;
    }

    // ------------------------------------------------------------ DOM

    function build(page) {
      const el = document.createElement('div');
      el.className = `browse browse-${live ? 'live' : 'vod'}`;
      el.dataset.mode = 'list';

      catsBox = document.createElement('div'); catsBox.className = 'b-cats';
      catScroller = document.createElement('div'); catScroller.className = 'b-catlist';
      catHint = document.createElement('div'); catHint.className = 'b-cathint'; catHint.textContent = B.CAT_HINT;
      catsBox.append(catScroller, catHint);

      mid = document.createElement('div'); mid.className = 'b-mid';
      searchBox = pillInput(B.searchHint(type), 'text');
      searchBox.className += ' b-search';
      searchBox.enterKeyHint = 'search';
      searchBox.hidden = true;
      frame = document.createElement('div'); frame.className = 'b-frame';
      contentScroller = document.createElement('div'); contentScroller.className = live ? 'b-channels' : 'b-grid';
      emptyEl = document.createElement('div'); emptyEl.className = 'b-empty';
      spinner = document.createElement('div'); spinner.className = 'b-spinner'; spinner.hidden = true;
      frame.append(contentScroller, emptyEl, spinner);
      mid.append(searchBox, frame);
      el.append(catsBox, mid);
      if (live) {
        el.appendChild(buildInfo());
        // ▶ TV GUIDE — PHASE 5 HOOK: the EPG grid (EpgGrid.java) mounts here, and enterGuide()
        // below switches data-mode to "guide" (categories fold away, the info panel becomes the
        // 38 % strip, the grid lines up with the channel list).
        const guide = document.createElement('div');
        guide.className = 'b-guide'; guide.hidden = true; guide.dataset.phase5 = 'tv-guide';
        el.appendChild(guide);
      }
      page.appendChild(el);

      catList = createVList({
        scroller: catScroller, pitch: CAT_ROW_H + ROW_GAP, cellHeight: CAT_ROW_H, padTop: u(8), padBottom: u(8),
        render: catCell, onSelect: onCatSelected,
      });
      catGlider = createGlider(catList.body, { rows: '.row-cell' });
      if (live) {
        content = createVList({
          scroller: contentScroller, pitch: CHANNEL_ROW_H + ROW_GAP, cellHeight: CHANNEL_ROW_H,
          render: channelCell, onSelect: onContentSelected,
        });
        contentGlider = createGlider(content.body, { rows: '.row-cell' });
      } else {
        content = createVList({
          scroller: contentScroller, pitch: POSTER_CELL_H + POSTER_GAP, cellHeight: POSTER_CELL_H, colWidth: POSTER_COL_W,
          padTop: u(10), padBottom: u(30), render: posterCell, onSelect: onContentSelected,
          viewportWidth: 1920 - u(2 * 48 + 300 + 36), // only if the page has no layout yet
        });
      }
      return el;
    }

    function buildInfo() {
      const p = document.createElement('div');
      p.className = 'b-info';
      p.innerHTML = '<div class="b-info-bg"></div>'
        + '<div class="b-preview"><div class="b-logo"><img alt="" hidden></div></div>'
        + '<div class="b-text">'
        + '<div class="b-name"></div>'
        + '<div class="b-label">NOW</div><div class="b-now"></div>'
        + '<div class="b-time-row"><span class="b-time"></span><span class="b-progress"></span></div>'
        + '<div class="b-desc"></div>'
        + '<div class="b-label">UP NEXT</div><div class="b-next"></div>'
        + '<div class="b-spacer"></div>'
        + `<div class="b-hint">${B.PANEL_HINT}</div>`
        + '</div>';
      const q = (s) => p.querySelector(s);
      info = {
        el: p, bg: q('.b-info-bg'), box: q('.b-preview'), logo: q('.b-logo'), img: q('.b-logo img'),
        name: q('.b-name'), now: q('.b-now'), time: q('.b-time'), progress: q('.b-progress'),
        desc: q('.b-desc'), next: q('.b-next'), hint: q('.b-hint'),
      };
      info.img.onerror = () => { info.img.hidden = true; };
      preview = createPreview({
        box: info.box, logo: info.logo, radius: u(16),
        holes: () => [document.getElementById('backdrop'), info && info.bg],
      });
      return p;
    }

    // ------------------------------------------------------------ categories

    function paintActive() { if (catList) catList.refresh(); }

    function setHideActive(h) {
      if (h === hideActive) return;
      hideActive = h;
      paintActive();
    }

    function markPicked() {
      if (picked) return;
      picked = true;
      setHideActive(tabFocused());
    }

    function onCatSelected() {
      clearTimeout(pendingCat);
      pendingCat = setTimeout(openSelectedCategory, B.DWELL_MS);
    }

    function openSelectedCategory() {
      pendingCat = null;
      const pos = catList.selected;
      const c = cats[pos];
      if (!c || c.id === B.SEARCH) return; // landing on Search does nothing until OK
      markPicked(); // pausing on a category opens it, and from then on it's marked
      if (currentCat && c.id === currentCat.id) { paintActive(); return; }
      openCategory(c, pos, false);
    }

    function focusTopCategory() {
      if (!cats.length) return;
      clearTimeout(pendingCat); pendingCat = null;
      catList.select(0, { focus: true, scroll: 'top', silent: true });
    }

    /** ◀ / Back from the content: the open category, exactly where it sits on screen. */
    function backToCategories() {
      const a = activeIdx;
      if (a >= 0 && a < cats.length) {
        const scroll = catList.isVisible(a) ? catList.offsetOf(a) : u(8);
        catList.select(a, { focus: true, scroll, silent: true });
      } else catList.focus();
    }

    /** ▶ on a category: open it and go to its first item (Search: into the box). */
    function rightFromCats() {
      const pos = catList.selected;
      const c = cats[pos];
      if (!c) return;
      clearTimeout(pendingCat); pendingCat = null;
      markPicked();
      if (!currentCat || c.id !== currentCat.id || c.id === B.SEARCH) openCategory(c, pos, true);
      else if (content.count) content.select(0, { focus: true, scroll: 'top' });
    }

    function categoryMenu(pos) {
      const c = cats[pos];
      if (!c || B.isPseudo(c.id)) return; // the special entries can't be favourited or hidden
      const fav = store.isFavCategory(type, c.id);
      catGlider.freeze(true);
      showDialog({ title: c.name, items: B.categoryMenuItems(fav) }).result.then((which) => {
        if (!alive()) return;
        catGlider.freeze(false);
        if (which === 0) toggleFavCategory(pos);
        else if (which === 1) hideCategory(c);
        else catList.focus();
      });
    }

    function toggleFavCategory(pos) {
      const c = cats[pos];
      if (!c || B.isPseudo(c.id)) return;
      const now = store.toggleFavCategory(type, c.id);
      toast(B.favCategoryToast(now, c.name));
      const activeId = currentCat ? currentCat.id : null;
      setCats(B.buildCategoryList(type, rawCats));
      let sel = 0;
      cats.forEach((x, i) => { if (x.id === c.id) sel = i; if (activeId !== null && x.id === activeId) activeIdx = i; });
      catList.setCount(cats.length, true);
      catList.select(sel, { focus: true, silent: true });
    }

    function hideCategory(c) {
      filters.setCategoryHidden(type, c.id, true);
      if (store.isFavCategory(type, c.id)) store.toggleFavCategory(type, c.id);
      toast(B.hiddenToast(c.name));
      const wasOpen = !!currentCat && currentCat.id === c.id;
      reloadCategories(wasOpen);
    }

    let rawCats = [];
    function setCats(list) { cats = list; }

    /** Re-applies hidden categories / countries (BrowseActivity.reloadCategories). */
    async function reloadCategories(openAll) {
      const activeId = currentCat ? currentCat.id : null;
      const sel = Math.max(0, catList.selected);
      try { rawCats = await B.visibleCategories(type); } catch { /* keep the last list */ }
      if (!alive()) return;
      setCats(B.buildCategoryList(type, rawCats));
      activeIdx = cats.findIndex((x) => activeId !== null && x.id === activeId);
      catList.setCount(cats.length, true);
      catList.select(Math.min(sel, cats.length - 1), { focus: true, silent: true });
      if (openAll || activeIdx < 0) openCategory(cats[3], 3, false); // "All"
      else if (activeId === B.ALL || activeId === B.SEARCH) openCategory(cats[activeIdx], activeIdx, false);
      paintActive();
    }

    // ------------------------------------------------------------ content

    function setSpinner(on) { spinner.hidden = !on; }

    /**
     * BrowseActivity.openCategory. Resolves once the list is on screen.
     * @param o.noAnim  no slide (coming back to the screen)
     */
    function openCategory(cat, pos, focusContent, o = {}) {
      if (activeIdx >= 0 && pos !== activeIdx) slideDir = pos > activeIdx ? 1 : -1;
      currentCat = cat;
      activeIdx = pos;
      paintActive();
      const token = ++loadToken;
      const searching = cat.id === B.SEARCH;
      searchBox.hidden = !searching;
      if (!searching && document.activeElement === searchBox) searchBox.blur();
      content.relayout();
      if (searching) {
        show(searchResults, false, o);
        if (focusContent) openKeyboard(); // OK or ▶ on "Search": straight into the box
        return Promise.resolve();
      }
      if (B.isSpecial(cat.id)) {
        show(B.specialList(cat.id, type), focusContent, o);
        return Promise.resolve();
      }
      setItems([]);
      emptyEl.textContent = '';
      setSpinner(true);
      if (live) showChannelInfo(-1);
      return B.categoryItems(type, cat.id).then((list) => {
        if (!alive() || token !== loadToken) return;
        show(list || [], focusContent, o);
      }, (e) => {
        if (!alive() || token !== loadToken) return;
        setSpinner(false);
        setItems([]);
        emptyEl.textContent = B.loadError(api.errorMessage(e));
      });
    }

    function setItems(list, keep = false) {
      items = list;
      favSet = store.favIds(type);
      content.setCount(list.length, keep);
    }

    function slideIn() {
      const d = slideDir * SLIDE;
      const s = contentScroller.style;
      s.transition = 'none'; s.opacity = '0'; s.transform = `translateY(${d}px)`;
      void contentScroller.offsetWidth;
      s.transition = 'opacity 380ms var(--ease-out), transform 380ms var(--ease-out)';
      s.opacity = '1'; s.transform = 'none';
    }

    function show(list, focusContent, o = {}) {
      setSpinner(false);
      setItems(list);
      if (!o.noAnim) slideIn();
      emptyEl.textContent = B.emptyText(type, currentCat && currentCat.id, list.length, searchBox.value);
      if (live) showChannelInfo(list.length ? 0 : -1);
      if (focusContent && list.length) content.select(0, { focus: true, scroll: 'top', silent: true });
    }

    function openItem(pos) {
      const it = items[pos];
      if (!it) return;
      saveState();
      const t = openTarget(it, items);
      router.go(t.name, t.params);
    }

    function toggleFav(pos) {
      const it = items[pos];
      if (!it) return;
      const now = store.toggleFav(it);
      toast(favToast(now, it));
      favSet = store.favIds(type);
      if (currentCat && currentCat.id === B.FAV) {
        const l = store.favs(type);
        items = l;
        content.setCount(l.length, true); // the selection stays where it was (or the new last one)
        if (live) showChannelInfo(l.length ? content.selected : -1);
      } else {
        content.refresh();
      }
    }

    function onContentSelected(pos) {
      if (live) showChannelInfo(pos);
    }

    // ------------------------------------------------------------ live info panel + preview

    function clearInfo() {
      info.now.textContent = ''; info.now.classList.remove('muted');
      info.time.textContent = ''; info.desc.textContent = ''; info.next.textContent = '';
      info.progress.replaceChildren();
    }

    function showChannelInfo(pos) {
      if (!info) return;
      clearTimeout(pendingEpg); pendingEpg = null;
      if (pos < 0 || pos >= items.length) {
        info.name.textContent = '';
        clearInfo();
        info.img.hidden = true; info.img.removeAttribute('src');
        preview.stop();
        return;
      }
      const it = items[pos];
      info.name.textContent = it.name || '';
      clearInfo();
      if (it.icon) { info.img.hidden = false; info.img.src = it.icon; } else { info.img.hidden = true; info.img.removeAttribute('src'); }
      if (preview.item !== it) {
        preview.stop();
        if (content.hasFocus()) schedulePreview();
      }
      pendingEpg = setTimeout(loadEpgForSelection, B.EPG_DELAY_MS);
    }

    function loadEpgForSelection() {
      pendingEpg = null;
      const it = items[Math.max(0, content.selected)];
      if (!it) return;
      api.epg(it.id).then((r) => {
        if (!alive() || items[Math.max(0, content.selected)] !== it) return;
        if (!r || !r.length) {
          info.now.textContent = 'No guide information';
          info.now.classList.add('muted');
          return;
        }
        const now = r[0];
        info.now.classList.remove('muted');
        info.now.textContent = now.title || '';
        info.time.textContent = now.timeRange();
        info.progress.replaceChildren();
        if (now.start > 0) {
          const fill = document.createElement('i');
          fill.style.width = `${Math.max(0.02, Math.min(1, now.progress())) * 100}%`;
          info.progress.appendChild(fill);
        }
        info.desc.textContent = now.desc || '';
        if (r.length > 1) {
          const next = r[1]; const t = next.timeRange();
          info.next.textContent = `${t ? `${t.slice(0, 5)}   ` : ''}${next.title || ''}`;
        }
      }, () => {});
    }

    function schedulePreview() {
      if (!live || !preview) return;
      preview.schedule(() => {
        if (!alive() || !content.hasFocus() || document.hidden) return null;
        return items[content.selected] || null;
      }, B.PREVIEW_DELAY_MS);
    }

    /** ▶ from the channel list — PHASE 5 HOOK: the TV guide. Until then ▶ stays put. */
    function enterGuide() {
      return false;
    }

    // ------------------------------------------------------------ search

    function openKeyboard() {
      searchBox.hidden = false;
      searchBox.focus();
    }

    function runSearch() {
      clearTimeout(pendingSearch); pendingSearch = null;
      const q = searchBox.value.trim();
      const t = ++searchToken;
      st.query = searchBox.value;
      if (match.query(q).usable) setSpinner(true);
      return B.search(type, q).catch(() => []).then((r) => {
        if (!alive() || t !== searchToken) return null;
        setSpinner(false);
        searchResults = r;
        if (currentCat && currentCat.id === B.SEARCH) show(r, false);
        return r;
      });
    }

    function submitSearch() {
      runSearch().then((r) => {
        if (!alive() || !r) return;
        // results: the keyboard goes and focus moves to the first one; none: stay in the box
        if (content.count) content.select(0, { focus: true, scroll: 'top', silent: true });
      });
    }

    // ------------------------------------------------------------ focus memory

    function saveState() {
      if (!st || !catList) return;
      st.catSel = catList.selected;
      st.catOffset = catList.offsetOf(catList.selected);
      st.activeId = currentCat ? currentCat.id : null;
      st.picked = picked;
      st.contentSel = content.selected;
      st.contentOffset = content.offsetOf(content.selected);
      st.zone = zone() || st.zone;
      st.query = searchBox.value;
      st.results = searchResults;
      st.saved = true;
    }

    // ------------------------------------------------------------ keys

    function onFocusIn() {
      const z = zone();
      if (z === null) return; // a dialog, or focus parked on the body while a list redraws
      const was = zoneNow;
      zoneNow = z;
      catHint.classList.toggle('on', z === 'cats');
      const tab = z === 'bar' && tabFocused();
      setHideActive(tab || !picked);
      if (tab && cats.length && catList.selected !== 0) { clearTimeout(pendingCat); pendingCat = null; catList.select(0, { scroll: 'top', silent: true }); }
      if (live && was !== z) {
        if (z === 'content') schedulePreview();
        else if (was === 'content') preview.stop(); // (Phase 5: not when going into the guide)
      }
    }

    function startHold(z) {
      if (hold) return;
      const h = { zone: z, held: false, timer: null };
      h.timer = setTimeout(() => {
        h.timer = null; h.held = true;
        if (z === 'cats') categoryMenu(catList.selected);
        else toggleFav(content.selected);
      }, LONG_PRESS_MS);
      hold = h;
    }

    function onKeyUp(e) {
      if (e.keyCode !== K.ENTER || !hold) return;
      const h = hold; hold = null;
      clearTimeout(h.timer);
      if (h.held || !alive()) return;
      if (zone() !== h.zone) return;
      if (h.zone === 'cats') {
        clearTimeout(pendingCat); pendingCat = null;
        markPicked();
        const pos = catList.selected;
        if (cats[pos]) openCategory(cats[pos], pos, true);
      } else openItem(content.selected);
    }

    function onKey(e) {
      if (!alive()) return false;
      const k = e.keyCode;
      const z = zone();
      if (z === null || z === 'bar') return false;
      const consume = () => { e.preventDefault(); return true; };

      if (z === 'search') {
        if (k === K.ENTER || k === K.IME_DONE) { submitSearch(); return consume(); }
        if (k === K.BACK || k === K.ESC || k === K.IME_CANCEL) { searchBox.blur(); backToCategories(); return consume(); }
        if (k === K.DOWN) { if (content.count) content.select(content.selected, { focus: true }); return consume(); }
        if (k === K.UP) { bar.focusCurrent(); return consume(); }
        return false; // ◀ ▶ move the caret
      }

      if (k === K.ENTER) {
        if (!e.repeat) startHold(z);
        return consume();
      }
      if (k === K.MENU) {
        if (z === 'cats') { const c = cats[catList.selected]; if (c && !B.isPseudo(c.id)) hideCategory(c); } else toggleFav(content.selected);
        return consume();
      }
      if (k === K.BACK || k === K.ESC) {
        if (z === 'content') { backToCategories(); return consume(); }
        return false; // the categories: back to Home
      }
      const dir = DIRS[k];
      if (!dir) return false;
      if (z === 'cats') {
        if (dir === 'right') rightFromCats();
        else if (dir === 'up') { if (!catList.move('up')) bar.focusCurrent(); } else if (dir === 'down') catList.move('down');
        return consume();
      }
      // content
      if (dir === 'right' && live) { enterGuide(); return consume(); }
      if (content.move(dir)) return consume();
      if (dir === 'left') backToCategories();
      else if (dir === 'up') { if (!searchBox.hidden) searchBox.focus(); else bar.focusCurrent(); }
      return consume();
    }

    // ------------------------------------------------------------ mount

    async function mount(rootEl, p) {
      root = rootEl;
      params = p || {};
      st = params.browse || (params.browse = {});
      const restoring = !!st.saved;
      const m = mountSection(root, section, { onDown: focusTopCategory, onReselect: focusTopCategory });
      bar = m.bar; screen = m.el;
      build(m.page);

      listen(screen, 'focusin', onFocusIn);
      listen(document, 'keyup', onKeyUp);
      listen(searchBox, 'input', () => {
        clearTimeout(pendingSearch);
        pendingSearch = setTimeout(runSearch, B.SEARCH_DEBOUNCE_MS);
      });
      listen(screen, 'click', (e) => { // pointer / tests: a click is a short OK
        const cell = e.target.closest && e.target.closest('[data-index]');
        if (!cell) return;
        const i = Number(cell.dataset.index);
        if (catScroller.contains(cell)) {
          catList.select(i, { focus: true, silent: true });
          markPicked();
          openCategory(cats[i], i, true);
        } else if (contentScroller.contains(cell)) {
          content.select(i, { focus: true, silent: true });
          openItem(i);
        }
      });
      listen(document, 'visibilitychange', () => {
        if (!live) return;
        if (document.hidden) preview.release(); // onPause: free the connection
        else if (zone() === 'content') schedulePreview();
      });
      nav.register(root);

      setSpinner(true);
      let err = null;
      try { rawCats = await B.visibleCategories(type); } catch (e) { rawCats = []; err = e; }
      if (!alive()) return;
      setSpinner(false);
      setCats(B.buildCategoryList(type, rawCats));
      catList.setCount(cats.length);
      if (err) emptyEl.textContent = B.catError(api.errorMessage(err));

      if (restoring) { await restore(); return; }

      const start = B.startIndex(type, cats);
      picked = false; hideActive = true; // nothing marked until you pick a category yourself
      catList.select(0, { silent: true, scroll: 'top' });
      if (!tabFocused()) catList.focus();
      tourTimer = setTimeout(() => {
        if (!alive()) return;
        cancelTour = coach.show(B.tourKey(type), B.tourSteps(type, { cats: catsBox, mid, info: info && info.el }), alive);
      }, B.TOUR_DELAY_MS);
      // (as on Android, opening the start category replaces the categories error text straight away)
      await openCategory(cats[start], start, false);
    }

    /** Coming back from the player / details: everything where it was (the Activity was kept). */
    async function restore() {
      picked = !!st.picked;
      hideActive = !picked;
      searchBox.value = st.query || '';
      searchResults = st.results || [];
      let idx = cats.findIndex((c) => c.id === st.activeId);
      if (idx < 0) idx = B.startIndex(type, cats);
      catList.select(Math.min(st.catSel || 0, cats.length - 1), { silent: true, scroll: st.catOffset ?? 'minimal' });
      await openCategory(cats[idx], idx, false, { noAnim: true });
      if (!alive()) return;
      if (content.count) content.select(Math.min(st.contentSel || 0, content.count - 1), { silent: true, scroll: st.contentOffset ?? 'minimal' });
      if (live) showChannelInfo(content.count ? content.selected : -1);
      if (tabFocused()) return;
      if (st.zone === 'content' && content.count) content.focus();
      else if (st.zone === 'search' && !searchBox.hidden) catList.focus();
      else catList.focus();
    }

    function unmount() {
      if (root) saveState();
      for (const t of [pendingCat, pendingEpg, pendingSearch, tourTimer]) clearTimeout(t);
      if (hold) clearTimeout(hold.timer);
      hold = null;
      if (cancelTour) cancelTour();
      if (preview) preview.release(); // the full-screen player gets the connection
      off.forEach((f) => f()); off.length = 0;
      if (catGlider) catGlider.destroy();
      if (contentGlider) contentGlider.destroy();
      if (catList) catList.destroy();
      if (content) content.destroy();
      loadToken++; searchToken++;
      root = null; info = null; preview = null; catList = null; content = null; catGlider = contentGlider = null;
    }

    return {
      mount,
      onKey,
      unmount,
      // tests
      _state: () => ({ cats, items, currentCat, activeIdx, picked, hideActive, zone: zone(), catSel: catList && catList.selected, contentSel: content && content.selected }),
    };
  };
}
