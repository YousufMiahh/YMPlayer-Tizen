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
  if (el.disabled || el.hidden || el.inert) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (getComputedStyle(el).visibility === 'hidden') return false;
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
  if (!container) return false;
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
  // Pass 1: candidates whose cross-axis span overlaps the current element
  // (so Right at a row end never drops into the row below).
  // Pass 2 (so focus is never stranded): a narrow cone (across <= along/2, ~27 degrees).
  const pass1 = [], pass2 = [];
  for (const el of all) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const c = center(r);
    const along = (horiz ? c.x - cc.x : c.y - cc.y) * sign;
    if (along <= 0) continue; // not in that direction
    const across = Math.abs(horiz ? c.y - cc.y : c.x - cc.x);
    // Perpendicular drift is penalised so aligned items beat closer diagonal ones.
    const cand = { el, score: along + across * 3 };
    const overlap = horiz
      ? r.top < cr.bottom && r.bottom > cr.top
      : r.left < cr.right && r.right > cr.left;
    if (overlap) pass1.push(cand);
    else if (across <= along / 2) pass2.push(cand);
  }
  const pool = pass1.length ? pass1 : pass2;
  let best = null;
  for (const cand of pool) if (!best || cand.score < best.score) best = cand;
  if (!best) return false;
  best.el.focus();
  return document.activeElement === best.el;
}

const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'number', 'tel']);
function isTextField(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase());
}

function eventTarget() {
  const a = document.activeElement;
  return a && a !== document.body ? a : document;
}

export function onKey(e) {
  const code = e.keyCode;
  const dir = DIR_BY_KEY[code];
  if (isTextField(document.activeElement) && (code === KEY_LEFT || code === KEY_RIGHT || code === KEY_ENTER)) {
    return false; // let the caret move / IME / form submit work
  }
  if (dir) {
    e.preventDefault();
    moveFocus(dir);
    return true;
  }
  if (code === KEY_ENTER) {
    e.preventDefault();
    eventTarget().dispatchEvent(new CustomEvent('activate', { bubbles: true }));
    return true;
  }
  if (code === KEY_BACK || code === KEY_ESC) {
    e.preventDefault();
    eventTarget().dispatchEvent(new CustomEvent('back', { bubbles: true }));
    return true;
  }
  return false;
}

registerTizenKeys();
