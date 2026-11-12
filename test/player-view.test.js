// @vitest-environment jsdom
// The full-screen player (PlayerActivity.java) on the real engine (js/player.js) and the AVPlay shim.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (orig) => ({ ...(await orig()), epg: vi.fn() }));

import * as api from '../js/api.js';
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
    expect(heads).toEqual(['FAVOURITES', 'SUBTITLES', 'AUDIO', 'SUBTITLE SIZE']);
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
  it('media keys: Play/Pause toggles, Play, Pause, FF/RW seek; Stop does nothing (as on Android)', () => {
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
    expect(router.current().name).toBe('player-vod');
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
      '[SUBTITLE SIZE]', 'Small', 'Medium ✓', 'Large', 'Extra Large',
    ]);
    expect(document.activeElement.textContent).toBe('English✓');
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
