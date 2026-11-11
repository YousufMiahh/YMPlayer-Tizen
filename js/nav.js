// D-pad spatial focus engine for TV remotes.
// Edge rule: focus STOPS at the edge (no wrap); moveFocus returns false.

const SELECTOR = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [data-focusable]';
const containers = new Set();

const KEY_LEFT = 37, KEY_UP = 38, KEY_RIGHT = 39, KEY_DOWN = 40, KEY_ENTER = 13, KEY_BACK = 10009, KEY_ESC = 27;
const DIR_BY_KEY = { [KEY_LEFT]: 'left', [KEY_UP]: 'up', [KEY_RIGHT]: 'right', [KEY_DOWN]: 'down' };
const TIZEN_KEYS = ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'];

export function registerTizenKeys() {
  const t = globalThis.tizen;
  if (!t || !t.tvinputdevice || typeof t.tvinputdevice.registerKey !== 'function') return;
  for (const k of TIZEN_KEYS) {
    try { t.tvinputdevice.registerKey(k); } catch { /* key unsupported on this model */ }
  }
}

export function register(container) {
  if (container) containers.add(container);
}

function isVisible(el) {
  if (el.disabled || el.hidden) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function focusables(root) {
  return [...root.querySelectorAll(SELECTOR)].filter(isVisible);
}

function allFocusables() {
  const out = [];
  for (const c of containers) {
    if (!c.isConnected) { containers.delete(c); continue; }
    for (const el of focusables(c)) if (!out.includes(el)) out.push(el);
  }
  return out;
}

export function focusFirst(container) {
  const el = focusables(container)[0];
  if (el) el.focus();
  return !!el;
}

function center(r) {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

export function moveFocus(dir) {
  const cur = document.activeElement;
  const all = allFocusables();
  if (!cur || !all.includes(cur)) {
    if (all[0]) { all[0].focus(); return true; }
    return false;
  }
  const cr = cur.getBoundingClientRect();
  const cc = center(cr);
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = null, bestScore = Infinity;
  for (const el of all) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const c = center(r);
    const along = (horiz ? c.x - cc.x : c.y - cc.y) * sign;
    if (along <= 0) continue; // not in that direction
    const across = Math.abs(horiz ? c.y - cc.y : c.x - cc.x);
    // Perpendicular drift is penalised so aligned items beat closer diagonal ones.
    const score = along + across * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return false;
  best.focus();
  return true;
}

export function onKey(e) {
  const code = e.keyCode;
  const dir = DIR_BY_KEY[code];
  if (dir) {
    e.preventDefault();
    moveFocus(dir);
    return true;
  }
  if (code === KEY_ENTER) {
    e.preventDefault();
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    target.dispatchEvent(new CustomEvent('activate', { bubbles: true }));
    return true;
  }
  if (code === KEY_BACK || code === KEY_ESC) {
    e.preventDefault();
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    target.dispatchEvent(new CustomEvent('back', { bubbles: true }));
    return true;
  }
  return false;
}

registerTizenKeys();
