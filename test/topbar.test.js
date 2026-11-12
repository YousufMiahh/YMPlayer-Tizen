// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRouter, router } from '../js/router.js';
import * as nav from '../js/nav.js';
import * as topbar from '../js/ui/topbar.js';

const { createTopBar, mountSection, DWELL_MS, setNavigator, _reset, _state, clockText } = topbar;

const keydown = (el, keyCode, extra = {}) => {
  const e = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true, ...extra });
  el.dispatchEvent(e);
  return e;
};

function box(el, x, y, w = 100, h = 50) {
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y });
  return el;
}

let host;
beforeEach(() => {
  _reset();
  document.body.innerHTML = '<div id="root"></div>';
  host = document.getElementById('root');
});
afterEach(() => { vi.useRealTimers(); _reset(); });

describe('top bar markup', () => {
  it('has the YM mark, the six Android tabs in order, and an HH:mm clock', () => {
    const bar = createTopBar('movies');
    host.appendChild(bar.el);
    expect(bar.el.querySelector('.tb-brand').textContent).toBe('YM');
    const tabs = [...bar.el.querySelectorAll('.tb-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Home', 'Live TV', 'Movies', 'Series', 'Search', 'Settings']);
    expect(tabs.filter((t) => t.classList.contains('current')).map((t) => t.dataset.tab)).toEqual(['movies']);
    expect(bar.el.querySelector('.tb-clock').textContent).toMatch(/^\d\d:\d\d$/);
  });

  it('clock is 24-hour HH:mm', () => {
    expect(clockText(new Date(2026, 0, 1, 7, 5))).toBe('07:05');
    expect(clockText(new Date(2026, 0, 1, 19, 45))).toBe('19:45');
  });
});

describe('dwell to open', () => {
  let calls;
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    setNavigator((from, to) => calls.push([from, to]));
  });

  it('resting on a tab for 450 ms opens it', () => {
    const bar = createTopBar('home');
    host.appendChild(bar.el);
    bar.tab('movies').focus();
    vi.advanceTimersByTime(DWELL_MS - 1);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([['home', 'movies']]);
    expect(_state().pendingTab).toBe('movies'); // the new screen keeps focus on its tab
    expect(_state().enterDirection).toBe(1);
  });

  it('moving on before 450 ms cancels the open', () => {
    const bar = createTopBar('home');
    host.appendChild(bar.el);
    bar.tab('live').focus();
    vi.advanceTimersByTime(300);
    bar.tab('movies').focus();
    vi.advanceTimersByTime(300);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(calls).toEqual([['home', 'movies']]);
  });

  it('Settings and the current tab never open by dwell', () => {
    const bar = createTopBar('live');
    host.appendChild(bar.el);
    bar.tab('settings').focus();
    vi.advanceTimersByTime(2000);
    bar.tab('live').focus();
    vi.advanceTimersByTime(2000);
    expect(calls).toEqual([]);
  });

  it('OK opens Settings, and OK on the current tab calls onReselect', () => {
    const onReselect = vi.fn();
    const bar = createTopBar('live', { onReselect });
    host.appendChild(bar.el);
    bar.tab('live').focus();
    keydown(bar.tab('live'), 13);
    expect(onReselect).toHaveBeenCalledTimes(1);
    bar.tab('settings').focus();
    keydown(bar.tab('settings'), 13);
    expect(calls).toEqual([['live', 'settings']]);
    expect(_state().pendingTab).toBe(null); // by OK: the new screen focuses its content
  });
});

describe('keys on the bar', () => {
  it('Left/Right walk the tabs and stop at the ends; Up does nothing; keys do not leak', () => {
    const bar = createTopBar('home');
    host.appendChild(bar.el);
    const leak = vi.fn();
    document.addEventListener('keydown', leak);
    bar.tab('home').focus();
    keydown(bar.tab('home'), 37);
    expect(document.activeElement.dataset.tab).toBe('home');
    keydown(document.activeElement, 39);
    expect(document.activeElement.dataset.tab).toBe('live');
    keydown(document.activeElement, 38);
    expect(document.activeElement.dataset.tab).toBe('live');
    bar.tab('settings').focus();
    keydown(document.activeElement, 39);
    expect(document.activeElement.dataset.tab).toBe('settings');
    expect(leak).not.toHaveBeenCalled();
    document.removeEventListener('keydown', leak);
  });

  it('Down uses onDown when the screen gives one', () => {
    const onDown = vi.fn();
    const bar = createTopBar('live', { onDown });
    host.appendChild(bar.el);
    bar.tab('live').focus();
    keydown(bar.tab('live'), 40);
    expect(onDown).toHaveBeenCalledTimes(1);
  });

  it('Up from the page always lands on the current tab, never the tab above', () => {
    const { bar, page } = mountSection(host, 'movies');
    bar.el.querySelectorAll('.tb-tab').forEach((t, i) => box(t, 300 + i * 200, 0, 180, 50));
    const item = box(document.createElement('button'), 300, 300); // right under "Home"
    page.appendChild(item);
    nav.register(host);
    item.focus();
    expect(nav.moveFocus('up')).toBe(true);
    expect(document.activeElement.dataset.tab).toBe('movies');
    // Left/Right from the page never jump into the bar
    item.focus();
    expect(nav.moveFocus('left')).toBe(false);
  });
});

describe('section stack model (TopBar.go)', () => {
  const stub = (name) => () => ({ mount(r) { const d = document.createElement('div'); d.id = name; r.appendChild(d); }, unmount() {} });
  let r;
  beforeEach(() => {
    vi.useFakeTimers();
    r = router;
    r.init(host);
    for (const n of ['home', 'live', 'movies', 'series', 'search', 'settings']) r.register(n, stub(n));
    r.go('home');
  });
  afterEach(() => r.reset());

  it('Home -> X pushes, X -> Y replaces, -> Home pops back to Home', () => {
    topbar.go('home', 'live');
    expect(r.current().name).toBe('live');
    expect(r.stackDepth()).toBe(2);
    topbar.go('live', 'series');
    expect(r.current().name).toBe('series');
    expect(r.stackDepth()).toBe(2);
    topbar.go('series', 'home');
    expect(r.current().name).toBe('home');
    expect(r.stackDepth()).toBe(1);
    expect(_state().enterDirection).toBe(-1); // Home lies to the left
  });

  it('back from any section is Home', () => {
    topbar.go('home', 'movies');
    topbar.go('movies', 'search');
    r.back();
    expect(r.current().name).toBe('home');
  });
});

describe('mountSection', () => {
  it('slides the page in from the side you moved towards, then clears the pending direction', () => {
    setNavigator(() => {});
    topbar.go('home', 'settings');
    const { page } = mountSection(host, 'settings');
    expect(page.style.transition).toContain('420ms');
    expect(page.style.transition).toContain('60ms');
    expect(_state().enterDirection).toBe(0);
    const again = mountSection(document.body, 'settings');
    expect(again.page.style.transition).toBe('');
  });

  it('keeps focus on its own tab when arrived by hovering', () => {
    vi.useFakeTimers();
    setNavigator(() => {});
    const bar = createTopBar('home');
    host.appendChild(bar.el);
    bar.tab('live').focus();
    vi.advanceTimersByTime(DWELL_MS);
    host.replaceChildren();
    const s = mountSection(host, 'live');
    expect(document.activeElement).toBe(s.bar.tab('live'));
    expect(topbar.tabFocused()).toBe(true);
  });

  it('the highlight shows on the focused tab and fades when focus leaves the bar', () => {
    const { bar, page } = mountSection(host, 'home');
    const card = document.createElement('button');
    page.appendChild(card);
    bar.tab('live').focus();
    expect(bar.glideState().shown).toBe(true);
    expect(bar.el.querySelector('.tb-pill-face').style.opacity).toBe('1');
    card.focus();
    expect(bar.glideState().shown).toBe(false);
    expect(bar.el.querySelector('.tb-pill-face').style.opacity).toBe('0');
  });
});

describe('router additions', () => {
  const stub = (name) => () => ({ mount(r) { r.textContent = name; }, unmount() {} });
  it('replace swaps the top entry; backTo pops; resetTo clears', () => {
    const r = createRouter(); r.init(host);
    for (const n of ['a', 'b', 'c']) r.register(n, stub(n));
    r.go('a'); r.go('b');
    r.replace('c');
    expect(r.stackDepth()).toBe(2);
    expect(host.textContent).toBe('c');
    r.backTo('a');
    expect(r.stackDepth()).toBe(1);
    expect(host.textContent).toBe('a');
    r.go('b');
    r.resetTo('c');
    expect(r.stackDepth()).toBe(1);
    r.backTo('a'); // not in the stack: becomes the only entry
    expect(r.current().name).toBe('a');
    expect(r.stackDepth()).toBe(1);
  });
});
