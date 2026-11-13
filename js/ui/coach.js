// The optional quick-start tutorial (Coach.java): dims the screen except one highlighted part,
// with a short caption. OK (or ▶) for the next tip, Back to skip. Each screen has its own short
// tour, shown the first time it opens while the tutorial is on. Samsung remotes count as "tv".
import { showDialog } from './dialog.js';
import { u, decelerate } from './theme.js';

const KEY = { RIGHT: 39, ENTER: 13, BACK: 10009, ESC: 27 };
const ls = () => globalThis.localStorage;
const get = (k) => ls().getItem(`coach_${k}`) === 'true';
const set = (k, v) => ls().setItem(`coach_${k}`, String(!!v));

export const SHOW_DELAY_MS = 900;
export const OFFER_TITLE = 'Welcome to YM Player';
export const OFFER_TEXT = 'Would you like a quick tour of the basics? It takes about a minute, and you can skip it at any time with Back.'
  + '\n\nYou can always watch it later from Settings.';
export const HINT_NEXT = 'OK  Next      Back  Skip tour';
export const HINT_DONE = 'OK  Done';

let open = null; // the overlay on screen

/** Coach.offer: ask once, the first time Home opens; later calls just try the tour. */
export function offer(startTour) {
  if (get('asked')) { startTour(); return null; }
  set('asked', true);
  const d = showDialog({ title: OFFER_TITLE, message: OFFER_TEXT, positive: 'Show me', negative: 'No thanks' });
  d.result.then((v) => {
    if (v !== 'positive') return;
    set('on', true);
    startTour();
  });
  return d;
}

/** Settings → Show Tutorial: switch it back on and forget which tours were seen. */
export function restart() {
  const keys = [];
  for (let i = 0; i < ls().length; i++) keys.push(ls().key(i));
  for (const k of keys) if (k && k.startsWith('coach_')) ls().removeItem(k);
  set('asked', true); set('on', true);
}

export const wants = (screen) => get('on') && !get(`seen_${screen}`);
export const showing = () => open !== null;

/** Back skips the tour. @returns true if a tour was showing. */
export function back() {
  if (!open) return false;
  open.finish();
  return true;
}

/** The screen is going away: take any tour down with it (a tour must never outlive its screen). */
export function dismiss() {
  if (open) open.finish(true);
}

const visible = (el) => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/**
 * Coach.show: this screen's tour, if the tutorial is on and it hasn't been seen.
 * @param steps [{ target: Element|(() => Element)|null, title, body }] (null = caption centred)
 * @param alive () => boolean, false once the screen has gone
 * @returns a cancel function
 */
export function show(screen, steps, alive = () => true) {
  if (!wants(screen) || open) return () => {};
  const t = setTimeout(() => { // let the screen settle and fill first
    if (!alive() || open || !wants(screen)) return;
    const usable = steps.map((s) => ({ ...s, target: typeof s.target === 'function' ? s.target() : s.target }))
      .filter((s) => s.target == null || visible(s.target));
    if (!usable.length) return;
    set(`seen_${screen}`, true);
    open = overlay(usable);
  }, SHOW_DELAY_MS);
  return () => clearTimeout(t);
}

const EASE = decelerate(2);

function overlay(steps) {
  const prevFocus = document.activeElement;
  const el = document.createElement('div');
  el.className = 'coach';
  const hole = document.createElement('div');
  hole.className = 'coach-hole';
  const card = document.createElement('div');
  card.className = 'coach-card';
  card.innerHTML = '<div class="coach-counter"></div><div class="coach-title"></div><div class="coach-body"></div><div class="coach-hint"></div>';
  el.append(hole, card);
  document.body.appendChild(el);
  void el.offsetWidth;
  el.classList.add('on');

  let index = -1;
  let rect = null; // current hole {l,t,r,b}
  let raf = 0; let finished = false;
  const W = () => el.clientWidth || window.innerWidth;
  const H = () => el.clientHeight || window.innerHeight;

  function paintHole(r) {
    rect = r;
    const w = r.r - r.l; const h = r.b - r.t;
    hole.style.left = `${r.l}px`; hole.style.top = `${r.t}px`;
    hole.style.width = `${Math.max(0, w)}px`; hole.style.height = `${Math.max(0, h)}px`;
    hole.classList.toggle('ring', w > 1);
  }

  function morph(from, to) {
    cancelAnimationFrame(raf);
    const t0 = performance.now();
    const step = (now) => {
      const f = EASE(Math.min(1, (now - t0) / 380));
      paintHole({ l: from.l + (to.l - from.l) * f, t: from.t + (to.t - from.t) * f, r: from.r + (to.r - from.r) * f, b: from.b + (to.b - from.b) * f });
      if (f < 1) raf = requestAnimationFrame(step);
    };
    paintHole(from);
    raf = requestAnimationFrame(step);
  }

  function placeCard(to, hasHole) {
    const cw = card.offsetWidth; const ch = card.offsetHeight; const gap = u(24);
    const w = W(); const h = H();
    let x; let y;
    const cx = (to.l + to.r) / 2;
    if (!hasHole) { x = (w - cw) / 2; y = (h - ch) / 2; } else {
      x = Math.max(gap, Math.min(w - cw - gap, cx - cw / 2));
      if (to.b + gap + ch < h - gap) y = to.b + gap;
      else if (to.t - gap - ch > gap) y = to.t - gap - ch;
      else { y = (h - ch) / 2; x = to.r + gap + cw < w ? to.r + gap : Math.max(gap, to.l - gap - cw); }
    }
    x = Math.max(gap, Math.min(x, w - cw - gap));
    y = Math.max(gap, Math.min(y, h - ch - gap));
    card.classList.remove('in');
    card.style.transform = `translate(${x}px, ${y + u(12)}px)`;
    void card.offsetWidth;
    card.classList.add('in');
    card.style.transform = `translate(${x}px, ${y}px)`;
  }

  function next() {
    index++;
    if (index >= steps.length) { finish(); return; }
    const s = steps[index];
    card.querySelector('.coach-counter').textContent = `Tip ${index + 1} of ${steps.length}`.toUpperCase();
    card.querySelector('.coach-title').textContent = s.title;
    card.querySelector('.coach-body').textContent = s.body;
    card.querySelector('.coach-hint').textContent = index === steps.length - 1 ? HINT_DONE : HINT_NEXT;
    const hadHole = rect !== null && rect.r - rect.l > 1;
    let to;
    if (s.target) {
      const r = s.target.getBoundingClientRect(); const pad = u(10); const m = u(4);
      to = { l: Math.max(m, r.left - pad), t: Math.max(m, r.top - pad), r: Math.min(W() - m, r.right + pad), b: Math.min(H() - m, r.bottom + pad) };
    } else {
      to = { l: W() / 2, t: H() / 2, r: W() / 2, b: H() / 2 };
    }
    const cx = (to.l + to.r) / 2; const cy = (to.t + to.b) / 2;
    const from = hadHole ? rect : { l: cx, t: cy, r: cx, b: cy };
    morph(from, to);
    placeCard(to, !!s.target);
  }

  function onKey(e) {
    const k = e.keyCode;
    e.preventDefault();
    e.stopImmediatePropagation(); // nothing underneath reacts while the tour is up
    if (k === KEY.BACK || k === KEY.ESC) { finish(); return; }
    if (!e.repeat && (k === KEY.ENTER || k === KEY.RIGHT)) next();
  }

  /** @param now the screen has gone: no fade, the overlay leaves at once */
  function finish(now = false) {
    if (finished) return;
    finished = true;
    open = null;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    el.classList.remove('on');
    if (now) { el.remove(); return; }
    setTimeout(() => {
      el.remove();
      if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
    }, 200);
  }

  window.addEventListener('keydown', onKey, true);
  next();
  return { finish, next, el };
}

/** Tests: drop any overlay without the fade. */
export function _reset() {
  if (open) { const o = open; o.finish(); o.el.remove(); }
  open = null;
}
