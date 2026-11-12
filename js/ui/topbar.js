// Port of TopBar.java: "YM" mark, centred pill track with the six section tabs and a gliding white
// highlight, HH:mm clock. Resting on a tab for 450 ms opens it (Settings needs OK); OK on the current
// tab is "reselect". Home stays at the bottom of the stack: Home -> X pushes, X -> Y replaces,
// -> Home pops back to Home. Back from a section returns to Home with a slide from the left.
import { router } from '../router.js';
import * as nav from '../nav.js';
import * as backdrop from './backdrop.js';
import { u } from './theme.js';

export const TABS = [
  ['home', 'Home'], ['live', 'Live TV'], ['movies', 'Movies'],
  ['series', 'Series'], ['search', 'Search'], ['settings', 'Settings'],
];
export const SECTIONS = TABS.map((t) => t[0]);
export const DWELL_MS = 450;     // TopBar.java:126
export const GLIDE_MS = 280;     // TopBar.java:271
export const APPEAR_MS = 180;    // TopBar.java:265
export const VANISH_MS = 160;    // TopBar.java:153
export const PAGE_MS = 420;      // TopBar.java:344
export const PAGE_DELAY_MS = 60;
export const PAGE_SHIFT = u(64); // 89.6 px
const CLOCK_MS = 15000;

const KEY_LEFT = 37; const KEY_UP = 38; const KEY_RIGHT = 39; const KEY_DOWN = 40; const KEY_ENTER = 13;

// Cross-screen state (static fields in TopBar.java)
let enterDirection = 0;   // -1 page comes from the left, 1 from the right, 0 none
let lastX = -1; let lastW = -1;
let glideHandoff = false; // switched by hovering: the next bar's highlight glides on from lastX
let pendingTab = null;    // EXTRA_TAB: the new screen keeps focus on its own tab

const order = (id) => Math.max(0, SECTIONS.indexOf(id));
export const isSection = (name) => SECTIONS.includes(name);

/** Default stack model (TopBar.go). Tests may replace it. */
function defaultNavigate(from, target) {
  if (target === 'home') { router.backTo('home'); return; }
  if (from === 'home') router.go(target); else router.replace(target);
}
let navigate = defaultNavigate;
export function setNavigator(fn) { navigate = fn || defaultNavigate; }

/** Switch section from `current` to `target` (byHover = opened by resting on the tab). */
export function go(current, target, byHover = false) {
  if (target === current) return;
  enterDirection = order(target) > order(current) ? 1 : -1;
  glideHandoff = byHover;
  pendingTab = byHover ? target : null;
  navigate(current, target);
}

/** Back from a section to Home (TopBar.back): same slide as the tabs, from the left. */
export function prepareBack() {
  enterDirection = -1;
  glideHandoff = false;
  pendingTab = null;
}

/** True while one of the top tabs has focus (screens then don't grab focus for their content). */
export function tabFocused() {
  const a = globalThis.document && document.activeElement;
  return !!(a && a.closest && a.closest('[data-topbar]'));
}

export function clockText(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Build the bar for screen `current`.
 * @param opts.onReselect  OK on the current tab
 * @param opts.onDown      Down from the bar (default: nearest element below)
 */
export function createTopBar(current, opts = {}) {
  const el = document.createElement('header');
  el.className = 'topbar';
  el.dataset.topbar = current;

  const brand = document.createElement('div');
  brand.className = 'tb-brand';
  brand.textContent = 'YM';

  const track = document.createElement('div');
  track.className = 'tb-track';
  const pill = document.createElement('div'); // position + width (glide)
  pill.className = 'tb-pill';
  const pillFace = document.createElement('div'); // opacity + scale (appear / vanish)
  pillFace.className = 'tb-pill-face';
  pill.appendChild(pillFace);
  const tabs = document.createElement('div');
  tabs.className = 'tb-tabs';
  track.append(pill, tabs);

  const clock = document.createElement('div');
  clock.className = 'tb-clock';
  clock.textContent = clockText();

  el.append(brand, track, clock);

  const glide = { shown: false, x: -1, w: -1 };
  let dwell = null;

  function setPill(x, w, animate) {
    pill.style.transition = animate ? `transform ${GLIDE_MS}ms var(--ease-out), width ${GLIDE_MS}ms var(--ease-out)` : 'none';
    pill.style.transform = `translateX(${x}px)`;
    pill.style.width = `${w}px`;
    glide.x = x; glide.w = w;
    lastX = x; lastW = w;
  }

  function glideTo(tab) {
    const tx = tab.offsetLeft; const tw = tab.offsetWidth;
    pill.style.top = `${tab.offsetTop}px`;
    pill.style.height = `${tab.offsetHeight}px`;
    let fx; let fw;
    if (glide.shown) { fx = glide.x; fw = glide.w; } else if (lastX >= 0 && glideHandoff) {
      glideHandoff = false; fx = lastX; fw = lastW;
    } else { fx = tx; fw = tw; }
    if (!glide.shown) {
      const s = fx === tx ? 0.92 : 1;
      pillFace.style.transition = 'none';
      pillFace.style.opacity = '0';
      pillFace.style.transform = `scale(${s})`;
      void pillFace.offsetWidth;
      pillFace.style.transition = `opacity ${APPEAR_MS}ms var(--ease-out), transform ${APPEAR_MS}ms var(--ease-out)`;
      pillFace.style.opacity = '1';
      pillFace.style.transform = 'scale(1)';
    }
    glide.shown = true;
    el.classList.add('has-focus');
    setPill(fx, fw, false);
    if (fx !== tx || fw !== tw) {
      void pill.offsetWidth;
      setPill(tx, tw, true);
    }
  }

  function vanish() {
    if (!glide.shown) return;
    glide.shown = false;
    el.classList.remove('has-focus');
    pillFace.style.transition = `opacity ${VANISH_MS}ms var(--ease-std), transform ${VANISH_MS}ms var(--ease-std)`;
    pillFace.style.opacity = '0';
    pillFace.style.transform = 'scale(0.92)';
  }

  const tabEls = TABS.map(([id, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-tab';
    b.dataset.tab = id;
    b.textContent = label;
    if (id === current) { b.classList.add('current'); b.dataset.current = ''; }
    b.addEventListener('focus', () => {
      clearTimeout(dwell);
      glideTo(b);
      if (id !== current && id !== 'settings') {
        dwell = setTimeout(() => {
          if (document.activeElement === b && b.isConnected) go(current, id, true);
        }, DWELL_MS);
      }
    });
    b.addEventListener('blur', () => clearTimeout(dwell));
    b.addEventListener('click', () => activate(id));
    tabs.appendChild(b);
    return b;
  });

  function activate(id) {
    if (id === current) { if (opts.onReselect) opts.onReselect(); return; }
    go(current, id, false);
  }

  el.addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !el.contains(e.relatedTarget)) vanish();
  });

  // The bar owns its keys: moving along the tabs stops at the ends, Up does nothing, Down enters
  // the page. Handled before the document-level router/nav listeners see the key.
  el.addEventListener('keydown', (e) => {
    const i = tabEls.indexOf(document.activeElement);
    if (i < 0) return;
    const k = e.keyCode;
    if (k === KEY_LEFT || k === KEY_RIGHT) {
      const j = i + (k === KEY_RIGHT ? 1 : -1);
      if (tabEls[j]) tabEls[j].focus();
    } else if (k === KEY_UP) {
      /* nothing above the bar */
    } else if (k === KEY_DOWN) {
      if (opts.onDown) opts.onDown(); else nav.moveFocus('down');
    } else if (k === KEY_ENTER) {
      if (!e.repeat) activate(tabEls[i].dataset.tab);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  });

  const tick = setInterval(() => {
    if (!el.isConnected) { clearInterval(tick); return; }
    clock.textContent = clockText();
  }, CLOCK_MS);

  return {
    el,
    tab: (id) => tabEls.find((t) => t.dataset.tab === id),
    focusCurrent() { tabEls[order(current)].focus(); },
    /** After the bar is in the DOM: keep focus on our tab if we arrived by hovering it. */
    claimFocus() {
      const want = pendingTab;
      pendingTab = null;
      if (want === current) { tabEls[order(current)].focus(); return true; }
      return false;
    },
    destroy() { clearInterval(tick); clearTimeout(dwell); },
    glideState: () => ({ ...glide }),
  };
}

/** Fade + slide a page in after a tab switch (the bar itself stays still). */
export function animateIn(page) {
  const dir = enterDirection;
  enterDirection = 0;
  if (!dir || !page) return false;
  page.style.transition = 'none';
  page.style.opacity = '0';
  page.style.transform = `translateX(${dir * PAGE_SHIFT}px)`;
  void page.offsetWidth;
  page.style.transition = `opacity ${PAGE_MS}ms var(--ease-out) ${PAGE_DELAY_MS}ms, transform ${PAGE_MS}ms var(--ease-out) ${PAGE_DELAY_MS}ms`;
  page.style.opacity = '1';
  page.style.transform = 'none';
  return true;
}

/**
 * Mount a section screen: top bar + page container, section background, entry animation, and
 * artwork tinting (focusing any element with data-art re-tints the background).
 * @returns {{ bar, page, el }}
 */
export function mountSection(root, current, opts = {}) {
  const el = document.createElement('div');
  el.className = `section-screen section-${current}`;
  const bar = createTopBar(current, opts);
  const page = document.createElement('div');
  page.className = 'section-page';
  el.append(bar.el, page);
  root.appendChild(el);
  backdrop.setSection(current);
  bar.claimFocus();
  animateIn(page);
  page.addEventListener('focusin', (e) => {
    const art = e.target.closest && e.target.closest('[data-art]');
    if (art && art.dataset.art) backdrop.tint(art.dataset.art);
  });
  return { bar, page, el };
}

export const _state = () => ({ enterDirection, lastX, lastW, glideHandoff, pendingTab });
export function _reset() {
  enterDirection = 0; lastX = -1; lastW = -1; glideHandoff = false; pendingTab = null; navigate = defaultNavigate;
}
