// @vitest-environment jsdom
// The TV guide (EpgGrid.java, Guide.java, BrowseActivity enterGuide / exitGuide / guideListener /
// showProgrammeDetails): layout maths, time paging, time-aligned ▲▼, lazy listings and the cache,
// OK = watch vs hold OK = details, Back / ◀ out, focus memory.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, categories: vi.fn(), streams: vi.fn(), epg: vi.fn(async () => []) };
});

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as filters from '../js/filters.js';
import * as nav from '../js/nav.js';
import * as B from '../js/browse.js';
import * as Guide from '../js/guide.js';
import * as G from '../js/ui/epg-grid.js';
import * as toast from '../js/ui/toast.js';
import { router } from '../js/router.js';
import { shim } from '../js/avplay-shim.js';
import { liveView } from '../js/views/live.js';
import * as topbar from '../js/ui/topbar.js';
import { stageLayout } from '../js/views/browse.js';
import { seedLibrary } from './helpers.js';
import { isOpen as dialogOpen } from '../js/ui/dialog.js';
import { u } from '../js/ui/theme.js';

const K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, MENU: 10133, INFO: 457, CH_UP: 427, CH_DOWN: 428 };
const ev = (keyCode, type = 'keydown', extra = {}) => {
  const e = new KeyboardEvent(type, { keyCode, bubbles: true, cancelable: true, ...extra });
  Object.defineProperty(e, 'keyCode', { value: keyCode });
  return e;
};
const press = (k, extra) => (document.activeElement || document.body).dispatchEvent(ev(k, 'keydown', extra));
const release = (k) => document.dispatchEvent(ev(k, 'keyup'));
const settle = async () => { for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0); };
const wait = async (ms) => { await vi.advanceTimersByTimeAsync(ms); await settle(); };
const ok = async () => { press(K.ENTER); release(K.ENTER); await settle(); };
const holdOk = async () => { press(K.ENTER); await vi.advanceTimersByTimeAsync(460); release(K.ENTER); await settle(); };

const T0 = Math.floor(Date.UTC(2026, 10, 12, 19, 40) / 1000); // 19:40 UTC
const HALF = 1800;
const P = (start, stop, title, desc = '') => ({
  start, stop, title, desc,
  timeRange() { return G.hm(start) + ' – ' + G.hm(stop); },
  progress() { const n = Date.now() / 1000; return Math.max(0, Math.min(1, (n - start) / (stop - start))); },
});
/** Listings per channel id: fresh objects each call, as the API gives. */
const LISTINGS = {
  10: () => [P(T0 - 600, T0 + 1200, 'News at Eight', 'The news.'), P(T0 + 1200, T0 + 3000, 'Sport'), P(T0 + 3000, T0 + 9000, 'Film')],
  11: () => [P(T0 - 2400, T0 + 300, 'Quiz'), P(T0 + 300, T0 + 2100, 'Drama'), P(T0 + 3300, T0 + 6000, 'Late Show')], // a gap 2100-3300
  12: () => [],
};

const CAT = (id, name) => ({ type: 'cat', id, name });
const CH = (id, cat) => ({ type: 'live', id: String(id), name: `Channel ${id}`, num: String(id), categoryId: cat, icon: `http://x/${id}.png` });
const LIVE_CATS = [CAT('1', 'UK | News'), CAT('2', 'Big')];
const BIG = Array.from({ length: 400 }, (_, i) => CH(1000 + i, '2'));
const LIVE = [CH(10, '1'), CH(11, '1'), CH(12, '1'), ...BIG];

let root; let onKeydown;
const view = () => router.current().view;
const st = () => view()._state();
const guideEl = () => root.querySelector('.b-guide');
const selRowId = () => root.querySelector('.g-row.sel')?.dataset.ch;
const hlTitle = () => root.querySelector('.g-row.sel .g-prog.hl')?.textContent ?? null;
const focusedItem = () => document.activeElement.closest('[data-id]')?.dataset.id;

/** Live TV, category 'UK | News' (or Big), first channel focused. */
async function openList(catDowns = 4) {
  router.go('live', {});
  await settle();
  for (let i = 0; i < catDowns; i++) press(K.DOWN);
  await ok();
  await settle();
}
async function openGuide(catDowns) {
  await openList(catDowns);
  press(K.RIGHT);
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0 * 1000);
  localStorage.clear();
  localStorage.setItem('coach_asked', 'true');
  document.body.innerHTML = '<div id="root"></div><object id="av" type="application/avplayer" hidden></object>';
  root = document.getElementById('root');
  vi.clearAllMocks();
  shim.reset();
  filters._reset();
  topbar._reset();
  Guide._reset();
  delete globalThis.webapis;
  delete globalThis.tizen;
  store.saveAccount({ id: '', name: 'T', server: 'http://srv', user: 'u', pass: 'p', ok: true });
  store.setCurrent('');
  api.epg.mockImplementation(async (id) => (LISTINGS[id] ? LISTINGS[id]() : [P(T0 - 300, T0 + 1500, `Show ${id}`)]));
  seedLibrary({ live: LIVE, movie: [], series: [], cats: { live: LIVE_CATS, movie: [], series: [] } });
  router.init(root);
  router.register('live', liveView);
  router.register('player-live', () => ({ mount() {}, unmount() {} }));
  router.register('home', () => ({ mount() {}, unmount() {} }));
  onKeydown = (e) => { if (router.onKey(e)) return; nav.onKey(e); };
  document.addEventListener('keydown', onKeydown);
});

afterEach(() => {
  for (let i = 0; i < 5 && dialogOpen(); i++) window.dispatchEvent(ev(27));
  router.reset();
  document.removeEventListener('keydown', onKeydown);
  toast.hide();
  vi.useRealTimers();
});

// ------------------------------------------------------------------ layout maths

describe('cell layout (EpgGrid.onDraw)', () => {
  const ws = 1000 * HALF; const gridX = 500; const per = 0.2;
  it('start / duration → x / width, inset by half the 3u gap each side', () => {
    const r = G.cellRect({ start: ws + 600, stop: ws + 2400 }, ws, gridX, per);
    expect(r.left).toBeCloseTo(gridX + 600 * per + G.GAP / 2);
    expect(r.width).toBeCloseTo(1800 * per - G.GAP);
  });
  it('clipped at the left edge of the window (started before it)', () => {
    const r = G.cellRect({ start: ws - 900, stop: ws + 900 }, ws, gridX, per);
    expect(r.left).toBeCloseTo(gridX + G.GAP / 2);
    expect(r.width).toBeCloseTo(900 * per - G.GAP);
    expect(r.start).toBe(ws);
  });
  it('clipped at the right edge (runs past the two hours)', () => {
    const r = G.cellRect({ start: ws + 6000, stop: ws + 9000 }, ws, gridX, per);
    expect(r.left + r.width + G.GAP / 2).toBeCloseTo(gridX + G.WINDOW * per);
    expect(r.end).toBe(ws + G.WINDOW);
  });
  it('nothing for programmes wholly outside the window', () => {
    expect(G.cellRect({ start: ws - 900, stop: ws }, ws, gridX, per)).toBeNull();
    expect(G.cellRect({ start: ws + G.WINDOW, stop: ws + G.WINDOW + 60 }, ws, gridX, per)).toBeNull();
  });
  it('a title only when 20u is left after the 2 x 12u padding', () => {
    expect(G.showsTitle(u(44))).toBe(true);
    expect(G.showsTitle(u(43))).toBe(false);
  });
  it('window aligned to the half hour; the stage layout puts the guide under a 38 % info strip', () => {
    expect(G.floorHalf(T0)).toBe(T0 - 600);
    const L = stageLayout('guide', 1920, 951);
    expect(L.info.h).toBe(Math.round(951 * 0.38));
    expect(L.guide.y).toBeCloseTo(u(16) + L.info.h + u(12));
    expect(L.cats.x).toBeLessThan(0); // folded away to the left
    expect(L.logo.w).toBe(Math.round((L.info.h - u(56)) * 16 / 9));
    expect(L.guide.y + L.guide.h + u(40) + u(24)).toBeCloseTo(951);
  });
});

describe('time paging (EpgGrid ◀ ▶)', () => {
  const now = T0; const ws = G.floorHalf(T0);
  it('▶ goes to the start of the next programme (+1 s)', () => {
    expect(G.stepRight(now, ws, { start: now - 60, stop: now + 600 }, now)).toEqual({ cursor: now + 601, windowStart: ws });
  });
  it('▶ in a gap or with no listings: +30 min', () => {
    expect(G.stepRight(now, ws, null, now).cursor).toBe(now + HALF + 1);
  });
  it('▶ moves the window on by half hours to keep the cursor 5 min clear of its end', () => {
    const r = G.stepRight(now, ws, { start: now, stop: ws + 7000 }, now);
    expect(r.cursor).toBe(ws + 7001);
    expect(r.windowStart).toBe(ws + HALF);
  });
  it('▶ stops 24 h ahead', () => {
    expect(G.stepRight(now + 86000, ws, { start: now + 85000, stop: now + 86500 }, now)).toBeNull();
  });
  it('◀ on what is on now leaves the guide', () => {
    expect(G.stepLeft(now, ws, { start: now - 60, stop: now + 60 }, now)).toEqual({ exit: true });
    expect(G.stepLeft(now + 600, ws, null, now)).toEqual({ exit: true }); // a gap within 30 min of now
  });
  it('◀ on a later programme: into the one before it, never before now; the window follows back', () => {
    const p = { start: ws + 9000, stop: ws + 9600 };
    const r = G.stepLeft(ws + 9100, ws + 3 * HALF, p, now);
    expect(r.cursor).toBe(ws + 8999);
    expect(r.windowStart).toBe(ws + 3 * HALF);
    const back = G.stepLeft(ws + 4000, ws + 2 * HALF, { start: ws + 3000, stop: ws + 5000 }, now);
    expect(back.cursor).toBe(ws + 2999);
    expect(back.windowStart).toBe(ws + HALF);
    expect(G.stepLeft(now + 4000, ws + HALF, { start: now + 1, stop: now + 5000 }, now).windowStart).toBe(ws); // not before now's half hour
  });
  it('rows: one row of context above and below (moveRow), listings for 2 above to 4 below', () => {
    expect(G.scrollTop(5, 4, 3, 100)).toBe(4);
    expect(G.scrollTop(6, 4, 3, 100)).toBe(5);
    expect(G.scrollTop(4, 4, 3, 100)).toBe(3);
    expect(G.scrollTop(99, 97, 3, 100)).toBe(97);
    expect(G.listingRange(10, 3, 100)).toEqual([8, 17]);
    expect(G.listingRange(0, 3, 5)).toEqual([0, 5]);
  });
});

// ------------------------------------------------------------------ Guide.java

describe('listings (Guide.java)', () => {
  it('tidy: drops invalid ones, sorts, drops duplicates, trims overlaps', () => {
    const l = Guide.tidy([P(300, 400, 'c'), P(100, 200, 'a'), P(0, 50, 'x'), P(150, 150, 'y'), P(120, 180, 'dup'), P(180, 300, 'b')]);
    expect(l.map((p) => [p.title, p.start, p.stop])).toEqual([['a', 100, 200], ['b', 200, 300], ['c', 300, 400]]);
  });
  it('get_short_epg limit 24, three at a time, each channel once, cached 30 min', async () => {
    let release$; const gate = new Promise((r) => { release$ = r; });
    api.epg.mockImplementation(async () => { await gate; return [P(T0, T0 + 60, 'x')]; });
    const done = vi.fn();
    Guide.load([CH(1), CH(2), CH(3), CH(4), CH(5)], done);
    Guide.load([CH(1), CH(2), CH(3), CH(4), CH(5)], done); // already on the way
    await settle();
    expect(api.epg).toHaveBeenCalledTimes(3);
    expect(api.epg.mock.calls.every((c) => c[1] === 24)).toBe(true);
    expect(Guide.get('1')).toBeNull();
    release$();
    await settle();
    expect(api.epg).toHaveBeenCalledTimes(5);
    expect(done).toHaveBeenCalledTimes(5);
    expect(Guide.get('4')[0].title).toBe('x');
    Guide.load([CH(1)], done);
    await wait(29 * 60000);
    Guide.load([CH(1)], done);
    expect(api.epg).toHaveBeenCalledTimes(5); // still fresh
    await wait(2 * 60000);
    Guide.load([CH(1)], done);
    await settle();
    expect(api.epg).toHaveBeenCalledTimes(6); // stale after 30 min
  });
  it('the newest request is served first, and queued channels no longer in view are dropped', async () => {
    const gates = [];
    api.epg.mockImplementation((id) => new Promise((r) => { gates.push(() => r([P(T0, T0 + 60, `p${id}`)])); }));
    const asked = () => api.epg.mock.calls.map((c) => c[0]);
    Guide.load([CH(1), CH(2), CH(3), CH(4), CH(5), CH(6)]); // 1-3 start, 4-6 wait
    await settle();
    expect(asked()).toEqual(['1', '2', '3']);
    Guide.load([CH(6), CH(7), CH(8)]); // scrolled on: 4 and 5 are gone, 6 is still wanted
    expect(Guide._state().queued).toEqual(['7', '8', '6']);
    expect(Guide._state().loading.some((k) => k.endsWith('|4') || k.endsWith('|5'))).toBe(false);
    gates.splice(0).forEach((g) => g());
    await settle();
    expect(asked()).toEqual(['1', '2', '3', '7', '8', '6']); // the rows on screen now, before the older one
    gates.splice(0).forEach((g) => g());
    await settle();
    expect(Guide.get('4')).toBeNull(); // dropped, not fetched
    expect(Guide.get('8')[0].title).toBe('p8');
    Guide.load([CH(4)]); // back in view: asked for again
    await settle();
    expect(asked()).toEqual(['1', '2', '3', '7', '8', '6', '4']);
  });
  it('listings are kept per account, and clear() forgets them (account switch / remove / login)', async () => {
    const first = store.newAccount(); Object.assign(first, { server: 'http://a', user: 'u', pass: 'p', ok: true }); store.saveAccount(first);
    const second = store.newAccount(); Object.assign(second, { server: 'http://b', user: 'u', pass: 'p', ok: true }); store.saveAccount(second);
    store.setCurrent(first.id);
    api.epg.mockImplementation(async () => [P(T0, T0 + 60, `on ${store.server()}`)]);
    Guide.load([CH(1)]);
    await settle();
    expect(Guide.get('1')[0].title).toBe('on http://a');
    store.setCurrent(second.id); // same stream id, another provider
    expect(Guide.get('1')).toBeNull();
    Guide.load([CH(1)]);
    await settle();
    expect(api.epg).toHaveBeenCalledTimes(2);
    expect(Guide.get('1')[0].title).toBe('on http://b');
    store.setCurrent(first.id);
    expect(Guide.get('1')[0].title).toBe('on http://a');
    Guide.clear();
    expect(Guide.get('1')).toBeNull();
    expect(Guide._state().cached).toEqual([]);
  });
  it('a failed request is kept as "no listings"', async () => {
    api.epg.mockRejectedValueOnce(new Error('x'));
    Guide.load([CH(7)]);
    await settle();
    expect(Guide.get('7')).toEqual([]);
  });
});

// ------------------------------------------------------------------ the screen

describe('the TV guide in Live TV', () => {
  it('▶ from the channel list opens it: layout morphs, guide focused on the channel, highlight on now', async () => {
    await openGuide();
    expect(root.querySelector('.browse').dataset.mode).toBe('guide');
    expect(document.activeElement).toBe(guideEl());
    expect(guideEl().hidden).toBe(false);
    expect(root.querySelector('.b-cats').classList.contains('faded')).toBe(true);
    expect(root.querySelector('.b-mid').classList.contains('faded')).toBe(true);
    expect(root.querySelector('.b-cats').style.transition).toContain(`left ${B.LAYOUT_MS}ms`);
    expect(root.querySelector('.b-guide-hint').textContent).toBe(B.GUIDE_HINT);
    expect(root.querySelector('.b-hint').textContent).toBe(B.GUIDE_PANEL_HINT);
    expect(selRowId()).toBe('10');
    expect(hlTitle()).toBe('News at Eight');
    expect(root.querySelector('.b-now').textContent).toBe('News at Eight');
    expect(root.querySelector('.b-time').textContent).toBe(`${G.hm(T0 - 600)} – ${G.hm(T0 + 1200)}`);
    expect(root.querySelector('.b-progress i')).not.toBeNull();
    expect(root.querySelector('.b-next').textContent).toBe(`${G.hm(T0 + 1200)}   Sport`);
    await wait(B.LAYOUT_MS + 30);
    expect(root.querySelector('.b-cats').style.visibility).toBe('hidden');
    // header: date + time, half-hour marks from the window start, the now line inside it
    expect(root.querySelector('.g-date').textContent).toBe(`${G.dayLabel(T0)}   ${G.hm(T0)}`);
    expect([...root.querySelectorAll('.g-time span')].map((s) => s.textContent))
      .toEqual([0, 1, 2, 3].map((i) => G.hm(T0 - 600 + i * HALF)));
    expect(root.querySelector('.g-now').hidden).toBe(false);
  });

  it('▶ on a channel in the middle of the list keeps it selected and in view', async () => {
    await openList(5);
    for (let i = 0; i < 5; i++) press(K.DOWN);
    press(K.RIGHT); await settle();
    expect(selRowId()).toBe('1005');
    expect(st().guide.firstVisible()).toBe(4); // the list had it lower than the guide's 3 rows reach
  });

  it('programme cells: on now / later / highlighted, gaps left empty, "No information", "Loading…"', async () => {
    let hold$; api.epg.mockImplementation(async (id) => { if (id === '12') await new Promise((r) => { hold$ = r; }); return LISTINGS[id] ? LISTINGS[id]() : []; });
    await openGuide();
    const row = (id) => root.querySelector(`.g-row[data-ch="${id}"]`);
    expect(row('10').querySelectorAll('.g-prog').length).toBe(3);
    expect(row('11').querySelector('.g-prog.on-now').textContent).toBe('Quiz');
    expect(row('11').querySelectorAll('.g-prog:not(.on-now)').length).toBe(2);
    const late = [...row('11').querySelectorAll('.g-prog')].map((c) => parseFloat(c.style.left));
    expect(late[2] - late[1]).toBeGreaterThan(parseFloat(row('11').querySelectorAll('.g-prog')[1].style.width) + G.GAP); // the gap
    expect(row('12').querySelector('.g-none').textContent).toBe('Loading…');
    hold$(); await settle();
    expect(row('12').querySelector('.g-none').textContent).toBe('No information');
  });

  it('▲▼ keep the time: the programme on at the cursor in the next row', async () => {
    await openGuide();
    press(K.RIGHT); // Sport, from T0+1200
    expect(hlTitle()).toBe('Sport');
    press(K.DOWN);
    expect(selRowId()).toBe('11');
    expect(hlTitle()).toBe('Drama'); // on at T0+1201
    expect(root.querySelector('.b-time').textContent).toContain('   ·   later');
    press(K.RIGHT); // Drama ends T0+2100 → into the gap
    expect(hlTitle()).toBeNull();
    expect(root.querySelector('.b-now').textContent).toBe('No guide information');
    press(K.UP);
    expect(hlTitle()).toBe('Sport');
    press(K.CH_DOWN); press(K.CH_DOWN);
    expect(selRowId()).toBe('12');
    expect(root.querySelector('.g-row.sel .g-none.hl').textContent).toBe('No information');
    press(K.CH_UP);
    expect(selRowId()).toBe('11');
  });

  it('▲ on the first channel goes up into the top bar; ▼ from the tab comes back to the guide', async () => {
    await openGuide();
    press(K.UP); await settle();
    expect(st().zone).toBe('bar');
    expect(st().mode).toBe('guide');
    press(K.DOWN); await settle();
    expect(document.activeElement).toBe(guideEl());
  });

  it('▶ pages through time: the window moves on, ◀ comes back and leaves on what is on now', async () => {
    await openGuide();
    const g = st().guide;
    const ws = g.windowStart;
    for (let i = 0; i < 3; i++) press(K.RIGHT); // Sport, Film, then +30 min
    expect(g.windowStart).toBeGreaterThan(ws);
    expect(root.querySelector('.g-time span').textContent).toBe(G.hm(g.windowStart));
    press(K.LEFT); press(K.LEFT); press(K.LEFT);
    expect(hlTitle()).toBe('News at Eight');
    expect(g.windowStart).toBe(ws);
    press(K.LEFT); await settle();
    expect(st().mode).toBe('list');
    expect(focusedItem()).toBe('10');
  });

  it('OK (released quickly) watches the channel with the whole list as the queue, whatever programme is highlighted', async () => {
    await openGuide();
    press(K.DOWN); press(K.RIGHT);
    await ok();
    expect(router.current().name).toBe('player-live');
    const p = router.current().params;
    expect(p.channels.map((c) => c.id).slice(0, 3)).toEqual(['10', '11', '12']);
    expect(p.index).toBe(1);
  });

  it('hold OK: the programme details, "Watch {channel}" plays and "Close" stays', async () => {
    await openGuide();
    press(K.RIGHT); // Sport, later
    await holdOk();
    expect(dialogOpen()).toBe(true);
    expect(root.ownerDocument.querySelector('.dialog-title').textContent).toBe('Sport');
    const msg = document.querySelector('.dialog-message').textContent;
    expect(msg).toBe(`Channel 10\n${G.hm(T0 + 1200)} – ${G.hm(T0 + 3000)}   ·   Starts in 20 min`);
    expect([...document.querySelectorAll('.dialog button')].map((b) => b.textContent)).toEqual(['Close', 'Watch Channel 10']);
    expect(hlTitle()).toBe('Sport'); // the highlight stays under the dialog
    expect(router.current().name).toBe('live'); // the release did not play
    window.dispatchEvent(ev(K.ESC)); await settle(); // Close
    expect(dialogOpen()).toBe(false);
    expect(document.activeElement).toBe(guideEl());
    press(K.MENU); await settle(); // ☰ / Info do the same
    expect(dialogOpen()).toBe(true);
    [...document.querySelectorAll('.dialog button')][1].click(); await settle();
    expect(router.current().name).toBe('player-live');
  });

  it('details texts: on now with minutes left, hours ahead, no programme', () => {
    const ch = { name: 'BBC One' };
    expect(B.programmeDetails(ch, P(T0 - 60, T0 + 1500, 'News', 'Headlines.'), T0).message)
      .toBe(`BBC One\n${G.hm(T0 - 60)} – ${G.hm(T0 + 1500)}   ·   On now, 25 min left\n\nHeadlines.`);
    expect(B.programmeDetails(ch, P(T0 + 5430, T0 + 6000, 'Film'), T0).message).toContain('Starts in 1 hr 31 min');
    const none = B.programmeDetails(ch, null, T0);
    expect(none.title).toBe('BBC One');
    expect(none.message).toBe('BBC One\n\nNo guide information for this time.');
  });

  it('Back returns to the channel list on the same channel, where it was on screen', async () => {
    await openGuide();
    press(K.DOWN); press(K.DOWN);
    press(K.BACK); await settle();
    expect(st().mode).toBe('list');
    expect(focusedItem()).toBe('12');
    expect(root.querySelector('.b-hint').textContent).toBe(B.PANEL_HINT);
    await wait(B.LAYOUT_MS + 30);
    expect(guideEl().hidden).toBe(true);
    expect(root.querySelector('.b-cats').style.visibility).toBe('');
    press(K.BACK); await settle();
    expect(st().zone).toBe('cats');
  });

  it('thousands of channels: only the rows on screen exist, listings load as rows come into view', async () => {
    await openGuide(5); // "Big", 400 channels
    expect(st().items.length).toBe(400);
    expect(root.querySelectorAll('.g-row').length).toBeLessThan(20);
    const asked = () => new Set(api.epg.mock.calls.filter((c) => c[1] === 24).map((c) => c[0]));
    await settle();
    expect([...asked()].sort()).toEqual(['1000', '1001', '1002', '1003', '1004', '1005', '1006']);
    for (let i = 0; i < 30; i++) press(K.DOWN);
    await settle();
    expect(selRowId()).toBe('1030');
    expect(asked().has('1034')).toBe(true);
    expect(asked().has('1040')).toBe(false);
    expect(root.querySelectorAll('.g-row').length).toBeLessThan(20);
    const before = api.epg.mock.calls.length;
    for (let i = 0; i < 30; i++) press(K.UP);
    await settle();
    // rows that were fetched are cached; rows passed too quickly to be fetched were dropped from
    // the queue and are only asked for now that they are in view again: never the same one twice
    const all = api.epg.mock.calls.filter((c) => c[1] === 24).map((c) => c[0]);
    expect(all.length).toBe(new Set(all).size);
    expect(before).toBeGreaterThan(0);
  });

  it('one redraw or row move asks for the stage size once, not once per row', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const size = vi.fn(() => ({ w: 1400, h: 800 }));
    const grid = G.createEpgGrid({ el, size, listener: {} });
    grid.setChannels(BIG.slice(0, 200), 0, 0, 72);
    expect(el.querySelectorAll('.g-row').length).toBeGreaterThan(8);
    size.mockClear();
    grid.redraw();
    expect(size).toHaveBeenCalledTimes(1);
    for (const k of [K.DOWN, K.DOWN, K.RIGHT, K.UP]) {
      size.mockClear();
      grid.onKey(ev(k));
      expect(size).toHaveBeenCalledTimes(1);
    }
    size.mockClear();
    const paints = vi.spyOn(grid.vlist, 'refresh');
    for (let i = 0; i < 12; i++) grid.onKey(ev(K.DOWN)); // scrolls: each move is one paint
    expect(paints).toHaveBeenCalledTimes(12);
    expect(size).toHaveBeenCalledTimes(12);
    expect(el.querySelector('.g-row.sel').dataset.ch).toBe(String(1000 + 13));
    grid.destroy(); el.remove();
  });

  it('the now line and clock tick every 30 s', async () => {
    await openGuide();
    const x0 = parseFloat(root.querySelector('.g-now').style.left);
    await wait(G.TICK_MS);
    expect(parseFloat(root.querySelector('.g-now').style.left)).toBeGreaterThan(x0);
    expect(root.querySelector('.g-date').textContent).toBe(`${G.dayLabel(T0 + 30)}   ${G.hm(T0 + 30)}`);
  });

  it('coming back from the player: the guide is open again where it was', async () => {
    await openGuide();
    press(K.DOWN); press(K.RIGHT);
    await ok();
    expect(router.current().name).toBe('player-live');
    router.back(); await settle(); await settle();
    expect(st().mode).toBe('guide');
    expect(document.activeElement).toBe(guideEl());
    expect(selRowId()).toBe('11');
    expect(hlTitle()).toBe('Drama');
  });

  it('the preview carries on into the guide and moves with its box', async () => {
    await openList(4);
    await wait(B.PREVIEW_DELAY_MS + 10);
    expect(shim.names()).toContain('open');
    const opens = shim.names().filter((n) => n === 'open').length;
    press(K.RIGHT); await settle();
    await wait(B.PREVIEW_DELAY_MS + 10);
    expect(shim.names().filter((n) => n === 'open').length).toBe(opens); // same channel: not restarted
    press(K.DOWN); await wait(B.PREVIEW_DELAY_MS + 10);
    expect(shim.names().filter((n) => n === 'open').length).toBe(opens + 1); // next channel's preview
  });
});
