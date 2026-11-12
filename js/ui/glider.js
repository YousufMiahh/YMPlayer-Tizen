// Port of Glider.java: one white pill behind a vertical list that glides (240 ms, Decelerate(2))
// to the focused row instead of each row lighting up on its own. Fades in/out in 140 ms when the
// list gains/loses focus. Rows show the "hot" text colours via :focus (see .glider-host in ui.css).
export const GLIDE_MS = 240;
export const FADE_MS = 140;

/**
 * @param list   scrolling container holding the rows (made position:relative)
 * @param opts.rows  selector for the rows (default '.row-cell')
 * @returns {{ update(row?), hide(), refresh(), destroy(), state() }}
 */
export function createGlider(list, opts = {}) {
  const rowSel = opts.rows || '.row-cell';
  const pill = document.createElement('div');
  pill.className = 'glider-pill';
  pill.setAttribute('aria-hidden', 'true');
  list.classList.add('glider-host');
  list.insertBefore(pill, list.firstChild);

  let shown = false; let lastRow = null; let y = -1; let frozen = false;

  function place(row, glide) {
    const top = row.offsetTop;
    pill.style.left = `${row.offsetLeft}px`;
    pill.style.width = `${row.offsetWidth}px`;
    pill.style.height = `${row.offsetHeight}px`;
    pill.style.transition = glide
      ? `transform ${GLIDE_MS}ms var(--ease-out), opacity ${FADE_MS}ms linear`
      : `opacity ${FADE_MS}ms linear`;
    pill.style.transform = `translateY(${top}px)`;
    y = top;
  }

  function update(row) {
    const r = row || (list.contains(document.activeElement) ? document.activeElement.closest(rowSel) : null);
    if (!r || !list.contains(r)) { hide(); return; }
    if (!pill.isConnected) list.insertBefore(pill, list.firstChild); // list was re-rendered
    const glide = shown && r !== lastRow && y >= 0;
    place(r, glide);
    lastRow = r;
    if (!shown) {
      shown = true;
      pill.classList.add('on');
    }
  }

  function hide() {
    if (shown) {
      shown = false;
      pill.classList.remove('on');
    }
    lastRow = null;
  }

  const onIn = (e) => {
    const r = e.target.closest && e.target.closest(rowSel);
    if (r && list.contains(r)) update(r); else hide();
  };
  const onOut = (e) => {
    if (frozen) return;
    if (!e.relatedTarget || !list.contains(e.relatedTarget)) hide();
  };
  list.addEventListener('focusin', onIn);
  list.addEventListener('focusout', onOut);

  return {
    update,
    hide,
    /** Re-sync after the list re-renders or scrolls (no glide if the row didn't change). */
    refresh() { lastRow = null; shown = shown && list.contains(document.activeElement); update(); },
    destroy() {
      list.removeEventListener('focusin', onIn);
      list.removeEventListener('focusout', onOut);
      pill.remove();
      list.classList.remove('glider-host');
    },
    /**
     * Keep the highlight where it is while a dialog has focus (the Android list stays focused
     * under the dialog window). The row gets .keep-focus for its focused colours meanwhile.
     */
    freeze(on) {
      frozen = !!on;
      if (lastRow) lastRow.classList.toggle('keep-focus', frozen);
      if (!frozen && !list.contains(document.activeElement)) hide();
    },
    state: () => ({ shown, row: lastRow, y }),
    pill,
  };
}
