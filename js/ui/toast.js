// android.widget.Toast for a web app: a small rounded note near the bottom centre that fades in,
// stays 2 s (SHORT) or 3.5 s (LONG) and fades out. It never takes focus.
export const SHORT = 2000;
export const LONG = 3500;
export const FADE_MS = 250;

let el = null; let hideTimer = null; let removeTimer = null;

/** Show a toast. A new toast replaces the one on screen. */
export function toast(text, duration = SHORT) {
  clearTimeout(hideTimer); clearTimeout(removeTimer);
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  hideTimer = setTimeout(hide, duration);
  return el;
}

export function hide() {
  clearTimeout(hideTimer);
  if (!el) return;
  el.classList.remove('on');
  const gone = el;
  removeTimer = setTimeout(() => { if (gone === el) { gone.remove(); el = null; } }, FADE_MS);
}

export const current = () => (el && el.classList.contains('on') ? el.textContent : null);
