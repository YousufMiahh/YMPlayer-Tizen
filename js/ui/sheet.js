// Side/bottom panel used over the player (PlayerActivity channel and track panels): SHEET colour,
// radius 26u, padding 22u, 40u from the screen edges, full height for side panels. Fades in over
// 200 ms and out over 250 ms (PlayerActivity.fade). Back closes it when onBack isn't given.
import { u } from './theme.js';

export const IN_MS = 200;
export const OUT_MS = 250;

/**
 * @param o.side    'left' | 'right' | 'bottom'
 * @param o.width   design units (side panels; Android uses 560 for channels, 520 for tracks)
 * @param o.title   optional heading (Bold 26u)
 * @param o.hint    optional line under the title (14u, TEXT2)
 * @param o.parent  where to attach (default document.body)
 * @param o.onClose called after close()
 */
export function createSheet(o = {}) {
  const side = o.side || 'right';
  const el = document.createElement('div');
  el.className = `sheet sheet-${side}`;
  el.hidden = true;
  if (side !== 'bottom') el.style.width = `${u(o.width || 520)}px`;
  if (o.title) {
    const t = document.createElement('div');
    t.className = 'sheet-title';
    t.textContent = o.title;
    el.appendChild(t);
  }
  if (o.hint) {
    const h = document.createElement('div');
    h.className = 'sheet-hint';
    h.textContent = o.hint;
    el.appendChild(h);
  }
  const body = document.createElement('div');
  body.className = 'sheet-body';
  el.appendChild(body);
  (o.parent || document.body).appendChild(el);

  let outTimer = null; let prevFocus = null;
  const onBack = (e) => {
    if (el.hidden || !el.classList.contains('on')) return;
    if (e.keyCode !== 10009 && e.keyCode !== 27) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (o.onBack) o.onBack(); else api.close();
  };

  const api = {
    el, body,
    isOpen: () => !el.hidden && el.classList.contains('on'),
    open() {
      clearTimeout(outTimer);
      prevFocus = document.activeElement;
      if (el.hidden) { el.hidden = false; void el.offsetWidth; }
      el.classList.add('on');
      window.addEventListener('keydown', onBack, true);
      const f = body.querySelector('button, [tabindex]:not([tabindex="-1"]), input');
      if (f) f.focus();
    },
    close() {
      if (el.hidden) return;
      el.classList.remove('on');
      window.removeEventListener('keydown', onBack, true);
      outTimer = setTimeout(() => { el.hidden = true; }, OUT_MS);
      if (prevFocus && prevFocus.isConnected && el.contains(document.activeElement)) prevFocus.focus();
      if (o.onClose) o.onClose();
    },
    destroy() { clearTimeout(outTimer); window.removeEventListener('keydown', onBack, true); el.remove(); },
  };
  return api;
}
