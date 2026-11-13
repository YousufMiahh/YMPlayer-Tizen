// A windowed ListView / GridView for the TV: only the rows on screen (plus a few either side) are
// in the DOM, so a category of 10 000 channels costs the same as one of 20. Rows have a fixed
// pitch; the body is moved with a transform (no native scrolling), exactly like ListView's own
// arrow scrolling: just enough to bring the selected row fully on screen, no animation.
//
// Selection is index based (AbsListView.getSelectedItemPosition): the view moves it with the
// D-pad keys via move(), and the selected cell is the one that holds DOM focus while the list has
// focus. Cells are built by `render(index)`, which returns a focusable element.
//
// Grid columns follow GridView AUTO_FIT + STRETCH_SPACING_UNIFORM: n = floor(width / colWidth),
// the leftover width is shared equally between the n + 1 gaps.

/**
 * @param o.scroller   element that clips the list (overflow hidden; gets the body appended)
 * @param o.pitch      px from one row's top to the next (cell height + divider/spacing)
 * @param o.cellHeight px (default pitch)
 * @param o.colWidth   px; set for a grid (AUTO_FIT columns), leave out for a one-column list
 * @param o.padTop / o.padBottom  list padding in px (clipToPadding false: rows scroll through it)
 * @param o.render     (index, cell?) => Element; with a cell (refresh), update it and return it
 * @param o.onSelect   (index, prev) => void, after the selection changes
 * @param o.overscan   rows kept either side of the visible window (default 3)
 * @param o.freeScroll only clamp the scroll at the top (EpgGrid: the caller picks the first row and
 *                     may leave space under the last one)
 */
export function createVList(o) {
  const scroller = o.scroller;
  const body = document.createElement('div');
  body.className = 'vl-body';
  scroller.appendChild(body);
  let pitch = o.pitch;
  let cellH = o.cellHeight || pitch;
  const padTop = o.padTop || 0; const padBottom = o.padBottom || 0;
  const overscan = o.overscan ?? 3;
  const live = new Map(); // index -> element

  let count = 0; let sel = 0; let y = 0; let cols = 1; let spacing = 0; let width = 0;

  const viewH = () => scroller.clientHeight || o.viewportHeight || 1080;
  const rows = () => Math.ceil(count / cols);
  const rowTop = (r) => padTop + r * pitch;
  const contentH = () => (count ? rowTop(rows() - 1) + cellH + padBottom : padTop + padBottom);

  function measure() {
    width = scroller.clientWidth || o.viewportWidth || 0;
    if (o.colWidth) {
      cols = Math.max(1, Math.floor(width / o.colWidth) || 1);
      spacing = Math.max(0, (width - cols * o.colWidth) / (cols + 1));
    } else { cols = 1; spacing = 0; }
  }

  function place(el, i) {
    const r = Math.floor(i / cols); const c = i % cols;
    el.style.position = 'absolute';
    el.style.top = `${rowTop(r)}px`;
    el.style.height = `${cellH}px`;
    if (o.colWidth) {
      el.style.left = `${spacing + c * (o.colWidth + spacing)}px`;
      el.style.width = `${o.colWidth}px`;
    } else {
      el.style.left = '0px';
      el.style.right = '0px';
    }
  }

  function build(i) {
    const el = o.render(i);
    el.dataset.index = String(i);
    place(el, i);
    return el;
  }

  /** Put exactly the cells of the visible window (plus overscan, plus the selected one) in the DOM. */
  function paint(force = false) {
    const h = viewH();
    let first = Math.max(0, Math.floor((y - padTop) / pitch) - overscan);
    let last = Math.min(rows() - 1, Math.floor((y + h - padTop) / pitch) + overscan);
    if (!count) { first = 0; last = -1; }
    const want = new Set();
    for (let r = first; r <= last; r++) for (let c = 0; c < cols; c++) { const i = r * cols + c; if (i < count) want.add(i); }
    if (count) want.add(sel);
    for (const [i, el] of [...live]) if (!want.has(i)) { el.remove(); live.delete(i); }
    for (const i of want) {
      const el = live.get(i);
      if (el && !force) continue;
      const fresh = el ? o.render(i, el) : null; // render(i, el) may update the cell in place
      if (el && fresh === el) { place(el, i); continue; }
      const made = fresh || build(i);
      made.dataset.index = String(i); place(made, i);
      if (el) {
        const focused = el === document.activeElement;
        el.replaceWith(made);
        if (focused) made.focus({ preventScroll: true });
      } else body.appendChild(made);
      live.set(i, made);
    }
    body.style.height = `${contentH()}px`;
    body.style.transform = `translateY(${-y}px)`;
  }

  function indexOf(el) {
    if (!el || !body.contains(el)) return -1;
    const cell = el.closest('[data-index]');
    return cell && cell.parentNode === body ? Number(cell.dataset.index) : -1;
  }

  function clampY(v) {
    if (o.freeScroll) return Math.max(0, v);
    return Math.max(0, Math.min(v, Math.max(0, contentH() - viewH())));
  }

  /** ListView arrow scrolling: the least movement that shows the whole selected row. */
  function reveal(i, mode = 'minimal') {
    const r = Math.floor(i / cols);
    const top = rowTop(r); const bottom = top + cellH; const h = viewH();
    if (mode === 'top') y = clampY(top - padTop);
    else if (typeof mode === 'number') y = clampY(top - mode);
    else if (r === 0) y = 0;
    else if (r === rows() - 1 && bottom + padBottom > y + h) y = clampY(bottom + padBottom - h);
    else if (top < y) y = clampY(top);
    else if (bottom > y + h) y = clampY(bottom - h);
  }

  const api = {
    body,
    get count() { return count; },
    get selected() { return sel; },
    get columns() { return cols; },
    get scrollY() { return y; },
    get pitch() { return pitch; },
    hasFocus: () => indexOf(document.activeElement) >= 0,
    elementAt: (i) => live.get(i) || null,
    indexOf,
    /** Replace the data. keep = keep the selection index (clamped) and scroll; else back to the top. */
    setCount(n, keep = false) {
      const had = api.hasFocus();
      count = Math.max(0, n | 0);
      measure();
      if (!keep) { sel = 0; y = 0; } else { sel = Math.max(0, Math.min(sel, count - 1)); y = clampY(y); }
      for (const el of live.values()) el.remove();
      live.clear();
      if (count) reveal(sel);
      paint();
      if (had && count) api.focus();
    },
    /** A new row pitch (and cell height); call setCount or relayout after. */
    setPitch(p, cellHeight = p) { pitch = p; cellH = cellHeight; },
    /** Re-draw the cells on screen (favourite marks changed…), keeping focus where it was. */
    refresh() { paint(true); },
    /** Re-measure after the scroller changed size. */
    relayout() { measure(); for (const [i, el] of live) place(el, i); y = clampY(y); if (count) reveal(sel); paint(); },
    /**
     * Select row i. opts.focus: give it DOM focus. opts.scroll: 'minimal' (default) | 'top' |
     * px offset from the top of the list (setSelectionFromTop). opts.silent: no onSelect.
     * opts.defer: the caller calls refresh() straight after, which draws the rows (once).
     */
    select(i, opts = {}) {
      if (!count) return false;
      const prev = sel;
      sel = Math.max(0, Math.min(count - 1, i));
      reveal(sel, opts.scroll || 'minimal');
      if (!opts.defer) paint();
      if (opts.focus) api.focus();
      if (!opts.silent && sel !== prev && o.onSelect) o.onSelect(sel, prev);
      return true;
    },
    focus() {
      if (!count) return false;
      if (!live.has(sel)) paint();
      const el = live.get(sel);
      if (el) el.focus({ preventScroll: true });
      return !!el;
    },
    /** D-pad inside the list. @returns false at an edge (the caller decides where focus goes). */
    move(dir) {
      if (!count) return false;
      const c = sel % cols;
      let to = sel;
      if (dir === 'up') to = sel - cols;
      else if (dir === 'down') {
        to = sel + cols;
        // GridView: ▼ on the row above a short last row lands on that row's last cell
        if (to >= count && Math.floor(sel / cols) < rows() - 1) to = count - 1;
      } else if (dir === 'left') { if (c === 0) return false; to = sel - 1; } else if (dir === 'right') { if (c === cols - 1 || sel + 1 >= count) return false; to = sel + 1; }
      if (to < 0 || to >= count) return false;
      api.select(to, { focus: true });
      return true;
    },
    /** Top of row i on screen, relative to the scroller (for setSelectionFromTop-style restores). */
    offsetOf(i) { return rowTop(Math.floor(i / cols)) - y; },
    isVisible(i) { const t = api.offsetOf(i); return t >= 0 && t + cellH <= viewH(); },
    scrollTo(v) { y = clampY(v); paint(); },
    destroy() { for (const el of live.values()) el.remove(); live.clear(); body.remove(); },
  };
  measure();
  return api;
}
