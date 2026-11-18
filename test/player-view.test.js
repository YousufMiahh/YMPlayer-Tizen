// @vitest-environment jsdom
// The full-screen player (PlayerActivity.java) on the real engine (js/player.js) and the AVPlay shim.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (orig) => ({ ...(await orig()), epg: vi.fn(), seriesInfo: vi.fn() }));
vi.mock('../js/tmdb.js', async (orig) => ({ ...(await orig()), findId: vi.fn() }));
vi.mock('../js/intros.js', async (orig) => ({ ...(await orig()), get: vi.fn() }));

import * as api from '../js/api.js';
import * as tmdb from '../js/tmdb.js';
import * as intros from '../js/intros.js';
import * as store from '../js/store.js';
import * as player from '../js/player.js';
import { shim } from '../js/avplay-shim.js';
import { router } from '../js/router.js';
import * as coach from '../js/ui/coach.js';
import {
  playerView, queueOf, scrubStep, burstText, scrubText, KEY, VOD_HINT, SCRUB_HINT, LIVE_HINT, COACH_LIVE,
} from '../js/views/player.js';
import { createNextUpCard, COUNTDOWN_MS } from '../js/ui/nextup.js';
import { style as subStyle, cleanText } from '../js/ui/subtitles.js';

const CH = [
  { type: 'live', id: '10', name: 'BBC One', num: '101', icon: 'http://x/bbc.png' },
  { type: 'live', id: '11', name: 'Sky News', num: '102' },
  { type: 'live', id: '12', name: 'Film4', num: '103' },
];
const MOVIE = { type: 'movie', id: '7', name: 'Heat', ext: 'mkv' };
const EPS = [1, 2, 3].map((n) => ({ type: 'episode', id: String(900 + n), name: `Chapter ${n}`, num: String(n), ext: 'mp4', parentId: '55', parentName: 'Dark', parentIcon: 'http://x/dark.jpg' }));
const prog = (title, start, stop) => ({ title, start, stop, timeRange: () => (start ? `${start} – ${stop}` : ''), progress: () => 0.4 });

let root; let opened;
const opens = () => shim.calls.filter((c) => c.name === 'open').map((c) => c.args[0]);
const view = () => router.current().view;
const $ = (s) => document.querySelector(s);
const txt = (s) => ($(s) ? $(s).textContent : null);
const visible = (s) => { const e = $(s); return !!e && !e.hidden && !e.classList.contains('out'); };

function onKeydown(e) {
  if (router.onKey(e)) return;
  if (e.keyCode === KEY.BACK) { const v = view(); if (!(v && v.onBack && v.onBack())) router.back(); }
}
const down = (keyCode, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode, cancelable: true, bubbles: true, ...extra }));
const up = (keyCode) => document.dispatchEvent(new KeyboardEvent('keyup', { keyCode, cancelable: true, bubbles: true }));
const press = (keyCode, n = 1) => { for (let i = 0; i < n; i++) { down(keyCode); up(keyCode); } };
const hold = (keyCode, ms = 600) => { down(keyCode); vi.advanceTimersByTime(ms); down(keyCode, { repeat: true }); up(keyCode); };
const later = (ms) => vi.advanceTimersByTime(ms);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('coach_asked', 'true');
  const a = store.newAccount();
  Object.assign(a, { server: 'http://h.com:80', user: 'u', pass: 'p', ok: true });
  store.saveAccount(a);
  player.stop();
  shim.reset();
  globalThis.webapis = { avplay: shim };
  document.body.innerHTML = '<div id="root"></div><object id="av" type="application/avplayer" hidden></object>';
  root = document.getElementById('root');
  api.seriesInfo.mockReset(); api.seriesInfo.mockResolvedValue(null);
  tmdb.findId.mockReset(); tmdb.findId.mockResolvedValue(null);
  intros.get.mockReset(); intros.get.mockResolvedValue(intros.NONE);
  api.epg.mockReset();
  api.epg.mockResolvedValue([prog('Evening News', 1700000000, 1700003600), prog('Weather', 1700003600, 1700003900)]);
  router.init(root);
  router.register('home', () => ({ mount(r) { r.textContent = 'home'; }, unmount() {} }));
  router.register('player-live', playerView);
  router.register('player-vod', playerView);
  router.go('home');
  document.addEventListener('keydown', onKeydown);
  opened = null;
});
afterEach(() => {
  document.removeEventListener('keydown', onKeydown);
  router.reset();
  vi.useRealTimers();
});

const live = (index = 0, channels = CH) => router.go('player-live', { channels, index });
const vod = (queue, index = 0, d = 3600000) => { shim.duration = d; router.go('player-vod', { queue, index }); };

describe('helpers', () => {
  it('queueOf takes Open.play params and the older shapes', () => {
    expect(queueOf({ queue: EPS, index: 1 })).toEqual({ queue: EPS, index: 1 });
    expect(queueOf({ item: EPS[2], queue: EPS })).toEqual({ queue: EPS, index: 2 });
    expect(queueOf({ channels: CH, index: 2 })).toEqual({ queue: CH, index: 2 });
    expect(queueOf({ item: MOVIE })).toEqual({ queue: [MOVIE], index: 0 });
  });
  it('scrub steps: max(10 s, d/120) at 1x, 2x, 4x, 8x by repeat count', () => {
    expect(scrubStep(600000, 0)).toBe(10000); // short film: the 10 s floor
    expect([0, 2, 3, 7, 8, 15, 16, 40].map((r) => scrubStep(3600000, r))).toEqual([30000, 30000, 60000, 60000, 120000, 120000, 240000, 240000]);
  });
  it('bubble and scrub texts', () => {
    expect(burstText(10000)).toBe('+10 sec');
    expect(burstText(-20000)).toBe('−20 sec');
    expect(burstText(90000)).toBe('+1:30');
    expect(scrubText(3725000, 3600000)).toBe('1:02:05   +2:05');
    expect(scrubText(60000, 120000)).toBe('1:00   −1:00');
    expect(scrubText(60400, 60000)).toBe('1:00');
  });
});

describe('live', () => {
  it('tunes the channel, records history and shows the banner (number, name ♥, now, time + bar, next, hint)', async () => {
    store.toggleFav(CH[0]);
    live(0);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/10.ts']);
    expect(store.history(true)[0].id).toBe('10');
    expect($('#av').hidden).toBe(false);
    expect(visible('.pl-banner')).toBe(true);
    expect(txt('.pl-live-num')).toBe('101');
    expect(txt('.pl-live-name')).toBe('BBC One  ♥');
    expect($('.pl-logo').getAttribute('src')).toBe('http://x/bbc.png');
    expect(txt('.pl-live-hint')).toBe(LIVE_HINT);
    await flush();
    expect(api.epg).toHaveBeenCalledWith('10');
    expect(txt('.pl-live-now')).toBe('Evening News');
    expect(txt('.pl-live-time')).toBe('1700000000 – 1700003600');
    expect($('.pl-live-bar').style.visibility).toBe('');
    expect(txt('.pl-live-next')).toBe('Next   17000   Weather');
  });
  it('"No guide information" when there are no listings; the bar stays hidden', async () => {
    api.epg.mockResolvedValue([]);
    live(1);
    await flush();
    expect(txt('.pl-live-now')).toBe('No guide information');
    expect($('.pl-live-bar').style.visibility).toBe('hidden');
    expect(txt('.pl-live-num')).toBe('102');
  });
  it('the banner hides 6 s after it shows (then fades for 250 ms)', () => {
    live(0);
    later(5900);
    expect(visible('.pl-banner')).toBe(true);
    later(100);
    expect(visible('.pl-banner')).toBe(false);
    later(250);
    expect($('.pl-banner').hidden).toBe(true);
  });
  it('▼ zaps: the banner at once, the stream 350 ms after the last press; the old one stops first', () => {
    live(0);
    press(KEY.DOWN);
    expect(txt('.pl-live-name')).toBe('Sky News');
    expect(opens()).toHaveLength(1);
    later(200);
    press(KEY.DOWN); // fast skipping: only the last one is tuned
    expect(txt('.pl-live-name')).toBe('Film4');
    later(349);
    expect(opens()).toHaveLength(1);
    later(1);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/10.ts', 'http://h.com:80/live/u/p/12.ts']);
    const n = shim.names();
    const reopen = n.lastIndexOf('open');
    expect(n.lastIndexOf('stop')).toBeLessThan(reopen);
    expect(n.lastIndexOf('close')).toBeLessThan(reopen);
    expect(n.lastIndexOf('stop')).toBeGreaterThan(n.indexOf('play'));
  });
  it('▲ and CH+ go back in the list, ▼ and CH− forward; both wrap', () => {
    live(0);
    press(KEY.UP);
    expect(txt('.pl-live-name')).toBe('Film4');
    press(KEY.CH_DOWN);
    expect(txt('.pl-live-name')).toBe('BBC One');
    press(KEY.CH_UP);
    expect(txt('.pl-live-name')).toBe('Film4');
    press(KEY.DOWN);
    later(350);
    expect(opens().at(-1)).toBe('http://h.com:80/live/u/p/10.ts');
  });
  it('one channel: no zapping', () => {
    live(0, [CH[1]]);
    press(KEY.DOWN);
    later(400);
    expect(opens()).toHaveLength(1);
  });
  it('◀ ▶ and INFO show the banner again', () => {
    live(0);
    later(6500);
    expect(visible('.pl-banner')).toBe(false);
    press(KEY.RIGHT);
    expect(visible('.pl-banner')).toBe(true);
    later(6500);
    press(KEY.INFO);
    expect(visible('.pl-banner')).toBe(true);
  });
  it('OK (on release) opens Channels on the playing channel: ▶ mark, active row, banner gone', () => {
    store.toggleFav(CH[2]);
    live(1);
    down(KEY.ENTER);
    expect($('.pl-channels').hidden).toBe(true);
    up(KEY.ENTER);
    expect(view()._state().panel).toBe('channels');
    expect(txt('.pl-channels .sheet-title')).toBe('Channels');
    expect(txt('.pl-channels .sheet-hint')).toBe('Hold OK  Add or remove favourite');
    expect(visible('.pl-banner')).toBe(false);
    const rows = [...document.querySelectorAll('.pl-channels .row-cell')];
    expect(rows.map((r) => r.querySelector('.rc-title').textContent)).toEqual(['BBC One', 'Sky News', 'Film4']);
    const playing = rows[1];
    expect(document.activeElement).toBe(playing);
    expect(playing.classList.contains('active')).toBe(true);
    expect(playing.querySelector('.rc-trail').textContent).toBe('▶');
    expect(rows[2].querySelector('.rc-trail').textContent).toBe('♥');
  });
  it('in Channels: ▼ then OK zaps at once and closes; OK on the playing one just closes', () => {
    live(0);
    press(KEY.ENTER);
    press(KEY.DOWN);
    press(KEY.ENTER);
    expect(opens().at(-1)).toBe('http://h.com:80/live/u/p/11.ts');
    expect(view()._state().panel).toBe(null);
    press(KEY.ENTER);
    press(KEY.ENTER);
    expect(opens()).toHaveLength(2);
    expect(view()._state().panel).toBe(null);
  });
  it('the Channels list reads the favourites once per paint, not once per row', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ type: 'live', id: String(1000 + i), name: `Ch ${i}`, num: String(i + 1) }));
    store.toggleFav(many[2]);
    live(0, many);
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    const favReads = () => reads.mock.calls.filter((c) => String(c[0]).endsWith('fav_live')).length;
    press(KEY.ENTER); // open the list
    expect(favReads()).toBe(1);
    const rows = [...document.querySelectorAll('.pl-channels .row-cell')];
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[2].querySelector('.rc-trail').textContent).toBe('♥');
    reads.mockClear();
    for (let i = 0; i < 40; i++) down(KEY.DOWN); // scrolling draws new rows from the same set
    expect(favReads()).toBe(0);
    reads.mockRestore();
  });
  it('in Channels: Hold OK (or Menu) toggles the favourite with the toast; no zap', () => {
    live(0);
    press(KEY.ENTER);
    press(KEY.DOWN);
    hold(KEY.ENTER);
    expect(store.isFav(CH[1])).toBe(true);
    expect(txt('.toast')).toBe('Added to Favourites — Sky News');
    expect(document.activeElement.querySelector('.rc-trail').textContent).toBe('♥');
    expect(opens()).toHaveLength(1);
    expect(view()._state().panel).toBe('channels');
    press(KEY.MENU);
    expect(store.isFav(CH[1])).toBe(false);
    expect(txt('.toast')).toBe('Removed from Favourites — Sky News');
  });
  it('Back closes the panel, then leaves', () => {
    live(0);
    press(KEY.ENTER);
    press(KEY.BACK);
    expect(view()._state().panel).toBe(null);
    expect(router.current().name).toBe('player-live');
    press(KEY.BACK);
    expect(router.current().name).toBe('home');
    expect(shim.getState()).toBe('NONE');
    expect($('#av').hidden).toBe(true);
  });
  it('Hold OK opens Subtitles & Audio with Favourites first; the heart reaches the banner', () => {
    live(0);
    hold(KEY.ENTER);
    expect(view()._state().panel).toBe('tracks');
    expect($('.pl-channels').hidden).toBe(true);
    const heads = [...document.querySelectorAll('.tp-header')].map((h) => h.textContent);
    expect(heads).toEqual(['FAVOURITES', 'SUBTITLES', 'AUDIO', 'PICTURE  ·  FOR THIS CHANNEL', 'SUBTITLE SIZE']);
    const fav = document.querySelector('.tp-opt');
    expect(fav.textContent).toBe('♡  Add to Favourites');
    fav.click();
    expect(store.isFav(CH[0])).toBe(true);
    expect(txt('.toast')).toBe('Added to Favourites — BBC One');
    expect(txt('.pl-live-name')).toBe('BBC One  ♥');
    later(250);
    expect(document.querySelector('.tp-opt .tp-label').textContent).toBe('♥  In Favourites — remove');
  });
  it('play / pause keys toggle live pause', () => {
    live(0);
    press(KEY.PLAY_PAUSE);
    expect(shim.getState()).toBe('PAUSED');
    press(KEY.PLAY);
    expect(shim.getState()).toBe('PLAYING');
    press(KEY.PAUSE);
    expect(shim.getState()).toBe('PAUSED');
  });
  it('errors: 2 retries 1.5 s apart ("Reconnecting…"), then the other format, then the card; OK tries again', () => {
    shim.failWhen = () => true;
    live(0);
    expect(txt('.pl-status')).toBe('Reconnecting…');
    expect(opens()).toHaveLength(1);
    later(1500);
    expect(opens()).toHaveLength(2);
    later(1500);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/10.ts', 'http://h.com:80/live/u/p/10.ts', 'http://h.com:80/live/u/p/10.ts', 'http://h.com:80/live/u/p/10.m3u8']);
    later(3000);
    expect(opens()).toHaveLength(6);
    expect(visible('.pl-error')).toBe(true);
    expect(txt('.pl-error')).toBe("Can't play this channel\nPLAYER_ERROR_CONNECTION_FAILED\n\nOK  Try again      Back  Exit      ▲▼  Other channel");
    later(2500);
    expect($('.pl-status').hidden).toBe(true);
    shim.failWhen = null;
    press(KEY.ENTER);
    expect(opens().at(-1)).toBe('http://h.com:80/live/u/p/10.ts'); // back to the Settings format
    expect($('.pl-error').hidden).toBe(true);
    expect(view()._state().retries).toBe(0);
  });
  it('the format flip happens even with auto-recover off (that only governs the freeze watchdog)', () => {
    store.setAutoRecover(false);
    shim.failWhen = (u) => u.endsWith('.ts');
    live(0);
    later(3000);
    expect(opens().at(-1)).toBe('http://h.com:80/live/u/p/10.m3u8');
    expect($('.pl-error').hidden).toBe(true);
  });
  it('▲▼ still change channel from the error card', () => {
    shim.failWhen = (u) => u.includes('/10.');
    live(0);
    later(6000);
    expect(visible('.pl-error')).toBe(true);
    press(KEY.DOWN);
    later(350);
    expect(opens().at(-1)).toBe('http://h.com:80/live/u/p/11.ts');
    expect($('.pl-error').hidden).toBe(true);
  });
  it('the stream ending reconnects', () => {
    live(0);
    shim.complete();
    expect(opens()).toHaveLength(2);
  });
  it('freeze watchdog: playing but the clock still for 3 s → "Re-syncing video…" and a reload, at most 4 times', () => {
    live(0);
    shim.tick(1000);
    later(1000); // first look
    later(3000);
    expect(txt('.pl-status')).toBe('Re-syncing video…');
    expect(opens()).toHaveLength(2);
    for (let i = 0; i < 6; i++) later(4000);
    expect(opens()).toHaveLength(5); // 4 recoveries, then it gives up quietly
  });
  it('freeze watchdog: a moving clock, a pause, buffering or auto_recover off never trigger it', () => {
    live(0);
    for (let t = 1; t <= 6; t++) { shim.tick(t * 1000); later(1000); }
    expect(opens()).toHaveLength(1);
    shim.buffering(true);
    later(5000);
    expect(opens()).toHaveLength(1);
    shim.buffering(false);
    press(KEY.PAUSE);
    later(5000);
    expect(opens()).toHaveLength(1);
    press(KEY.PLAY);
    store.setAutoRecover(false);
    later(5000);
    expect(opens()).toHaveLength(1);
  });
  it('the first-run coach card ("Watching Live TV") when the tutorial is on', () => {
    localStorage.setItem('coach_on', 'true');
    live(0);
    later(1000);
    expect(coach.showing()).toBe(true);
    expect(txt('.coach-title')).toBe(COACH_LIVE.title);
    expect(txt('.coach-body')).toBe(COACH_LIVE.body);
    press(KEY.DOWN); // the card has the keys
    later(400);
    expect(opens()).toHaveLength(1);
    press(KEY.BACK);
    expect(coach.showing()).toBe(false);
    expect(router.current().name).toBe('player-live');
  });
});

describe('films and episodes', () => {
  it('resumes past 10 s with the toast; the sheet shows title, elapsed and −remaining, the hint', () => {
    store.setPosition(MOVIE, 754000);
    vod([MOVIE]);
    expect(shim.calls.find((c) => c.name === 'seekTo').args[0]).toBe(754000);
    expect(txt('.toast')).toBe('Resuming from 12:34');
    expect(visible('.pl-vod')).toBe(true);
    expect(txt('.pl-vod-title')).toBe('Heat');
    expect($('.pl-vod-sub').hidden).toBe(true);
    expect(txt('.pl-time-left')).toBe('12:34');
    expect(txt('.pl-time-right')).toBe('−47:26');
    expect(txt('.pl-vod-hint')).toBe(VOD_HINT);
    expect(store.history(false)[0].id).toBe('7');
  });
  it('a point under 10 s plays from the start, without the toast', () => {
    store.setPosition(MOVIE, 9000);
    vod([MOVIE]);
    expect(shim.names()).not.toContain('seekTo');
    expect(txt('.toast')).toBe(null);
  });
  it('episodes: "Series  ·  Episode N" over the episode title', () => {
    vod(EPS, 1);
    expect(txt('.pl-vod-sub')).toBe('Dark  ·  Episode 2');
    expect(txt('.pl-vod-title')).toBe('Chapter 2');
    expect(opens()).toEqual(['http://h.com:80/series/u/p/902.mp4']);
  });
  it('the sheet hides 4 s after it shows while playing', () => {
    vod([MOVIE]);
    later(3900);
    expect(visible('.pl-vod')).toBe(true);
    later(100);
    expect(visible('.pl-vod')).toBe(false);
  });
  it('OK (tap, on release) pauses at once: centre icon, sheet pinned; OK again plays and the sheet goes', () => {
    vod([MOVIE]);
    later(5000);
    down(KEY.ENTER);
    expect(shim.getState()).toBe('PLAYING');
    up(KEY.ENTER);
    expect(shim.getState()).toBe('PAUSED');
    expect(visible('.pl-center')).toBe(true);
    expect($('.pl-center').classList.contains('paused')).toBe(true);
    expect(visible('.pl-vod')).toBe(true);
    later(10000);
    expect(visible('.pl-vod')).toBe(true); // pinned while paused
    press(KEY.ENTER);
    expect(shim.getState()).toBe('PLAYING');
    expect($('.pl-center').hidden).toBe(true);
    later(4000);
    expect(visible('.pl-vod')).toBe(false);
  });
  it('▶ ▶ ▶ adds up from the pending target ("+30 sec"), ◀ takes 5 s; the burst ends 1.2 s after the last press', () => {
    vod([MOVIE]);
    shim.tick(600000);
    press(KEY.RIGHT, 3);
    expect(shim.calls.filter((c) => c.name === 'seekTo').map((c) => c.args[0])).toEqual([610000, 620000, 630000]);
    expect(txt('.pl-bubble')).toBe('+30 sec');
    expect($('.pl-bubble').style.visibility).toBe('visible');
    expect(txt('.pl-time-left')).toBe('10:30');
    press(KEY.LEFT);
    expect(shim.calls.at(-1)).toEqual({ name: 'seekTo', args: [625000] });
    expect(txt('.pl-bubble')).toBe('+25 sec');
    later(1199);
    expect($('.pl-bubble').style.visibility).toBe('visible');
    later(1);
    expect($('.pl-bubble').style.visibility).toBe('hidden');
    expect(view()._state().seekTarget).toBe(-1);
    press(KEY.FAST_FORWARD, 7);
    expect(txt('.pl-bubble')).toBe('+1:10');
    press(KEY.REWIND);
    expect(txt('.pl-bubble')).toBe('+1:05');
  });
  it('seeking clamps to [0, duration − 1 s]', () => {
    vod([MOVIE], 0, 120000);
    shim.tick(115000);
    press(KEY.RIGHT);
    expect(shim.calls.at(-1).args[0]).toBe(119000);
    later(1300);
    shim.tick(3000);
    press(KEY.LEFT);
    expect(shim.calls.at(-1).args[0]).toBe(0);
  });
  it('▼ scrub: knob, time card and hint; ◀ ▶ step; it plays from the knob 1 s after the last move', () => {
    vod([MOVIE]);
    shim.tick(600000);
    press(KEY.DOWN);
    expect(view()._state().scrubbing).toBe(true);
    expect(txt('.pl-vod-hint')).toBe(SCRUB_HINT);
    expect($('.pl-scrub-row').hidden).toBe(false);
    expect($('.pl-vod-bar').classList.contains('scrubbing')).toBe(true);
    press(KEY.RIGHT, 2);
    expect(view()._state().scrubPos).toBe(660000);
    expect(txt('.pl-scrub-time')).toBe('11:00   +1:00');
    const seeks = () => shim.calls.filter((c) => c.name === 'seekTo').length;
    expect(seeks()).toBe(0);
    later(999);
    expect(seeks()).toBe(0);
    later(1);
    expect(shim.calls.at(-1)).toEqual({ name: 'seekTo', args: [660000] });
    expect(view()._state().scrubbing).toBe(false);
    expect(txt('.pl-vod-hint')).toBe(VOD_HINT);
  });
  it('scrub: holding ◀ ▶ goes faster (1x, 2x from the 3rd repeat, 4x from the 8th, 8x from the 16th)', () => {
    vod([MOVIE]); // 1 h: base step 30 s
    shim.tick(1800000);
    press(KEY.DOWN);
    down(KEY.LEFT);
    for (let i = 1; i <= 16; i++) down(KEY.LEFT, { repeat: true });
    up(KEY.LEFT);
    // 3 x 30 s, 5 x 60 s, 8 x 120 s, 1 x 240 s
    expect(view()._state().scrubPos).toBe(1800000 - (90000 + 300000 + 960000 + 240000));
    press(KEY.LEFT);
    expect(view()._state().scrubPos).toBe(1800000 - 1590000 - 30000); // a fresh press is 1x again
  });
  it('scrub: OK plays from the knob at once (resuming if paused); ▲ and Back cancel without seeking', () => {
    vod([MOVIE]);
    shim.tick(600000);
    press(KEY.ENTER); // pause
    press(KEY.DOWN);
    press(KEY.LEFT);
    press(KEY.ENTER);
    expect(shim.calls.filter((c) => c.name === 'seekTo').map((c) => c.args[0])).toEqual([570000]);
    expect(shim.getState()).toBe('PLAYING');
    press(KEY.DOWN); press(KEY.RIGHT); press(KEY.UP);
    press(KEY.DOWN); press(KEY.RIGHT); press(KEY.BACK);
    later(2000);
    expect(shim.calls.filter((c) => c.name === 'seekTo')).toHaveLength(1);
    expect(router.current().name).toBe('player-vod');
  });
  it('scrub needs a known length: otherwise ▼ only shows the sheet', () => {
    vod([MOVIE], 0, 0);
    later(5000);
    press(KEY.DOWN);
    expect(view()._state().scrubbing).toBe(false);
    expect(visible('.pl-vod')).toBe(true);
    expect(txt('.pl-time-right')).toBe('');
  });
  it('layered Back: hide the sheet while playing, then leave (the place is saved)', () => {
    vod([MOVIE]);
    shim.tick(300000);
    press(KEY.BACK);
    expect(visible('.pl-vod')).toBe(false);
    expect(router.current().name).toBe('player-vod');
    press(KEY.BACK);
    expect(router.current().name).toBe('home');
    expect(store.position(MOVIE)).toBe(300000);
    expect(store.duration(MOVIE)).toBe(3600000);
  });
  it('media keys: Play/Pause toggles, Play, Pause, FF/RW seek; Stop leaves the player with the place saved', () => {
    vod([MOVIE]);
    shim.tick(60000);
    press(KEY.PLAY_PAUSE);
    expect(shim.getState()).toBe('PAUSED');
    press(KEY.PLAY);
    expect(shim.getState()).toBe('PLAYING');
    press(KEY.PAUSE);
    expect(shim.getState()).toBe('PAUSED');
    press(KEY.FAST_FORWARD);
    expect(shim.calls.at(-1)).toEqual({ name: 'seekTo', args: [70000] });
    press(KEY.STOP);
    expect(router.current().name).toBe('home');
    expect(shim.names().slice(-2)).toEqual(['stop', 'close']);
    expect(store.position(MOVIE)).toBe(70000); // resumes from here next time
  });
  it('Stop also leaves from the Channels list of a live channel', () => {
    live(0);
    press(KEY.ENTER);
    expect(view()._state().panel).toBe('channels');
    press(KEY.STOP);
    expect(router.current().name).toBe('home');
  });
  it('a film ending goes back; an episode with a next one in the queue plays it', () => {
    vod(EPS, 0);
    shim.complete();
    expect(opens().at(-1)).toBe('http://h.com:80/series/u/p/902.mp4');
    expect(txt('.pl-vod-title')).toBe('Chapter 2');
    expect(store.position(EPS[0])).toBe(0);
  });
  it('a film ending leaves the player', () => {
    vod([MOVIE]);
    shim.complete();
    expect(router.current().name).toBe('home');
  });
  it('the last episode of the queue (the season) ending leaves the player', () => {
    vod(EPS, 2);
    shim.complete();
    expect(router.current().name).toBe('home');
  });
  it('the error card for a film: no "Other channel"; OK replays', () => {
    shim.failWhen = () => true;
    vod([MOVIE]);
    later(3000);
    expect(txt('.pl-error')).toBe("Can't play this video\nPLAYER_ERROR_CONNECTION_FAILED\n\nOK  Try again      Back  Exit");
    expect(opens()).toHaveLength(3); // no format flip for films
    shim.failWhen = null;
    press(KEY.ENTER);
    expect(opens()).toHaveLength(4);
    expect($('.pl-error').hidden).toBe(true);
  });
  it('a TV without AVPlay: the error state says so at once, no retries, never the shim', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.tizen = {}; delete globalThis.webapis; // webapis.js did not load
    try {
      vod([MOVIE]);
      expect($('.pl-error').hidden).toBe(false);
      expect(txt('.pl-error')).toBe('Video player unavailable on this TV\n\nBack  Exit');
      expect($('.pl-spinner').hidden).toBe(true);
      later(10000);
      expect(shim.calls).toEqual([]);
      press(KEY.ENTER); // OK tries again and says the same
      expect(txt('.pl-error')).toContain('Video player unavailable on this TV');
      press(KEY.BACK);
      expect(router.current().name).toBe('home');
    } finally { delete globalThis.tizen; console.error.mockRestore(); }
  });
  it('the screen saver comes back however the player is left, also when a film ends by itself', () => {
    const setScreenSaver = vi.fn();
    const ON = 1; const OFF = 0;
    const leave = [() => shim.complete(), () => press(KEY.STOP), () => { press(KEY.BACK); press(KEY.BACK); }];
    for (const go of leave) {
      globalThis.webapis = { avplay: shim, appcommon: { setScreenSaver, AppCommonScreenSaverState: { SCREEN_SAVER_ON: ON, SCREEN_SAVER_OFF: OFF } } };
      setScreenSaver.mockClear();
      vod([MOVIE]);
      expect(setScreenSaver.mock.calls).toEqual([[OFF]]);
      go();
      expect(router.current().name).toBe('home');
      expect(setScreenSaver.mock.calls).toEqual([[OFF], [ON]]);
    }
  });
  it('freeze watchdog for a film re-seeks to where it is', () => {
    vod([MOVIE]);
    shim.tick(50000);
    later(4000);
    expect(txt('.pl-status')).toBe('Re-syncing video…');
    expect(shim.calls.at(-1)).toEqual({ name: 'seekTo', args: [50000] });
    expect(opens()).toHaveLength(1);
  });
  it('going to the background saves and stops; coming back resumes there', () => {
    vod([MOVIE]);
    shim.tick(200000);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(shim.getState()).toBe('NONE');
    expect(store.position(MOVIE)).toBe(200000);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(shim.calls.at(-2)).toEqual({ name: 'seekTo', args: [200000] });
    delete document.hidden;
  });
});

describe('Next Episode card', () => {
  const D = 30 * 60000;
  it('shows in the last 30 s of an episode with a next one: overlay hidden, focus on Next, countdown plays it', () => {
    vod(EPS, 0, D);
    shim.tick(D - 31000);
    later(500);
    expect($('.nextup').hidden).toBe(true);
    shim.tick(D - 30000);
    later(500);
    expect(view()._state().nextShown).toBe(true);
    expect(visible('.nextup')).toBe(true);
    expect(visible('.pl-vod')).toBe(false);
    expect(document.activeElement).toBe($('.nu-next'));
    expect(txt('.nu-credits')).toBe('Watch credits');
    later(COUNTDOWN_MS - 100);
    expect(opens()).toHaveLength(1);
    later(100);
    expect(opens().at(-1)).toBe('http://h.com:80/series/u/p/902.mp4');
    expect(store.position(EPS[0])).toBe(0);
    expect($('.nextup').hidden).toBe(true);
  });
  it('the countdown pauses while the video is paused', () => {
    vod(EPS, 0, D);
    shim.tick(D - 25000);
    later(500);
    later(4000);
    press(KEY.PAUSE);
    later(500); // the tick sees the pause
    later(20000);
    expect(opens()).toHaveLength(1);
    press(KEY.PLAY);
    later(500);
    later(6000);
    expect(opens()).toHaveLength(2);
  });
  it('▶ is Next (OK on release plays now); ◀ is Watch credits, which dismisses it until you go back past 45 s', () => {
    vod(EPS, 0, D);
    shim.tick(D - 20000);
    later(500);
    press(KEY.LEFT);
    expect(document.activeElement).toBe($('.nu-credits'));
    press(KEY.ENTER);
    expect($('.nextup').hidden).toBe(true);
    later(1000);
    expect(view()._state().nextShown).toBe(false);
    shim.tick(D - 50000); // went back: armed again
    later(500);
    shim.tick(D - 20000);
    later(500);
    expect(view()._state().nextShown).toBe(true);
    press(KEY.LEFT); press(KEY.RIGHT);
    expect(document.activeElement).toBe($('.nu-next'));
    press(KEY.ENTER);
    expect(opens().at(-1)).toBe('http://h.com:80/series/u/p/902.mp4');
  });
  it('Back = Watch credits; seeking back past 35 s hides it', () => {
    vod(EPS, 0, D);
    shim.tick(D - 20000);
    later(500);
    press(KEY.BACK);
    expect(view()._state().nextDismissed).toBe(true);
    expect(router.current().name).toBe('player-vod');
    shim.tick(D - 50000); later(500);
    shim.tick(D - 20000); later(500);
    expect(view()._state().nextShown).toBe(true);
    shim.tick(D - 40000); later(500);
    expect(view()._state().nextShown).toBe(false);
  });
  it('not for films, the season\'s last episode, short episodes, or the final 2 s', () => {
    vod([MOVIE], 0, D);
    shim.tick(D - 20000); later(500);
    expect(view()._state().nextShown).toBe(false);
    vod(EPS, 2, D);
    shim.tick(D - 20000); later(500);
    expect(view()._state().nextShown).toBe(false);
    vod(EPS, 0, 4 * 60000);
    shim.tick(4 * 60000 - 20000); later(500);
    expect(view()._state().nextShown).toBe(false);
    vod(EPS, 0, D);
    shim.tick(D - 1500); later(500);
    expect(view()._state().nextShown).toBe(false);
  });
  it('NextUpCard countdown: fills over 10 s, pauses and resumes, stops', () => {
    const card = createNextUpCard(document.body);
    const done = vi.fn();
    card.start(done);
    later(4000);
    expect(card.fill()).toBeCloseTo(0.4);
    card.setPaused(true);
    later(5000);
    expect(card.fill()).toBeCloseTo(0.4);
    card.setPaused(false);
    later(5999);
    expect(done).not.toHaveBeenCalled();
    later(1);
    expect(done).toHaveBeenCalledTimes(1);
    card.start(done);
    card.stopTimer();
    later(20000);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('Subtitles & Audio', () => {
  const T = (index, type, info) => ({ index, type, extra_info: JSON.stringify(info) });
  const TRACKS = [
    T(1, 'AUDIO', { language: 'eng', fourCC: 'AC3', channels: '6' }),
    T(2, 'AUDIO', { language: 'deu', fourCC: 'AACL', channels: '2' }),
    T(3, 'TEXT', { track_lang: 'eng' }),
    T(4, 'TEXT', { track_lang: 'spa' }),
  ];
  const withTracks = (fn) => { const o = shim.open; shim.open = (u) => { o(u); shim.setTracks(TRACKS); }; try { fn(); } finally { shim.open = o; } };
  const rows = () => [...document.querySelectorAll('.pl-tracks .sheet-body > *')].map((e) => (e.classList.contains('tp-opt')
    ? `${e.querySelector('.tp-label').textContent}${e.querySelector('.tp-check').textContent ? ' ✓' : ''}` : `[${e.textContent}]`));

  it('Hold OK in a film: the rows Android shows (no Audio Sync or Player rows on AVPlay); focus on the subtitle in use', () => {
    withTracks(() => vod([MOVIE]));
    hold(KEY.ENTER);
    expect(shim.getState()).toBe('PLAYING'); // a hold never pauses
    expect(visible('.pl-vod')).toBe(false);
    expect(rows()).toEqual([
      '[FAVOURITES]', '♡  Add to Favourites',
      '[SUBTITLES]', 'Off', 'English ✓', 'Spanish',
      '[AUDIO]', 'English  ·  Dolby Digital  ·  5.1 ✓', 'German  ·  AAC  ·  Stereo',
      '[PICTURE  ·  FOR THIS FILM]', 'Fit ✓', 'Fill screen (zoom)', 'Stretch', '16:9', '4:3',
      '[SUBTITLE SIZE]', 'Small', 'Medium ✓', 'Large', 'Extra Large',
    ]);
    expect(document.activeElement.textContent).toBe('English✓');
  });
  it('Hold OK opens the menu while OK is still held (no key repeats needed); letting go then does nothing', () => {
    withTracks(() => vod([MOVIE]));
    down(KEY.ENTER);
    later(300);
    expect(visible('.pl-tracks')).toBe(false);
    later(200); // 450 ms in, OK still down
    expect(visible('.pl-tracks')).toBe(true);
    up(KEY.ENTER);
    expect(shim.getState()).toBe('PLAYING'); // letting go didn't pause
    expect(visible('.pl-tracks')).toBe(true);
  });
  it('picking tracks switches them on the device and remembers the language; Off silences', () => {
    withTracks(() => vod([MOVIE]));
    hold(KEY.ENTER);
    press(KEY.DOWN); // Spanish
    press(KEY.ENTER);
    expect(shim.selectedTrack('TEXT')).toBe(4);
    expect(store.subtitleLanguage()).toBe('spa');
    later(250);
    expect(rows()).toContain('Spanish ✓');
    expect(document.activeElement.textContent).toBe('Spanish✓'); // focus kept on the rebuilt row
    press(KEY.DOWN, 2); // German audio
    press(KEY.ENTER);
    expect(shim.selectedTrack('AUDIO')).toBe(2);
    expect(store.audioLanguage()).toBe('deu');
    press(KEY.UP, 4); // Off
    press(KEY.ENTER);
    expect(shim.isSilent()).toBe(true);
    expect(store.subtitleLanguage()).toBe('off');
    later(250);
    expect(rows()).toContain('Off ✓');
    press(KEY.BACK);
    expect(view()._state().panel).toBe(null);
    expect(router.current().name).toBe('player-vod');
  });
  it('the hold that opened the panel never activates a row on release', () => {
    withTracks(() => vod([MOVIE]));
    hold(KEY.ENTER);
    expect(store.subtitleLanguage()).toBe('');
    expect(shim.isSilent()).toBe(false);
  });
  it('no tracks: the notes', () => {
    vod([MOVIE]);
    hold(KEY.ENTER);
    expect(rows()).toContain('[This stream has no subtitles]');
    expect(rows()).toContain('[No audio tracks found]');
    expect(rows()).toContain('Off ✓');
  });
  it('episodes favourite their series', () => {
    vod(EPS, 0);
    hold(KEY.ENTER);
    const fav = document.querySelector('.tp-opt');
    expect(fav.textContent).toBe('♡  Add series to Favourites');
    fav.click();
    expect(store.isFav({ type: 'series', id: '55' })).toBe(true);
    expect(txt('.toast')).toBe('Added to Favourites — Dark');
    later(250);
    expect(document.querySelector('.tp-opt .tp-label').textContent).toBe('♥  In Favourites — remove series');
  });
  it('subtitles render in the overlay, styled by the prefs, and go after their duration', () => {
    withTracks(() => vod([MOVIE]));
    shim.subtitle('<i>Where were you</i><br>last night?', 2000);
    const lines = [...document.querySelectorAll('.pl-sub-line')].map((l) => l.textContent);
    expect(lines).toEqual(['Where were you', 'last night?']);
    const subs = $('.pl-subs');
    expect(subs.style.getPropertyValue('--sub-size')).toBe('60.5px'); // Medium: 5.6 % of 1080
    expect(subs.style.getPropertyValue('--sub-color')).toBe('#FFFFFF');
    expect(subs.style.getPropertyValue('--sub-bg')).toBe('transparent');
    expect(subs.style.getPropertyValue('--sub-shadow')).not.toBe('none');
    expect(subs.style.bottom).toBe('76px');
    later(2000);
    expect(document.querySelectorAll('.pl-sub-line')).toHaveLength(0);
  });
  it('a second style: Extra Large picked in the panel, Yellow on a 50 % background', () => {
    store.setSubtitleColor(1);
    store.setSubtitleBackground(true);
    store.setSubtitleOpacity(1);
    withTracks(() => vod([MOVIE]));
    const subs = $('.pl-subs');
    expect(subs.style.getPropertyValue('--sub-color')).toBe('#FFE14D');
    expect(subs.style.getPropertyValue('--sub-bg')).toBe('rgba(0, 0, 0, 0.502)');
    expect(subs.style.getPropertyValue('--sub-shadow')).toBe('none');
    hold(KEY.ENTER);
    [...document.querySelectorAll('.tp-opt')].find((r) => r.textContent.startsWith('Extra Large')).click();
    expect(store.subtitleSize()).toBe(3);
    expect(subs.style.getPropertyValue('--sub-size')).toBe('91.8px');
  });
  it('Off stops drawing; a silenced stream sends nothing', () => {
    store.setSubtitleLanguage('off');
    withTracks(() => vod([MOVIE]));
    shim.subtitle('Hidden', 2000);
    expect(document.querySelectorAll('.pl-sub-line')).toHaveLength(0);
  });
  it('subtitle style and text helpers', () => {
    expect(subStyle()).toMatchObject({ fontSize: 60.5, color: '#FFFFFF', bottom: 76 });
    expect(cleanText('{\\an8}Top\\Nline &amp; more')).toBe('Top\nline & more');
  });
});


// ------------------------------------------------------------------ watched, queue, skip intro, picture

describe('finishing, the queue and what plays next', () => {
  const D = 30 * 60000;
  const SEASON = (n) => [1, 2].map((e) => ({ id: String(n * 100 + e), episode_num: e, title: `S${n}E${e}`, container_extension: 'mp4', season: n }));
  const SERIES_INFO = { info: { tmdb: '70523' }, episodes: { 1: SEASON(1), 2: SEASON(2) } };

  it('a film that runs to its end is marked watched; leaving in the last 10% counts too', () => {
    vod([MOVIE], 0, D);
    shim.tick(D - 1000);
    shim.complete();
    expect(store.isWatched(MOVIE)).toBe(true);
    expect(store.position(MOVIE)).toBe(0);
    store.setWatched(MOVIE, false);
    vod([MOVIE], 0, D);
    shim.tick(D * 0.92); // into the credits, more than a minute from the end
    press(KEY.BACK); press(KEY.BACK);
    expect(router.current().name).toBe('home');
    expect(store.isWatched(MOVIE)).toBe(true);
    expect(store.continueWatching()).toEqual([]);
  });

  it('an episode finishing puts the next one in Continue Watching, ready at the start', () => {
    vod(EPS, 0, D);
    shim.tick(D - 20000);
    press(KEY.BACK); press(KEY.BACK); press(KEY.BACK); // the card, the overlay, then out
    expect(router.current().name).toBe('home');
    expect(store.isWatched(EPS[0])).toBe(true);
    expect(store.isUpNext(EPS[1])).toBe(true);
    expect(store.continueWatching().map((e) => e.id)).toEqual(['902']);
  });

  it('a stream that ends early reconnects where it stopped, three times, then saves your place and leaves', () => {
    vod([MOVIE], 0, D);
    for (let i = 1; i <= 3; i++) {
      shim.tick(600000);
      shim.complete();
      expect(txt('.pl-status')).toBe('Reconnecting…');
      expect(opens()).toHaveLength(1 + i);
      expect(shim.calls.filter((c) => c.name === 'seekTo').at(-1).args).toEqual([600000]);
    }
    shim.tick(600000);
    shim.complete();
    expect(txt('.pl-status')).toBe('The stream stopped — your place is saved');
    expect(store.isWatched(MOVIE)).toBe(false);
    later(2500);
    expect(router.current().name).toBe('home');
    expect(store.position(MOVIE)).toBe(600000);
  });

  it('a film with something in your Queue: the card says "Next in Queue" and plays it on its own', () => {
    const other = { type: 'movie', id: '8', name: 'Ronin', ext: 'mp4' };
    store.queueAdd(other);
    vod([MOVIE], 0, D);
    shim.tick(D - 20000); later(500);
    expect(view()._state().nextShown).toBe(true);
    expect([...document.querySelectorAll('.nu-label')].map((l) => l.textContent)).toEqual(['Next in Queue', 'Next in Queue']);
    press(KEY.ENTER);
    expect(opens().at(-1)).toBe('http://h.com:80/movie/u/p/8.mp4');
    expect(view()._state().queue).toEqual([other]);
    expect(store.isWatched(MOVIE)).toBe(true);
    shim.tick(D - 1000); shim.complete(); // Ronin ends: watched, so it leaves the queue, and nothing is left
    expect(store.queue()).toEqual([]);
    expect(router.current().name).toBe('home');
  });

  it('an episode keeps "Next Episode"; the queue only follows the last one', () => {
    store.queueAdd(MOVIE);
    vod(EPS, 0, D);
    shim.tick(D - 20000); later(500);
    expect($('.nu-label').textContent).toBe('Next Episode');
    vod(EPS, 2, D);
    shim.tick(D - 20000); later(500);
    expect($('.nu-label').textContent).toBe('Next in Queue');
  });

  it('an episode played on its own fetches its series, so the next episode follows (also across seasons)', async () => {
    api.seriesInfo.mockResolvedValue(SERIES_INFO);
    const ep = { type: 'episode', id: '102', name: 'S1E2', num: '2', ext: 'mp4', parentId: '55', parentName: 'Dark' };
    vod([ep], 0, D);
    await flush(); await flush();
    expect(api.seriesInfo).toHaveBeenCalledWith('55');
    const st = view()._state();
    expect(st.queue.map((e) => e.id)).toEqual(['101', '102', '201', '202']);
    expect(st.index).toBe(1);
    expect(st.queue[1]).toBe(ep);
    expect(ep.season).toBe(1); // an entry saved by an older version learns its season and the series' TMDB id
    expect(ep.tmdb).toBe('70523');
    shim.tick(D - 1000); shim.complete();
    expect(opens().at(-1)).toBe('http://h.com:80/series/u/p/201.mp4');
  });
});

describe('Skip Intro', () => {
  const D = 45 * 60000;
  const ep = () => ({ type: 'episode', id: '901', name: 'Chapter 1', num: '1', ext: 'mp4', parentId: '55', parentName: 'Dark', season: 1, tmdb: '70523' });

  it('asks the intro database by TMDB id, season and episode; the button shows during the intro and OK jumps past it', async () => {
    tmdb.findId.mockResolvedValue('70523');
    intros.get.mockResolvedValue({ introStart: 30000, introEnd: 95000, creditsStart: -1 });
    vod([ep(), EPS[1]], 0, D);
    await flush(); await flush();
    expect(tmdb.findId).toHaveBeenCalledWith('tv', 'Dark', '70523');
    expect(intros.get).toHaveBeenCalledWith('70523', 1, 1, 0);
    shim.tick(20000); later(500);
    expect(visible('.pl-skip')).toBe(false);
    shim.tick(31000); later(500);
    expect(visible('.pl-skip')).toBe(true);
    expect(txt('.pl-skip')).toBe('OK   Skip Intro');
    press(KEY.ENTER);
    expect(shim.calls.at(-1)).toEqual({ name: 'seekTo', args: [95000] });
    expect(txt('.pl-status')).toBe('Skipped the intro');
    expect(view()._state().skipShown).toBe(false);
    expect(player.isPlaying()).toBe(true); // OK skipped; it did not pause
  });

  it('gone 1.5 s before the intro ends; OK is play / pause again', async () => {
    tmdb.findId.mockResolvedValue('70523');
    intros.get.mockResolvedValue({ introStart: 0, introEnd: 60000, creditsStart: -1 });
    vod([ep()], 0, D);
    await flush(); await flush();
    shim.tick(5000); later(500);
    expect(visible('.pl-skip')).toBe(true);
    shim.tick(58600); later(500);
    expect(view()._state().skipShown).toBe(false);
    press(KEY.ENTER);
    expect(player.isPlaying()).toBe(false);
  });

  it('a recap gets its own Skip Recap button, then Skip Intro for the intro', async () => {
    tmdb.findId.mockResolvedValue('70523');
    intros.get.mockResolvedValue({ recapStart: 0, recapEnd: 40000, introStart: 60000, introEnd: 95000, creditsStart: -1, status: '' });
    vod([ep(), EPS[1]], 0, D);
    await flush(); await flush();
    shim.tick(5000); later(500);
    expect(txt('.pl-skip')).toBe('OK   Skip Recap');
    press(KEY.ENTER);
    expect(shim.calls.at(-1)).toEqual({ name: 'seekTo', args: [40000] });
    expect(txt('.pl-status')).toBe('Skipped the recap');
    shim.tick(61000); later(500);
    expect(visible('.pl-skip')).toBe(true);
    expect(txt('.pl-skip')).toBe('OK   Skip Intro');
  });

  it('no button for a film, an episode without a season, or a series the database does not have', async () => {
    vod([MOVIE], 0, D);
    await flush();
    expect(tmdb.findId).not.toHaveBeenCalled();
    vod(EPS, 0, D); // saved by an older version: no season
    await flush();
    expect(tmdb.findId).not.toHaveBeenCalled();
    tmdb.findId.mockResolvedValue('1');
    vod([ep()], 0, D);
    await flush(); await flush();
    shim.tick(40000); later(500);
    expect(visible('.pl-skip')).toBe(false);
  });

  it('the Next Episode card comes up when the credits start, if the database knows where that is', async () => {
    tmdb.findId.mockResolvedValue('70523');
    intros.get.mockResolvedValue({ introStart: -1, introEnd: -1, creditsStart: D - 120000 });
    vod([ep(), EPS[1]], 0, D);
    await flush(); await flush();
    shim.tick(D - 125000); later(500);
    expect(view()._state().nextShown).toBe(false);
    shim.tick(D - 119000); later(500);
    expect(view()._state().nextShown).toBe(true);
  });
});

describe('Picture shape', () => {
  const rects = () => shim.calls.filter((c) => c.name === 'setDisplayRect').map((c) => c.args);

  it('Fit by default; the panel sets it for this film and it is used again next time', () => {
    vod([MOVIE]);
    expect(rects().at(-1)).toEqual([0, 0, 1920, 1080]);
    expect(shim.displayMethod).toBe('PLAYER_DISPLAY_MODE_LETTER_BOX');
    hold(KEY.ENTER);
    const opt = [...document.querySelectorAll('.tp-opt')].find((o) => o.querySelector('.tp-label').textContent === '4:3');
    opt.click();
    expect(store.picture(MOVIE)).toBe(4);
    expect(rects().at(-1)).toEqual([240, 0, 1440, 1080]);
    expect(shim.displayMethod).toBe('PLAYER_DISPLAY_MODE_FULL_SCREEN');
    expect(txt('.pl-status')).toBe('Picture: 4:3');
    later(300);
    expect([...document.querySelectorAll('.tp-opt')].find((o) => o.querySelector('.tp-label').textContent === '4:3').textContent).toBe('4:3✓');
    press(KEY.BACK); press(KEY.BACK); press(KEY.BACK);
    shim.calls = [];
    vod([MOVIE]);
    expect(rects().at(-1)).toEqual([240, 0, 1440, 1080]);
  });

  it('episodes share their series\' shape; each channel has its own', () => {
    store.setPicture(EPS[0], 2);
    expect(store.picture(EPS[2])).toBe(2);
    store.setPicture(CH[1], 2);
    live(0);
    expect(shim.displayMethod).toBe('PLAYER_DISPLAY_MODE_LETTER_BOX');
    press(KEY.DOWN); later(400);
    expect(shim.displayMethod).toBe('PLAYER_DISPLAY_MODE_FULL_SCREEN');
    store.setPicture(CH[1], 0);
    expect(store.picture(CH[1])).toBe(0);
  });

  it('pictureRect: Stretch and 16:9 fill the screen; Fill zooms a wide or narrow video until it covers it', () => {
    const FULL = 'PLAYER_DISPLAY_MODE_FULL_SCREEN';
    expect(player.pictureRect(player.PIC_STRETCH)).toEqual([0, 0, 1920, 1080, FULL]);
    expect(player.pictureRect(player.PIC_16_9)).toEqual([0, 0, 1920, 1080, FULL]);
    expect(player.pictureRect(player.PIC_FILL, 2.4)).toEqual([-336, 0, 2592, 1080, FULL]);
    expect(player.pictureRect(player.PIC_FILL, 4 / 3)).toEqual([0, -180, 1920, 1440, FULL]);
    expect(player.pictureRect(player.PIC_FILL, 16 / 9)).toEqual([0, 0, 1920, 1080, FULL]);
    expect(player.pictureRect(player.PIC_FILL, 0)).toEqual([0, 0, 1920, 1080, 'PLAYER_DISPLAY_MODE_LETTER_BOX']); // shape not known yet
  });
});
