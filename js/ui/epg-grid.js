// The TV guide grid (EpgGrid.java, TiviMate / Sky style): channels down the left, programmes across
// a two-hour timeline, a line for "now". ▲▼ change channel, ◀▶ move through programmes, OK plays,
// hold OK / Menu / Info = the programme's details.
//
// Android draws it on a canvas; here the rows are DOM, windowed with js/ui/vlist.js so a category
// of thousands of channels costs the same as one of ten. The highlight is a time ("cursor"), so
// moving up or down lands on whatever is on at that time in the next row.
import { createVList } from './vlist.js';
import { u } from './theme.js';
import * as Guide from '../guide.js';

export const HALF_HOUR = 1800;
export const WINDOW = 2 * 3600;        // two hours across the screen
export const AHEAD_LIMIT = 24 * 3600;  // ▶ goes up to 24 h from now
export const KEEP_IN_VIEW = 300;       // the window moves on when the cursor is within 5 min of its end
export const TICK_MS = 30000;          // keep the "now" line moving
export const SCROLL_MS = 200;          // row scroll, DecelerateInterpolator(2)
export const HEADER_H = u(44);
export const CHAN_W = u(330);
export const GRID_X = CHAN_W + u(8);
export const ROW_H = u(72);
export const GAP = u(3);
export const MIN_TEXT = u(20);         // narrower than this (after 2 x 12 padding): no title
export const LOAD_BEFORE = 2;          // rows above the first visible one that get listings
export const LOAD_AFTER = 4;           // ... and below the last

const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** SimpleDateFormat("HH:mm", Locale.UK) */
export const hm = (sec) => { const d = new Date(sec * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** SimpleDateFormat("EEE d MMM", Locale.UK) */
export const dayLabel = (sec) => { const d = new Date(sec * 1000); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

export const nowSec = () => Math.floor(Date.now() / 1000);
/** now - now % HALF_HOUR, as Android aligns the window. */
export const floorHalf = (t) => t - (t % HALF_HOUR);

/**
 * Where a programme sits in the window: its part inside [windowStart, windowStart + 2 h), inset by
 * half the gap on each side. null when none of it is in the window.
 * @returns {{ left: number, width: number, start: number, end: number } | null}  px, relative to the row
 */
export function cellRect(p, windowStart, gridX, perSec, gap = GAP) {
  const s = Math.max(p.start, windowStart); const e = Math.min(p.stop, windowStart + WINDOW);
  if (e <= s) return null;
  const x1 = gridX + (s - windowStart) * perSec; const x2 = gridX + (e - windowStart) * perSec;
  return { left: x1 + gap / 2, width: x2 - x1 - gap, start: s, end: e };
}

/** Whether a cell this wide gets its title (EpgGrid: avail = width - 24, skipped under 20). */
export const showsTitle = (width) => width - u(24) >= MIN_TEXT;

/**
 * ▶: the start of the next programme (or +30 min in a gap / with no listings), no further than 24 h
 * ahead; the window moves on in half hours to keep the cursor in view.
 * @returns {{ cursor, windowStart } | null}  null = at the limit, nothing moves
 */
export function stepRight(cursor, windowStart, p, now) {
  const next = p && p.stop > cursor ? p.stop : cursor + HALF_HOUR;
  if (next > now + AHEAD_LIMIT) return null;
  const c = next + 1;
  let ws = windowStart; let end = ws + WINDOW;
  while (c >= end - KEEP_IN_VIEW) { ws += HALF_HOUR; end += HALF_HOUR; }
  return { cursor: c, windowStart: ws };
}

/**
 * ◀: the previous programme (or -30 min), never before now. On what's on now it leaves the guide.
 * @returns {{ exit: true } | { cursor, windowStart }}
 */
export function stepLeft(cursor, windowStart, p, now) {
  const onNow = p ? p.start <= now : cursor - HALF_HOUR < now;
  if (onNow) return { exit: true };
  const c = Math.max(now, p ? p.start - 1 : cursor - HALF_HOUR);
  let ws = windowStart;
  while (c < ws) ws -= HALF_HOUR;
  const nowFloor = floorHalf(now);
  if (ws < nowFloor) ws = nowFloor;
  return { cursor: c, windowStart: ws };
}

/** EpgGrid.moveRow: keep one row of context above and below the selected one. */
export function scrollTop(sel, top, vis, count) {
  if (sel < top + 1) return Math.max(0, sel - 1);
  if (sel > top + vis - 2) return Math.min(Math.max(0, count - vis), sel - vis + 2);
  return top;
}

/** The rows that need listings: two above the first visible row to four below the last. */
export function listingRange(top, vis, count) {
  return [Math.max(0, top - LOAD_BEFORE), Math.min(count, top + vis + LOAD_AFTER)];
}

/**
 * @param o.el        the guide element (focusable; gets the header, rows and now line)
 * @param o.size      () => { w, h } the guide's size in px (the layout's target, not mid-glide)
 * @param o.listener  { onHighlight(row, ch, p), onPlay(row), onExit(), onDetails(row, p), onNeedListings(channels) }
 * @param o.keepFocus () => bool: draw as focused even without DOM focus (a dialog on top)
 */
export function createEpgGrid(o) {
  const el = o.el;
  const L = o.listener || {};
  el.tabIndex = -1;
  el.classList.add('epg');
  el.innerHTML = '<div class="g-head"><span class="g-date"></span><div class="g-times"></div></div>'
    + '<div class="g-rows"></div><div class="g-now" hidden><i></i></div>';
  const head = el.querySelector('.g-head');
  const dateEl = head.querySelector('.g-date');
  const times = head.querySelector('.g-times');
  const rowsEl = el.querySelector('.g-rows');
  const nowEl = el.querySelector('.g-now');

  let channels = []; let sel = 0; let top = 0; let rowH = ROW_H;
  let windowStart = 0; let cursor = 0; let tick = null; let hold = null;
  let paintedFocus = null;

  // The stage size is asked for (and may be measured from the page) once per redraw or key
  // press, not once per row: every row of one paint is laid out against the same numbers.
  let frame = null;
  const measure = () => {
    const s = o.size ? o.size() : null;
    return { w: (s && s.w) || el.clientWidth || 1920 - u(96), h: (s && s.h) || el.clientHeight || 0 };
  };
  const size = () => frame || measure();
  const once = (fn) => {
    if (frame) return fn();
    frame = measure();
    try { return fn(); } finally { frame = null; }
  };
  const perSec = () => (size().w - GRID_X) / WINDOW;
  const visibleRows = () => Math.max(1, Math.floor((size().h - HEADER_H) / Math.max(1, rowH)));
  const focused = () => document.activeElement === el || !!(o.keepFocus && o.keepFocus());

  /** The programme under the highlight in the selected row. */
  function current() {
    const ch = channels[sel];
    return ch ? Guide.at(Guide.get(ch.id), cursor) : null;
  }

  function highlight() {
    if (L.onHighlight && sel >= 0 && sel < channels.length) L.onHighlight(sel, channels[sel], current());
  }

  function requestListings() {
    if (!L.onNeedListings || !channels.length) return;
    const vis = size().h > 0 ? visibleRows() : 10;
    const [from, to] = listingRange(top, vis, channels.length);
    L.onNeedListings(channels.slice(from, to));
  }

  // ------------------------------------------------------------ drawing

  function channelCell(ch, i) {
    const c = document.createElement('div');
    c.className = 'g-ch';
    const num = document.createElement('span'); num.className = 'g-num';
    num.textContent = ch.num == null || ch.num === '' ? String(i + 1) : String(ch.num);
    const logo = document.createElement('span'); logo.className = 'g-logo';
    if (ch.icon) {
      const img = document.createElement('img'); img.alt = ''; img.src = ch.icon;
      img.onerror = () => img.remove();
      logo.appendChild(img);
    }
    const name = document.createElement('span'); name.className = 'g-name'; name.textContent = ch.name || '';
    c.append(num, logo, name);
    return c;
  }

  function progCell(cls, left, width, text) {
    const d = document.createElement('div');
    d.className = cls;
    d.style.left = `${left}px`; d.style.width = `${width}px`;
    if (text !== null) { const t = document.createElement('span'); t.textContent = text; d.appendChild(t); }
    return d;
  }

  function fillProgs(box, i) {
    const ch = channels[i];
    const list = Guide.get(ch.id);
    const selRow = i === sel; const f = focused();
    const w = size().w;
    box.replaceChildren();
    if (!list || !list.length) { // "Loading…" / "No information" across the whole window
      const hl = selRow && f;
      const c = progCell(`g-prog g-none${hl ? ' hl' : ''}`, GRID_X + GAP / 2, w - GRID_X - GAP, list ? 'No information' : 'Loading…');
      box.appendChild(c);
      return;
    }
    const ps = perSec(); const now = nowSec();
    for (const p of list) {
      const r = cellRect(p, windowStart, GRID_X, ps);
      if (!r) continue;
      const hl = selRow && f && p.start <= cursor && cursor < p.stop;
      const onNow = p.start <= now && now < p.stop;
      const c = progCell(`g-prog${hl ? ' hl' : onNow ? ' on-now' : ''}`, r.left, r.width, showsTitle(r.width) ? (p.title || '') : null);
      box.appendChild(c);
    }
  }

  /** A row's look depends on these; the row is only rebuilt when they change. */
  function sig(i) {
    const ch = channels[i];
    const list = Guide.get(ch.id);
    const selRow = i === sel;
    const hlProg = selRow ? Guide.at(list, cursor) : null;
    return [ch.id, selRow, selRow && focused(), windowStart, list ? list.length : -1, hlProg ? hlProg.start : 0,
      Math.floor(nowSec() / 60), size().w].join('|');
  }
  const sigs = new WeakMap(); const lists = new WeakMap();

  function renderRow(i, cell) {
    const ch = channels[i];
    let row = cell;
    if (!row || row.dataset.ch !== String(ch.id)) {
      row = document.createElement('div');
      row.className = 'g-row';
      row.dataset.ch = String(ch.id);
      const progs = document.createElement('div'); progs.className = 'g-progs';
      row.append(channelCell(ch, i), progs);
    }
    const s = sig(i);
    const list = Guide.get(ch.id);
    if (sigs.get(row) === s && lists.get(row) === list) return row;
    sigs.set(row, s); lists.set(row, list);
    row.classList.toggle('sel', i === sel);
    fillProgs(row.querySelector('.g-progs'), i);
    return row;
  }

  const vlist = createVList({
    scroller: rowsEl, pitch: rowH, cellHeight: rowH, overscan: 2, freeScroll: true,
    render: (i, cell) => renderRow(i, cell),
  });
  vlist.body.classList.add('g-body');

  function drawHeader() {
    const now = nowSec();
    const ps = perSec();
    dateEl.textContent = `${dayLabel(now)}   ${hm(now)}`;
    const want = [];
    for (let t = windowStart; t < windowStart + WINDOW; t += HALF_HOUR) want.push(t);
    while (times.children.length > want.length) times.lastChild.remove();
    while (times.children.length < want.length) {
      const m = document.createElement('div'); m.className = 'g-time';
      m.innerHTML = '<span></span><i></i>';
      times.appendChild(m);
    }
    want.forEach((t, k) => {
      const m = times.children[k];
      m.style.left = `${GRID_X + (t - windowStart) * ps}px`;
      m.firstChild.textContent = hm(t);
    });
    if (now >= windowStart && now < windowStart + WINDOW) {
      nowEl.hidden = false;
      nowEl.style.left = `${GRID_X + (now - windowStart) * ps}px`;
    } else nowEl.hidden = true;
  }

  /** @param defer a redraw follows at once: it draws the rows (one paint, not two) */
  function scrollTo(animate, defer = false) {
    vlist.body.style.transition = animate ? `transform ${SCROLL_MS}ms var(--ease-out)` : 'none';
    vlist.select(sel, { scroll: (sel - top) * rowH, silent: true, defer });
  }

  function redraw() {
    once(() => {
      paintedFocus = focused();
      drawHeader();
      vlist.refresh();
    });
  }

  function startTick() {
    clearInterval(tick);
    tick = setInterval(() => { if (el.isConnected) redraw(); }, TICK_MS);
  }

  // ------------------------------------------------------------ keys

  function moveRow(to) {
    once(() => {
      sel = to;
      const newTop = scrollTop(sel, top, visibleRows(), channels.length);
      const moved = newTop !== top;
      top = newTop;
      scrollTo(moved, true);
      if (moved) requestListings();
      highlight();
      redraw();
    });
  }

  const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, CH_UP: 427, CH_DOWN: 428, MENU: 10133, INFO: 457 };

  /** keydown while the guide has focus. @returns 'up' when ▲ on row 0 passes up (into the top bar), else handled. */
  function onKey(e) {
    if (!channels.length) return false;
    const k = e.keyCode;
    if (k === KEY.DOWN || k === KEY.CH_DOWN) {
      if (sel < channels.length - 1) moveRow(sel + 1);
      return true;
    }
    if (k === KEY.UP || k === KEY.CH_UP) {
      if (sel === 0) return 'up';
      moveRow(sel - 1);
      return true;
    }
    if (k === KEY.RIGHT) {
      const r = stepRight(cursor, windowStart, current(), nowSec());
      if (!r) return true;
      cursor = r.cursor; windowStart = r.windowStart;
      highlight(); redraw();
      return true;
    }
    if (k === KEY.LEFT) {
      const r = stepLeft(cursor, windowStart, current(), nowSec());
      if (r.exit) { if (L.onExit) L.onExit(); return true; }
      cursor = r.cursor; windowStart = r.windowStart;
      highlight(); redraw();
      return true;
    }
    if (k === KEY.ENTER) { // quick press = watch (on release); hold = full programme details
      if (!e.repeat && !hold) {
        const h = { held: false, timer: null };
        h.timer = setTimeout(() => {
          h.timer = null; h.held = true;
          if (L.onDetails) L.onDetails(sel, current());
        }, o.longPressMs || 450);
        hold = h;
      }
      return true;
    }
    if (k === KEY.MENU || k === KEY.INFO) {
      if (!e.repeat && L.onDetails) L.onDetails(sel, current());
      return true;
    }
    return false;
  }

  function onKeyUp(e) {
    if (e.keyCode !== KEY.ENTER) return false;
    const h = hold; hold = null;
    if (!h) return false;
    clearTimeout(h.timer);
    if (!h.held && L.onPlay && channels.length) L.onPlay(sel);
    return true;
  }

  const onFocusChange = () => { if (paintedFocus !== focused()) redraw(); };
  el.addEventListener('focus', onFocusChange);
  el.addEventListener('blur', onFocusChange);

  return {
    el,
    /**
     * The channel list becomes the guide, lined up row for row.
     * @param opts.windowStart / opts.cursor  restore a saved position in time
     */
    setChannels(list, selected, firstVisible, rowHeight, opts = {}) {
      channels = list || [];
      if (rowHeight > 0 && rowHeight !== rowH) rowH = rowHeight;
      sel = Math.max(0, Math.min(selected, channels.length - 1));
      top = Math.max(0, Math.min(firstVisible, sel));
      // (Android leaves the selected row where the taller list had it, which can be below the
      // guide's last row; bring it into view the way moveRow would.)
      top = scrollTop(sel, top, visibleRows(), channels.length);
      const now = nowSec();
      windowStart = opts.windowStart ?? floorHalf(now);
      cursor = opts.cursor ?? now;
      if (cursor < now) { cursor = now; windowStart = Math.max(windowStart, floorHalf(now)); }
      el.style.setProperty('--row-h', `${rowH}px`);
      vlist.setPitch(rowH);
      vlist.setCount(channels.length);
      once(() => {
        scrollTo(false, true);
        requestListings();
        highlight();
        redraw();
      });
      startTick();
    },
    selected: () => sel,
    firstVisible: () => top,
    headerHeight: () => HEADER_H,
    current,
    /** New listings arrived: redraw, and refresh the details if the highlighted channel's came in. */
    listingsChanged() { highlight(); redraw(); },
    /** The guide's size changed (layout). */
    relayout() { vlist.relayout(); once(() => { scrollTo(false, true); requestListings(); redraw(); }); },
    redraw,
    focus() { el.focus({ preventScroll: true }); redraw(); },
    hasFocus: () => document.activeElement === el,
    onKey,
    onKeyUp,
    cancelHold() { if (hold) clearTimeout(hold.timer); hold = null; },
    stop() { clearInterval(tick); tick = null; },
    destroy() {
      clearInterval(tick); tick = null;
      if (hold) clearTimeout(hold.timer);
      hold = null;
      el.removeEventListener('focus', onFocusChange);
      el.removeEventListener('blur', onFocusChange);
      vlist.destroy();
    },
    // tests / the screen's focus memory
    get windowStart() { return windowStart; },
    get cursor() { return cursor; },
    get rowHeight() { return rowH; },
    get vlist() { return vlist; },
  };
}
