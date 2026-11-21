// Movies / Series: rest on a poster for a couple of seconds and it grows a little, with a panel of
// details beside it (name, year and rating, the story). Moving on hides it straight away, so you can
// keep scrolling; resting on the next one shows that one's.

export const PEEK_AFTER_MS = 2200;
export const PANEL_W = 520; // design px (× --u)

/** "Quiet Witness 1987 (1994)" → "1994": the bracketed year at the end, else the last year in the name. */
export function yearOf(name) {
  const n = String(name || '');
  const b = /[([]((?:19|20)\d{2})[)\]]\s*$/.exec(n);
  if (b) return b[1];
  const all = n.match(/\b(?:19|20)\d{2}\b/g);
  return all ? all[all.length - 1] : '';
}

/** "Gangs of London (2020)" → "Gangs of London" (the year goes in the details line). */
export function cleanTitle(name) {
  return String(name || '').replace(/\s*[([](19|20)\d{2}[)\]]\s*$/, '').trim() || String(name || '');
}

/** The details line: year · rating · whatever else the provider gave (no repeats). */
export function metaLine(it) {
  const parts = [];
  const y = yearOf(it.name);
  if (y) parts.push(y);
  if (it.info) for (const p of String(it.info).split(/\s*[·•|]\s*/)) if (p && !parts.includes(p)) parts.push(p);
  return parts.join('  ·  ');
}

/**
 * @param host        positioned element the panel goes in
 * @param elementAt   pos → the poster cell (or null if off screen)
 * @param itemAt      pos → the item
 * @param canShow     () → false while something else is in the way (search keyboard, a dialog)
 */
export function createPosterPeek({ host, elementAt, itemAt, canShow = () => true, u = (n) => n }) {
  let timer = null; let panel = null; let cell = null;

  function hide() {
    clearTimeout(timer); timer = null;
    if (cell) { cell.classList.remove('peeking'); cell = null; }
    if (panel) {
      const p = panel; panel = null;
      p.classList.remove('shown');
      setTimeout(() => p.remove(), 180);
    }
  }

  function show(pos) {
    timer = null;
    const c = elementAt(pos); const it = itemAt(pos);
    if (!c || !it || !host || !host.isConnected || !canShow()) return;
    const hr = host.getBoundingClientRect(); const cr = c.getBoundingClientRect();
    const p = document.createElement('div');
    p.className = 'poster-peek';
    const title = document.createElement('div'); title.className = 'pp-title'; title.textContent = cleanTitle(it.name);
    p.appendChild(title);
    const meta = metaLine(it);
    if (meta) { const m = document.createElement('div'); m.className = 'pp-meta'; m.textContent = meta; p.appendChild(m); }
    if (it.plot) { const d = document.createElement('div'); d.className = 'pp-plot'; d.textContent = it.plot; p.appendChild(d); }
    const hint = document.createElement('div'); hint.className = 'pp-hint'; hint.textContent = 'OK for more  ·  ◀ ▶ to keep browsing';
    p.appendChild(hint);
    const w = u(PANEL_W); const gap = u(22);
    let left = cr.right - hr.left + gap; let side = 'right';
    if (left + w > hr.width - u(8)) { left = cr.left - hr.left - gap - w; side = 'left'; }
    p.style.left = `${Math.max(0, left)}px`;
    p.style.top = `${Math.max(0, cr.top - hr.top)}px`;
    p.style.width = `${w}px`;
    p.dataset.side = side;
    host.appendChild(p);
    // keep it on screen vertically
    const ph = p.getBoundingClientRect().height;
    if (cr.top - hr.top + ph > hr.height) p.style.top = `${Math.max(0, hr.height - ph - u(8))}px`;
    panel = p; cell = c;
    c.classList.add('peeking');
    requestAnimationFrame(() => { if (panel === p) p.classList.add('shown'); });
  }

  return {
    /** A poster became the selected one: hide what's showing, show this one's after a moment. */
    selected(pos) {
      hide();
      timer = setTimeout(() => show(pos), PEEK_AFTER_MS);
    },
    hide,
    get showing() { return !!panel; },
    destroy: hide,
  };
}
