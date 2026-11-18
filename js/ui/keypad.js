// The on-screen keyboard for searching, Netflix-style (KeyPad.java): Space and Delete across the
// top, then a–z and 0–9 six to a row. It types straight into a search box, so the TV's own
// keyboard never comes up (the box is read-only and can't take focus). Hold OK on Delete, or press
// Menu on it, to clear everything.
export const KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
export const COLS = 6;
export const CLEAR_HOLD_MS = 600;
const ENTER = 13; const MENU = 10133;

export function createKeypad(input) {
  input.readOnly = true;
  input.tabIndex = -1;
  input.setAttribute('inputmode', 'none');
  const el = document.createElement('div');
  el.className = 'keypad';
  const btn = (label, k, extra = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `kp-key ${extra}`.trim();
    b.textContent = label;
    b.dataset.key = k;
    return b;
  };
  const top = document.createElement('div');
  top.className = 'kp-row kp-top';
  top.append(btn('Space', ' ', 'kp-wide'), btn('Delete', 'del', 'kp-wide'));
  el.appendChild(top);
  for (let i = 0; i < KEYS.length; i += COLS) {
    const r = document.createElement('div');
    r.className = 'kp-row';
    r.append(...KEYS.slice(i, i + COLS).map((c) => btn(c, c)));
    el.appendChild(r);
  }

  const changed = () => input.dispatchEvent(new Event('input', { bubbles: true }));
  function press(k) {
    if (k === 'del') { if (input.value) { input.value = input.value.slice(0, -1); changed(); } return; }
    if (k === ' ' && (!input.value || input.value.endsWith(' '))) return;
    input.value += k;
    changed();
  }
  function clear() {
    if (!input.value) return;
    input.value = '';
    changed();
  }

  // Pointer / mouse
  el.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-key]');
    if (b && e.detail !== -1) press(b.dataset.key);
  });

  let holdTimer = null; let held = false;
  const onUp = (e) => {
    if (e.keyCode !== ENTER || holdTimer === null && !held) return;
    const wasHeld = held;
    clearTimeout(holdTimer); holdTimer = null; held = false;
    const f = document.activeElement;
    if (!wasHeld && f && el.contains(f) && f.dataset.key === 'del') press('del');
  };
  document.addEventListener('keyup', onUp);

  const rows = () => [...el.querySelectorAll('.kp-row')].map((r) => [...r.children]);
  /** A key's column in the six-wide grid (Space covers 0–2, Delete 3–5). */
  const colOf = (r, i) => (r === 0 ? i * 3 + 1 : i);

  return {
    el,
    /**
     * ◀ ▶ ▲ ▼ inside the keyboard, for screens that move focus themselves (Live TV, Movies,
     * Series). @returns false at an edge, so the screen can move on (the categories, the results).
     */
    move(dir) {
      const f = document.activeElement;
      const rs = rows();
      const r = rs.findIndex((row) => row.includes(f));
      if (r < 0) return false;
      const i = rs[r].indexOf(f);
      let target = null;
      if (dir === 'left' && i > 0) target = rs[r][i - 1];
      else if (dir === 'right' && i < rs[r].length - 1) target = rs[r][i + 1];
      else if (dir === 'up' && r > 0) {
        const c = colOf(r, i);
        target = r - 1 === 0 ? rs[0][c < 3 ? 0 : 1] : rs[r - 1][c];
      } else if (dir === 'down' && r < rs.length - 1) {
        const c = colOf(r, i);
        target = rs[r + 1][r === 0 ? (i === 0 ? 0 : 3) : c] || null;
      }
      if (!target) return false;
      target.focus({ preventScroll: true });
      return true;
    },
    first: () => el.querySelector('[data-key="a"]'),
    focusFirst() { const b = el.querySelector('[data-key="a"]'); if (b) b.focus({ preventScroll: true }); },
    has: (node) => !!node && el.contains(node),
    /**
     * The remote's keys while a key has focus. OK types the letter at once; on Delete it's decided
     * on release (a hold clears). @returns true when the key was used.
     */
    handleKey(e) {
      const f = document.activeElement;
      if (!f || !el.contains(f) || !f.dataset || f.dataset.key === undefined) return false;
      const k = f.dataset.key;
      if (e.keyCode === MENU && k === 'del') { e.preventDefault(); clear(); return true; }
      if (e.keyCode !== ENTER) return false;
      e.preventDefault();
      if (k !== 'del') { if (!e.repeat) press(k); return true; }
      if (!e.repeat && holdTimer === null && !held) {
        holdTimer = setTimeout(() => { holdTimer = null; held = true; clear(); }, CLEAR_HOLD_MS);
      }
      return true;
    },
    destroy() {
      clearTimeout(holdTimer);
      document.removeEventListener('keyup', onUp);
    },
  };
}
