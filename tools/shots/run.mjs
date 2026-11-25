#!/usr/bin/env node
// Screenshot harness: serves the app + a mock Xtream server, drives it with the remote's keys in
// the system Chrome at 1920x1080, and saves PNGs to tools/shots/out/<screen>.png.
//
//   node tools/shots/run.mjs                 # every screen
//   node tools/shots/run.mjs home live       # just these
//   CHROME=/path/to/chrome node tools/shots/run.mjs
//
// Add a screen by adding an entry to SCREENS: { seed: bool, steps: async (page, h) => {} }.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer, USER, PASS } from './server.mjs';
import * as fx from './fixtures.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Put an account plus some history and favourites in the app's store, as a returning user. */
async function seed(page, url, coach = null, extra = {}) {
  const abs = (s) => (s && s.startsWith('/') ? url + s : s);
  const liveItem = (s) => ({ type: 'live', id: String(s.stream_id), name: s.name, icon: abs(s.stream_icon), num: String(s.num), categoryId: s.category_id });
  const movieItem = (s) => ({ type: 'movie', id: String(s.stream_id), name: s.name, icon: abs(s.stream_icon), ext: 'mp4', categoryId: s.category_id, added: s.added });
  const seriesItem = (s) => ({ type: 'series', id: String(s.series_id), name: s.name, icon: abs(s.cover), categoryId: s.category_id });
  const data = {
    account: { id: '', name: 'Demo', server: url, user: USER, pass: PASS, ua: '', ok: true },
    cont: [fx.movies[3], fx.movies[40], fx.movies[77], fx.movies[120]].map(movieItem),
    episode: { type: 'episode', id: String(fx.series[2].series_id * 100 + 13), name: `${fx.series[2].name} S1E4`, ext: 'mp4', num: '4',
      parentId: String(fx.series[2].series_id), parentName: fx.series[2].name, parentIcon: abs(fx.series[2].cover) },
    recent: fx.live.slice(0, 12).map(liveItem),
    favLive: [fx.live[14], fx.live[30], fx.live[2], fx.live[51], fx.live[66], fx.live[90]].map(liveItem),
    favMovies: fx.movies.slice(10, 20).map(movieItem),
    favSeries: fx.series.slice(5, 13).map(seriesItem),
    coach,
    whatsNew: !!extra.whatsNew,
    queue: extra.queue ? [fx.movies[55], fx.movies[61]].map(movieItem) : [],
    watched: extra.watched ? [fx.movies[0], fx.movies[2], fx.movies[5], fx.movies[41], fx.movies[52]].map(movieItem) : [],
  };
  await page.evaluate(async (d) => {
    const s = await import('/js/store.js');
    localStorage.clear();
    s.saveAccount(d.account);
    s.setCurrent('');
    [...d.recent].reverse().forEach((i) => s.addHistory(i));
    [...d.cont].reverse().forEach((i, n) => { s.addHistory(i); s.setDuration(i, 6000000); s.setPosition(i, 900000 * (n + 1)); });
    s.addHistory(d.episode); s.setDuration(d.episode, 2700000); s.setPosition(d.episode, 1220000); // newest: an episode
    if (d.coach !== 'offer') localStorage.setItem('coach_asked', 'true'); // the welcome offer has its own screen
    if (!d.whatsNew) { const wn = await import('/js/whats-new.js'); localStorage.setItem('whatsnew_seen', wn.hash(wn.NOTES.trim())); }
    (d.queue || []).forEach((i) => s.queueAdd(i));
    (d.watched || []).forEach((i) => s.setWatched(i, true));
    if (d.coach === 'tour' || d.coach === 'tour-browse') localStorage.setItem('coach_on', 'true');
    if (d.coach === 'tour-browse') localStorage.setItem('coach_seen_home', 'true'); // straight to a section's tour
    d.favLive.forEach((i) => s.toggleFav(i));
    d.favMovies.forEach((i) => s.toggleFav(i));
    d.favSeries.forEach((i) => s.toggleFav(i));
    // The saved library (js/repo.js, IndexedDB), as after the first Setup.
    const repo = await import('/js/repo.js');
    await repo.refreshAll();
  }, data);
}

/** A brand-new account whose provider has nothing in it (saved, so launch lands on Home). */
async function seedEmpty(page, url) {
  await page.evaluate(async (acc) => {
    const s = await import('/js/store.js');
    localStorage.clear();
    s.saveAccount(acc); s.setCurrent('');
    localStorage.setItem('coach_asked', 'true');
    const wn = await import('/js/whats-new.js'); localStorage.setItem('whatsnew_seen', wn.hash(wn.NOTES.trim()));
    const repo = await import('/js/repo.js');
    await repo.refreshAll();
  }, { id: '', name: 'Demo', server: url, user: USER, pass: PASS, ua: '', ok: true });
}

/**
 * A stand-in for the TV's AVPlay: a coloured "video plane" fixed behind the page at the rect the
 * app asks for, so the preview's see-through hole can be checked in a desktop browser.
 */
const FAKE_AVPLAY = `(() => {
  let st = 'NONE';
  const plane = () => {
    let p = document.getElementById('fake-plane');
    if (!p) {
      p = document.createElement('div'); p.id = 'fake-plane';
      p.style.cssText = 'position:fixed;z-index:-1;display:none;background:linear-gradient(135deg,#c0392b,#e67e22 30%,#27ae60 60%,#2980b9);'
        + 'font:700 40px sans-serif;color:#fff;align-items:center;justify-content:center;';
      p.textContent = 'VIDEO';
      document.documentElement.appendChild(p);
    }
    return p;
  };
  // a desktop browser draws a "plugin not supported" box for the <object>; on a TV it is see-through
  document.addEventListener('DOMContentLoaded', () => {
    const st2 = document.createElement('style'); st2.textContent = 'object#av { opacity: 0 !important; }';
    document.head.appendChild(st2);
  });
  window.webapis = { avplay: {
    open() { st = 'IDLE'; }, close() { st = 'NONE'; plane().style.display = 'none'; },
    stop() { st = 'IDLE'; plane().style.display = 'none'; }, setListener() {},
    setDisplayRect(x, y, w, h) { Object.assign(plane().style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); },
    setStreamingProperty() {}, prepareAsync(ok) { st = 'READY'; setTimeout(ok, 300); },
    play() { st = 'PLAYING'; plane().style.display = 'flex'; }, pause() {}, seekTo() {}, getDuration() { return 0; },
    getState() { return st; }, setSpeed() {},
  } };
})();`;

/** Hold OK (Android long-press) on the focused element. */
const holdOk = async (page, ms = 700) => { await page.keyboard.down('Enter'); await wait(ms); await page.keyboard.up('Enter'); };

/** A signed-in account with nothing saved yet: launch goes splash -> Setup. */
async function seedAccountOnly(page, url) {
  await page.evaluate(async (acc) => {
    const s = await import('/js/store.js');
    localStorage.clear();
    s.saveAccount(acc); s.setCurrent('');
  }, { id: '', name: 'Demo', server: url, user: USER, pass: PASS, ua: '', ok: true });
}

const fillLogin = async (page, f) => {
  await page.waitForSelector('.login input:focus', { timeout: 8000 });
  for (const [k, v] of Object.entries(f)) await page.fill(`.login [name=${k}]`, v);
};

const press = async (page, key, times = 1, gap = 120) => {
  for (let i = 0; i < times; i++) { await page.keyboard.press(key); await wait(gap); }
};
const toHome = async (page) => { await page.waitForSelector('.card:focus', { timeout: 10000 }); await wait(300); };
/** From Home, move up to the bar and along to a tab, resting on it so it opens (dwell). */
const hoverTab = async (page, steps) => {
  await press(page, 'ArrowUp');
  await press(page, 'ArrowRight', steps, 150);
  await wait(900); // 450 ms dwell + page slide
};

/** Live TV, Favourite Channels, first channel, ▶: the TV guide (after the layout and the listings). */
const openGuide = async (page) => {
  await toHome(page); await hoverTab(page, 1);
  await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 1, 200); await wait(600);
  await press(page, 'ArrowRight'); await page.waitForSelector('.b-channels .row-cell:focus', { timeout: 8000 });
  await wait(300);
  await press(page, 'ArrowRight'); await page.waitForSelector('.b-guide:focus', { timeout: 8000 });
  await wait(1300);
};


/**
 * The player screens run on the AVPlay shim in demo mode (js/avplay-shim.js): a stand-in video
 * plane behind the page, a real-time clock, fake audio/subtitle tracks and subtitle lines.
 * `play` opens the player straight through the router, the way Open.play does.
 */
async function openPlayer(page, url, what, setup = {}) {
  await toHome(page);
  await page.evaluate(async ({ what, url, fxLive, fxMovie, fxSeries, setup }) => {
    const abs = (s) => (s && s.startsWith('/') ? url + s : s);
    const m = await import('/js/avplay-shim.js');
    const shim = m.createAvplayShim({ demo: true });
    if (setup.fail) shim.failWhen = () => true;
    window.webapis = { avplay: shim };
    window.__shim = shim;
    const store = await import('/js/store.js');
    for (const [k, v] of Object.entries(setup.prefs || {})) localStorage.setItem(k, String(v));
    const { router } = await import('/js/router.js');
    if (what === 'live') {
      const channels = fxLive.map((s) => ({ type: 'live', id: String(s.stream_id), name: s.name, icon: abs(s.stream_icon), num: String(s.num) }));
      if (!store.isFav(channels[setup.index || 0])) store.toggleFav(channels[setup.index || 0]);
      router.go('player-live', { channels, index: setup.index || 0 });
    } else if (what === 'movie') {
      const item = { type: 'movie', id: String(fxMovie.stream_id), name: fxMovie.name, icon: abs(fxMovie.stream_icon), ext: 'mp4' };
      store.setPosition(item, setup.resume || 0);
      if (setup.queued) store.queueAdd({ type: 'movie', id: String(setup.queued.stream_id), name: setup.queued.name, icon: abs(setup.queued.stream_icon), ext: 'mp4' });
      router.go('player-vod', { queue: [item], index: 0 });
    } else {
      const queue = [1, 2, 3].map((n) => ({ type: 'episode', id: String(fxSeries.series_id * 100 + n), name: ['The Lighthouse Keeper', 'Low Tide', 'What the Fog Hid'][n - 1],
        num: String(n), ext: 'mp4', parentId: String(fxSeries.series_id), parentName: fxSeries.name, parentIcon: abs(fxSeries.cover),
        ...(setup.season ? { season: 1 } : {}) }));
      router.go('player-vod', { queue, index: 0 });
    }
  }, { what, url, fxLive: fx.live.slice(0, 40), fxMovie: fx.movies[3], fxSeries: fx.series[2], setup });
  await page.waitForSelector('.player', { timeout: 8000 });
};
const shimDo = (page, fn, arg) => page.evaluate(fn, arg);

/**
 * The movie / series pages, opened the way a card does (Open.item with the library's own item).
 * `setup.history`: episodes of that series to put in the watch history first, oldest first, as
 * [season, episodeIndex, positionMs, durationMs] (position 0 = watched to the end).
 */
async function openDetail(page, type, id, setup = {}) {
  await toHome(page);
  await page.evaluate(async ({ type, id, setup }) => {
    const repo = await import('/js/repo.js');
    const store = await import('/js/store.js');
    const item = (await repo.streams(type, null)).find((x) => x.id === String(id));
    for (const [season, i, pos, dur] of setup.history || []) {
      const ep = { type: 'episode', id: String(id * 100 + season * 10 + i), name: 'Episode', num: String(i + 1), ext: 'mp4',
        parentId: String(id), parentName: item.name, parentIcon: item.icon };
      store.addHistory(ep); store.setDuration(ep, dur); store.setPosition(ep, pos);
    }
    if (setup.resume) store.setPosition(item, setup.resume);
    const { openItem } = await import('/js/open.js');
    openItem(item);
  }, { type, id, setup });
  await page.waitForSelector('.detail-page .dp-buttons button:focus', { timeout: 8000 });
}
const SHOW = 8002; // fx.series[2]: 3 seasons, a trailer, S1E4 in progress from the seed
const WATCHED = [[1, 0, 0, 2820000], [1, 1, 0, 2700000], [1, 2, 0, 2940000], [1, 3, 1220000, 2700000]]; // E1-E3 seen, E4 newest

export /** Home → the Search tab (OK), then into the box; optionally type a query and wait for it. */
const openSearch = async (page, q) => {
  await toHome(page);
  await press(page, 'ArrowUp'); await press(page, 'ArrowRight', 4, 60); await press(page, 'Enter');
  await page.waitForSelector('.search .s-box', { timeout: 8000 });
  await wait(700); // OK on the tab opens Search with focus on the built-in keyboard
  await page.waitForSelector('.search .keypad .kp-key:focus', { timeout: 8000 });
  if (q) { await typeKeys(page, '.search .keypad', q); await wait(900); }
  else await wait(300);
};
/** Types with the on-screen keyboard (a click on each key, as OK would). */
const typeKeys = async (page, pad, q) => {
  for (const ch of q) {
    await page.evaluate(([p, c]) => document.querySelector(`${p} [data-key="${c}"]`).click(), [pad, ch]);
    await wait(40);
  }
};
/** From the search box: ▼ to the chips (the nearest one, Movies), along to chip n, OK. */
const pickChip = async (page, n) => {
  await press(page, 'ArrowDown');
  const at = await page.evaluate(() => Number(document.activeElement.dataset.chip));
  await press(page, n < at ? 'ArrowLeft' : 'ArrowRight', Math.abs(n - at)); await press(page, 'Enter'); await wait(700);
};
/** Home → Settings (OK on the tab), then ▼ until the row with this key has focus. */
const openSettings = async (page, key, already = false) => {
  if (!already) await toHome(page);
  await press(page, 'ArrowUp'); await press(page, 'ArrowRight', 5, 60); await press(page, 'Enter');
  await page.waitForSelector('.settings-col .srow', { timeout: 8000 });
  await wait(700);
  if (await page.evaluate(() => !document.activeElement.classList.contains('srow'))) await press(page, 'ArrowDown');
  for (let i = 0; key && i < 60; i++) {
    if (await page.evaluate((k) => document.activeElement && document.activeElement.dataset.key === k, key)) break;
    await press(page, 'ArrowDown', 1, 90);
  }
  await wait(600);
};

const SCREENS = {
  // ---- added with the Android app's newer features (watched, queue, skip intro, picture, rename)
  'home-queue': { // "Your Queue" under Continue Watching, ✓ on watched cards
    seed: true, extra: { queue: true, watched: true },
    steps: async (page) => { await toHome(page); await press(page, 'ArrowDown', 1, 300); await wait(1100); },
  },
  'home-menu': { // Hold OK on a Continue Watching film: Favourite, Queue, Watched, Remove
    seed: true, extra: { queue: true },
    steps: async (page) => { await toHome(page); await press(page, 'ArrowRight'); await holdOk(page); await wait(500); },
  },
  'home-menu-episode': { // ... on an episode: "Series  ·  Episode", no Favourite
    seed: true,
    steps: async (page) => { await toHome(page); await holdOk(page); await wait(500); },
  },
  'home-recs': { // "Because you watched …" rows under the Top 10 (TMDB stand-in)
    seed: true, extra: { watched: true },
    steps: async (page) => {
      await toHome(page);
      await page.waitForSelector('.home-row[data-row="rec_0"]', { timeout: 15000 });
      await press(page, 'ArrowDown', 7, 300); await press(page, 'ArrowRight', 1); await wait(1100);
    },
  },
  'home-whatsnew': { // the first Home after an update: What's New
    seed: true, extra: { whatsNew: true },
    steps: async (page) => { await toHome(page); await page.waitForSelector('.dialog', { timeout: 8000 }); await wait(500); },
  },
  'movies-watched': { // the grid: ✓ on films you've seen
    seed: true, extra: { watched: true },
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 2);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 3, 200); await wait(500);
      await press(page, 'ArrowRight'); await page.waitForSelector('.poster-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowRight'); await wait(1100);
    },
  },
  'movies-menu': { // Hold OK on a poster: Favourite, Add to Queue, Mark as Watched
    seed: true, extra: { watched: true },
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 2);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 3, 200); await wait(500);
      await press(page, 'ArrowRight'); await page.waitForSelector('.poster-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowRight'); await wait(400); await holdOk(page); await wait(500);
    },
  },
  'live-rename': { // Hold OK on a category → ✎ Rename: the name box, Original Name / Cancel / Save
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 5, 200); await wait(500);
      await holdOk(page); await wait(500);
      await press(page, 'ArrowDown'); await press(page, 'Enter'); await page.waitForSelector('.dialog-input', { timeout: 8000 }); await wait(500);
    },
  },
  'live-renamed': { // ... saved: the list shows your name, toast
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 5, 200); await wait(500);
      await holdOk(page); await wait(500);
      await press(page, 'ArrowDown'); await press(page, 'Enter'); await page.waitForSelector('.dialog-input', { timeout: 8000 });
      await page.fill('.dialog-input', 'Weekend football');
      await press(page, 'ArrowDown'); await press(page, 'ArrowRight', 2); await press(page, 'Enter'); await wait(700);
    },
  },
  'settings-rename': { // Settings → Rename Categories: pick a section
    seed: true,
    steps: async (page) => { await openSettings(page, 'rename'); await press(page, 'Enter'); await wait(600); },
  },
  'settings-whatsnew': { // Settings → What's New
    seed: true,
    steps: async (page) => { await openSettings(page, 'whats_new'); await press(page, 'Enter'); await wait(600); },
  },
  'movie-queue': { // a film in your Queue and watched: ✓ In Queue, ✓ Watched
    seed: true, extra: { queue: true },
    steps: async (page) => {
      await openDetail(page, 'movie', fx.movies[55].stream_id); await wait(900);
      await press(page, 'ArrowRight', 4, 200); await press(page, 'Enter'); await wait(700);
    },
  },
  'series-watched': { // E1–E3 marked watched: ✓ on the cards, "Season 1  3/…" on the pill
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW, { history: WATCHED });
      await page.evaluate(async (id) => {
        const store = await import('/js/store.js');
        for (const i of [0, 1, 2]) store.setWatched({ type: 'episode', id: String(id * 100 + 10 + i) }, true);
      }, SHOW);
      await press(page, 'ArrowDown', 2, 300); await press(page, 'ArrowRight', 1, 300);
      await press(page, 'ArrowUp', 1, 300); await press(page, 'ArrowDown', 1, 300); await wait(900);
    },
  },
  'series-epmenu': { // Hold OK on an episode: Queue, Watched, the whole season
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW, { history: WATCHED }); await wait(600);
      await press(page, 'ArrowDown', 2, 300); await press(page, 'ArrowRight', 1, 300); await holdOk(page); await wait(500);
    },
  },
  'series-season-watched': { // ... Mark Season as Watched: every card ✓, "Season 1  ✓"
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW, { history: WATCHED }); await wait(600);
      await press(page, 'ArrowDown', 2, 300); await press(page, 'ArrowRight', 1, 300); await holdOk(page); await wait(500);
      await press(page, 'ArrowDown', 2, 150); await press(page, 'Enter'); await wait(900);
    },
  },
  'player-skip': { // an episode's opening titles: the Skip Intro button
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'episode', { season: true }); await wait(6000); },
  },
  'player-skipped': { // OK: past the intro, "Skipped the intro"
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'episode', { season: true }); await wait(6000); await press(page, 'Enter'); await wait(700); },
  },
  'player-picture': { // Hold OK in a film, down to Picture: Fit ✓, Fill, Stretch, 16:9, 4:3
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'movie'); await wait(1000);
      await holdOk(page); await wait(300); await press(page, 'ArrowDown', 8, 120); await wait(500);
    },
  },
  'player-picture-43': { // ... 4:3 picked: the picture is a 4:3 box, the status pill says so
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'movie'); await wait(1000);
      await holdOk(page); await wait(300);
      for (let i = 0; i < 25; i++) {
        if (await page.evaluate(() => document.activeElement.querySelector('.tp-label')?.textContent === '4:3')) break;
        await press(page, 'ArrowDown', 1, 120);
      }
      await press(page, 'Enter'); await wait(700);
    },
  },
  'player-nextqueue': { // the end of a film with something queued: Watch credits | Next in Queue
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'movie', { queued: fx.movies[55] }); await wait(1200);
      await shimDo(page, () => window.__shim.seekTo(112 * 60000 - 29000));
      await wait(4200);
    },
  },
  splash: { seed: false, steps: async () => { await wait(1000); } },
  login: { // first run: empty form, focus on the server field
    seed: false,
    steps: async (page) => { await page.waitForSelector('.login input:focus', { timeout: 8000 }); await wait(400); },
  },
  'login-filled': { // details typed, focus on "Log in"
    seed: false,
    steps: async (page) => {
      await fillLogin(page, { name: 'Home', server: 'http://demo.example:8080', user: 'demo', pass: 'demo' });
      await page.focus('.login [name=pass]');
      await press(page, 'ArrowDown'); await wait(400);
    },
  },
  'login-error': { // unreachable server: the detailed error, after every candidate address
    seed: false,
    steps: async (page) => {
      await fillLogin(page, { server: 'http://127.0.0.1:9/xtream', user: 'demo', pass: 'demo' });
      await page.focus('.login [name=pass]');
      await press(page, 'ArrowDown'); await press(page, 'Enter');
      await page.waitForFunction(() => /Last address tried/.test(document.querySelector('.login-status')?.textContent || ''), null, { timeout: 15000 });
      await wait(300);
    },
  },
  setup: { // Live TV done, Movies counting, Series waiting for the provider
    seed: 'account',
    provider: { get_vod_streams: { trickleMs: 40000 }, get_series: { holdMs: 60000 } },
    steps: async (page) => {
      await page.waitForSelector('.setup-row[data-type="movie"] .setup-count', { timeout: 8000 });
      await page.waitForFunction(() => /so far/.test(document.querySelector('.setup-row[data-type="movie"] .setup-count').textContent), null, { timeout: 20000 });
      await wait(1500);
    },
  },
  'setup-error': { // Movies failed: reason, "Try Again" / "Continue Anyway"
    seed: 'account',
    provider: { get_vod_streams: { status: 502 } },
    steps: async (page) => { await page.waitForSelector('.setup-actions [data-action=retry]:focus', { timeout: 15000 }); await wait(400); },
  },
  home: {
    seed: true,
    steps: async (page) => { await toHome(page); await press(page, 'ArrowRight', 2); await wait(1100); },
  },
  'home-backup': { // down a few rows, then back up to the top bar: Home goes back to the top
    seed: true,
    steps: async (page) => { await toHome(page); await press(page, 'ArrowDown', 3, 300); await press(page, 'ArrowUp', 4, 300); await wait(900); },
  },
  'home-cw': { // Continue Watching: episode card ("<series>  ·  m:ss left", series art) focused
    seed: true,
    steps: async (page) => { await toHome(page); await wait(1100); },
  },
  'home-mid': { // scrolled down to Favourite Movies, a few cards in
    seed: true,
    steps: async (page) => { await toHome(page); await press(page, 'ArrowDown', 3, 300); await press(page, 'ArrowRight', 3, 300); await wait(1100); },
  },
  'home-top10': { // the Netflix UK Top 10 rows (local stand-in for the TSV)
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.waitForSelector('.home-row[data-row="top_movies"]', { timeout: 15000 });
      await press(page, 'ArrowDown', 5, 300); await press(page, 'ArrowRight', 1); await wait(1100);
    },
  },
  'home-bottom': { // last row, scrolled sideways past the screen edge
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.waitForSelector('.home-row[data-row="top_series"]', { timeout: 15000 });
      await press(page, 'ArrowDown', 8, 300); await press(page, 'ArrowRight', 9, 200); await wait(1100);
    },
  },
  'home-remove': { // Hold OK on Continue Watching: the film's options
    seed: true,
    steps: async (page) => { await toHome(page); await press(page, 'ArrowRight'); await holdOk(page); await wait(500); },
  },
  'home-fav': { // Hold OK on a Recently Added card, Add to Favourites: toast
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.waitForSelector('.home-row[data-row="new_movies"]', { timeout: 15000 });
      await press(page, 'ArrowDown', 7, 300); await holdOk(page); await wait(400); await press(page, 'Enter'); await wait(600);
    },
  },
  'home-return': { // open a Top 10 card, Back: Home comes back on the same card
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.waitForSelector('.home-row[data-row="top_movies"]', { timeout: 15000 });
      await press(page, 'ArrowDown', 5, 300); await press(page, 'ArrowRight', 2, 300);
      await press(page, 'Enter'); await wait(1200); await press(page, 'Escape'); await wait(1300);
    },
  },
  'home-empty': { // new account, nothing watched, empty provider
    seed: 'empty',
    provider: Object.fromEntries(['get_live_categories', 'get_vod_categories', 'get_series_categories', 'get_live_streams', 'get_vod_streams', 'get_series'].map((a) => [a, { body: [] }])),
    steps: async (page) => { await page.waitForSelector('.home-empty:not([hidden])', { timeout: 10000 }); await wait(800); },
  },
  'home-coach-offer': { // first Home ever: the tutorial offer after 1.5 s
    seed: true, coach: 'offer',
    steps: async (page) => { await toHome(page); await page.waitForSelector('.dialog', { timeout: 6000 }); await wait(400); },
  },
  'home-tour': { // the tutorial's second Home tip
    seed: true, coach: 'tour',
    steps: async (page) => { await toHome(page); await page.waitForSelector('.coach .coach-card.in', { timeout: 8000 }); await wait(700); await press(page, 'Enter'); await wait(900); },
  },
  'home-light': { // Settings -> Theme: Light (Ui.applyTheme(false))
    seed: true,
    light: true,
    steps: async (page) => { await toHome(page); await press(page, 'ArrowDown'); await wait(1100); },
  },
  'home-bar': { // the top bar with focus on a tab (highlight + current pill)
    seed: true,
    steps: async (page) => { await toHome(page); await press(page, 'ArrowUp'); await press(page, 'ArrowRight', 3, 60); await wait(350); },
  },
  // ---------------------------------------------------------------- Browse (BrowseActivity)
  live: { // arrival by hovering the tab: Favourite Channels open, then into the list
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 2, 200); await wait(500);
      await press(page, 'ArrowRight'); await page.waitForSelector('.b-channels .row-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowDown', 2); await wait(1300);
    },
  },
  // ---------------------------------------------------------------- TV guide (EpgGrid)
  guide: { // ▶ from Favourite Channels: the guide, focus on what's on now
    seed: true,
    steps: async (page) => { await openGuide(page); },
  },
  'guide-future': { // ▶: the next programme ("· later" in the panel)
    seed: true,
    steps: async (page) => { await openGuide(page); await press(page, 'ArrowRight', 1, 200); await wait(400); },
  },
  'guide-gap': { // ▶ ▶: into a gap in the listings (nothing highlighted, "No guide information")
    seed: true,
    steps: async (page) => { await openGuide(page); await press(page, 'ArrowRight', 2, 200); await wait(400); },
  },
  'guide-details': { // Hold OK: the programme details dialog
    seed: true,
    steps: async (page) => { await openGuide(page); await press(page, 'ArrowRight', 1, 200); await holdOk(page); await wait(500); },
  },
  'guide-time': { // far along in time: the window has moved on, no "now" line
    seed: true,
    steps: async (page) => { await openGuide(page); await press(page, 'ArrowRight', 7, 150); await wait(500); },
  },
  'guide-down': { // a 3000-channel category, well down the channels
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 28, 70); await wait(600);
      await press(page, 'ArrowRight'); await page.waitForSelector('.b-channels .row-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowDown', 4, 80); await wait(300);
      await press(page, 'ArrowRight'); await wait(900);
      await press(page, 'ArrowDown', 25, 90); await wait(1500);
    },
  },
  'guide-nodata': { // a channel with no listings: "No information", "No guide information"
    seed: true,
    steps: async (page) => {
      await openGuide(page);
      for (let i = 0; i < 6; i++) {
        const id = await page.evaluate(() => document.querySelector('.g-row.sel')?.dataset.ch);
        if (id === '1051') break;
        await press(page, 'ArrowDown', 1, 250);
      }
      await wait(900);
    },
  },
  'guide-preview': { // the (stand-in) preview moved up into the guide's top strip
    seed: true, video: true,
    steps: async (page) => { await openGuide(page); await wait(1500); },
  },
  'guide-light': { // light theme
    seed: true, light: true,
    steps: async (page) => { await openGuide(page); await press(page, 'ArrowDown', 1, 200); await wait(500); },
  },
  'live-cats': { // the category list focused: glider, the open category marked, the hint underneath
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 5, 200); await wait(1300);
    },
  },
  'live-preview': { // a (stand-in) AVPlay: the video shows through the panel's preview box
    seed: true, video: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 3, 200); await wait(500);
      await press(page, 'ArrowRight'); await page.waitForSelector('.b-channels .row-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowDown', 1); await wait(1800);
    },
  },
  'live-search': { // Search: OK opens the box; typing searches the whole section
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'Enter'); await wait(300);
      await typeKeys(page, '.b-keys', 'sky ne'); await wait(900);
    },
  },
  'live-long': { // 3000 channels in one category, far down the list
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown');
      await press(page, 'ArrowDown', 28, 70); await wait(600);
      await press(page, 'ArrowRight'); await page.waitForSelector('.b-channels .row-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowDown', 60, 40); await wait(1300);
    },
  },
  'live-empty': { // new account: Favourite Channels is empty
    seed: 'empty',
    provider: Object.fromEntries(['get_live_streams', 'get_vod_streams', 'get_series'].map((a) => [a, { body: [] }])),
    steps: async (page) => {
      await page.waitForSelector('.home-empty:not([hidden])', { timeout: 10000 });
      await hoverTab(page, 1); await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 1, 200); await wait(1100);
    },
  },
  'live-catmenu': { // Hold OK on a category: Favourite / Rename / Hide
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 5, 200); await wait(500);
      await holdOk(page); await wait(500);
    },
  },
  'live-hidden': { // ... Hide: the category goes, toast says where to bring it back
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 5, 200); await wait(500);
      await holdOk(page); await wait(400); await press(page, 'ArrowDown', 2); await press(page, 'Enter'); await wait(700);
    },
  },
  'live-favcat': { // ... Favourite: pinned under the special entries with a ♥
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 7, 200); await wait(500);
      await holdOk(page); await wait(400); await press(page, 'Enter'); await wait(700);
    },
  },
  'live-tour': { // the Live TV tour's second tip (Channels)
    seed: true, coach: 'tour-browse',
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await page.waitForSelector('.coach .coach-card.in', { timeout: 8000 }); await wait(700);
      await press(page, 'Enter'); await wait(900);
    },
  },
  'live-light': { // light theme
    seed: true, light: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 1);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 4, 200); await wait(500);
      await press(page, 'ArrowRight'); await page.waitForSelector('.b-channels .row-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowDown'); await wait(1300);
    },
  },
  movies: { // All, second poster
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 2);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 3, 200); await wait(500);
      await press(page, 'ArrowRight'); await page.waitForSelector('.poster-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowRight'); await wait(1100);
    },
  },
  'movies-fav': { // arrival: Favourite Movies shown, list on Search, nothing marked yet
    seed: true,
    steps: async (page) => { await toHome(page); await hoverTab(page, 2); await press(page, 'ArrowDown'); await wait(1100); },
  },
  'movies-scrolled': { // a few rows down a long grid
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 2);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 3, 200); await wait(500);
      await press(page, 'ArrowRight'); await page.waitForSelector('.poster-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowDown', 6, 150); await press(page, 'ArrowRight', 2); await wait(1100);
    },
  },
  'series-browse': { // Continue Watching (one entry per series), then into a provider category
    seed: true,
    steps: async (page) => {
      await toHome(page); await hoverTab(page, 3);
      await press(page, 'ArrowDown'); await press(page, 'ArrowDown', 5, 200); await wait(500);
      await press(page, 'Enter'); await page.waitForSelector('.poster-cell:focus', { timeout: 8000 });
      await press(page, 'ArrowDown'); await wait(1100);
    },
  },
  'filters-countries': { // Settings → Countries & Languages
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.evaluate(async () => { const f = await import('/js/filter-settings.js'); f.countries(); });
      await page.waitForSelector('.dialog .dialog-check', { timeout: 8000 });
      await press(page, 'ArrowDown', 2); await press(page, 'Enter'); await press(page, 'ArrowDown'); await wait(400);
    },
  },
  'filters-hidden': { // Settings → Hidden Categories (FR hidden by the country filter, one by hand)
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.evaluate(async () => {
        const f = await import('/js/filters.js');
        f.setHiddenTags(new Set(['FR', 'AR']));
        f.setCategoryHidden('movie', '205', true);
        const fs = await import('/js/filter-settings.js'); fs.hidden();
      });
      await page.waitForSelector('.dialog .dialog-check', { timeout: 8000 });
      await press(page, 'ArrowDown'); await wait(400);
    },
  },
  search: { // arrival: focus in the box, All picked, "Type to search everything"
    seed: true,
    steps: async (page) => { await openSearch(page); },
  },
  'search-all': { // All: a shelf per section, "Channels  ·  40+" / "Movies  ·  18" / "Series  ·  13"
    seed: true,
    steps: async (page) => { await openSearch(page, 'gold'); await press(page, 'Enter'); await wait(500); await press(page, 'ArrowRight', 2); await wait(400); },
  },
  'search-all-down': { // ... down to the Series shelf
    seed: true,
    steps: async (page) => { await openSearch(page, 'gold'); await press(page, 'Enter'); await wait(500); await press(page, 'ArrowDown', 2, 250); await press(page, 'ArrowRight'); await wait(500); },
  },
  'search-one': { // All, hits in one section only: that section as the full grid
    seed: true,
    steps: async (page) => { await openSearch(page, 'sky ne'); await press(page, 'Enter'); await wait(500); },
  },
  'search-live': { // the Live TV chip: channels as a grid (up to 120)
    seed: true,
    steps: async (page) => { await openSearch(page, 'gold'); await pickChip(page, 1); await press(page, 'ArrowDown', 2, 250); await wait(500); },
  },
  'search-movies': { // the Movies chip: posters as a grid
    seed: true,
    steps: async (page) => { await openSearch(page, 'gold'); await pickChip(page, 2); await press(page, 'ArrowDown'); await press(page, 'ArrowRight', 2); await wait(500); },
  },
  'search-series': { // the Series chip, focus still on the chip
    seed: true,
    steps: async (page) => { await openSearch(page, 'gold'); await pickChip(page, 3); },
  },
  'search-none': { // No results for "qzx"; Enter leaves the box for the Search tab
    seed: true,
    steps: async (page) => { await openSearch(page, 'qzx'); },
  },
  'search-short': { // one character: still "Type to search everything"
    seed: true,
    steps: async (page) => { await openSearch(page, 'g'); },
  },
  'search-fav': { // Hold OK on a result: favourite toggled, toast
    seed: true,
    steps: async (page) => { await openSearch(page, 'gold'); await press(page, 'Enter'); await wait(500); await press(page, 'ArrowDown'); await holdOk(page); await wait(400); },
  },
  'search-tour': { // the Search tour's second tip (the chips)
    seed: true, coach: 'tour-browse',
    steps: async (page) => { await openSearch(page); await page.waitForSelector('.coach', { timeout: 8000 }); await wait(700); await press(page, 'Enter'); await wait(700); },
  },
  'search-light': { // light theme
    seed: true, light: true,
    steps: async (page) => { await openSearch(page, 'gold'); await press(page, 'Enter'); await wait(500); },
  },
  settings: { // arrival: ACCOUNTS, focus on the first actionable row
    seed: true, accounts: 2,
    steps: async (page) => { await openSettings(page); },
  },
  'settings-appearance': { // Theme, Live TV Preview, Hide What You Don't Watch
    seed: true,
    steps: async (page) => { await openSettings(page, 'preview'); },
  },
  'settings-home': { // Customise Home Screen, one row switched Off
    seed: true,
    steps: async (page) => { await openSettings(page, 'home_fav_series'); await press(page, 'Enter'); await wait(300); },
  },
  'settings-subtitles': { // Size → Large, Colour → Yellow: the sample frame follows
    seed: true,
    steps: async (page) => {
      await openSettings(page, 'sub_size'); await press(page, 'Enter'); await press(page, 'ArrowDown'); await press(page, 'Enter');
      await press(page, 'ArrowDown', 3, 200); await wait(500); // on to Live Stream Format: the sample is in view
    },
  },
  'settings-subtitles-bg': { // Background On at 50 %
    seed: true,
    steps: async (page) => {
      await openSettings(page, 'sub_bg'); await press(page, 'Enter'); await press(page, 'ArrowDown'); await press(page, 'Enter', 3);
      await press(page, 'ArrowDown', 2, 200); await wait(500);
    },
  },
  'settings-opacity-toast': { // Background Opacity with Background off: "Turn Background on to see this"
    seed: true,
    steps: async (page) => { await openSettings(page, 'sub_opacity'); await press(page, 'Enter'); await wait(400); },
  },
  'settings-playback': { // Live Stream Format, Fix Frozen Video Automatically, User Agent
    seed: true,
    steps: async (page) => { await openSettings(page, 'auto_recover'); },
  },
  'settings-useragent': { // the User Agent dialog: message, field, Default / Cancel / Save
    seed: true,
    steps: async (page) => { await openSettings(page, 'user_agent'); await press(page, 'Enter'); await page.waitForSelector('.dialog-input', { timeout: 8000 }); await wait(400); },
  },
  'settings-useragent-save': { // ... ▼: on to Save
    seed: true,
    steps: async (page) => { await openSettings(page, 'user_agent'); await press(page, 'Enter'); await page.waitForSelector('.dialog-input', { timeout: 8000 }); await press(page, 'ArrowDown'); await wait(400); },
  },
  'settings-library': { // Refresh Automatically, Refresh Now ("Updated today at HH:mm"), Clear Watch History, Show Tutorial
    seed: true,
    steps: async (page) => { await openSettings(page, 'refresh_now'); },
  },
  'settings-clear': { // Clear Watch History: the toast
    seed: true,
    steps: async (page) => { await openSettings(page, 'clear_history'); await press(page, 'Enter'); await wait(400); },
  },
  'settings-about': { // the end of the list: Version and the credit
    seed: true,
    steps: async (page) => { await openSettings(page, 'whats_new'); await press(page, 'ArrowDown'); await wait(600); },
  },
  'settings-remove': { // Remove This Account: the confirm dialog
    seed: true, accounts: 2,
    steps: async (page) => { await openSettings(page, 'remove_account'); await press(page, 'Enter'); await page.waitForSelector('.dialog', { timeout: 8000 }); await wait(400); },
  },
  'settings-countries': { // Countries & Languages from its row
    seed: true,
    steps: async (page) => { await openSettings(page, 'countries'); await press(page, 'Enter'); await page.waitForSelector('.dialog .dialog-check', { timeout: 8000 }); await press(page, 'ArrowDown', 2); await wait(400); },
  },
  'settings-hidden': { // Hidden Categories from its row
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.evaluate(async () => { const f = await import('/js/filters.js'); f.setHiddenTags(new Set(['FR'])); f.setCategoryHidden('movie', '205', true); });
      await openSettings(page, 'hidden', true); await press(page, 'Enter'); await page.waitForSelector('.dialog .dialog-check', { timeout: 8000 }); await wait(400);
    },
  },
  'settings-offline': { // the provider is down: Subscription says so
    seed: true, provider: { null: { status: 502 } },
    steps: async (page) => { await openSettings(page); await wait(1200); },
  },
  'settings-light': { // light theme
    seed: true, light: true,
    steps: async (page) => { await openSettings(page, 'preview'); },
  },
  'settings-theme': { // OK on Theme: the app restarts at Home in the light theme
    seed: true,
    steps: async (page) => { await openSettings(page, 'theme'); await press(page, 'Enter'); await toHome(page); await wait(900); },
  },
  'settings-tutorial': { // Show Tutorial: back at Home with the tour running again
    seed: true,
    steps: async (page) => { await openSettings(page, 'tutorial'); await press(page, 'Enter'); await page.waitForSelector('.coach', { timeout: 8000 }); await wait(900); },
  },
  dialog: { // shared modal dialog over Home
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.evaluate(async () => {
        const { showDialog } = await import('/js/ui/dialog.js');
        showDialog({ title: 'Remove from Continue Watching?', message: 'The Iron Harbour', positive: 'Remove', negative: 'Cancel', focus: 'negative' });
      });
      await wait(400);
    },
  },
  'player-live': { // the live banner: logo, number, name ♥, now, time + bar, next, hint
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'live', { index: 2 }); await wait(1500); },
  },
  'player-channels': { // OK: the Channels list on the playing channel (▶), favourites ♥, gliding highlight
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'live', { index: 2 }); await wait(800);
      await press(page, 'Enter'); await wait(300); await press(page, 'ArrowDown', 2, 260); await wait(500);
    },
  },
  'player-menu': { // live Hold OK: Favourites, Subtitles, Audio, Subtitle Size
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'live', { index: 2 }); await wait(1000); await holdOk(page); await wait(500); },
  },
  'player-tracks': { // a film: Subtitles & Audio, a subtitle line underneath
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'movie'); await wait(1000);
      await holdOk(page); await wait(300); await press(page, 'ArrowDown'); await wait(3600);
    },
  },
  'player-subs': { // a rendered subtitle line, default look (Medium, White, drop shadow)
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'movie'); await wait(4800); },
  },
  'player-subs-styled': { // Extra Large, Yellow, background 50 %
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'movie', { prefs: { sub_size: 3, sub_color: 1, sub_bg: true, sub_bg_opacity: 1 } });
      await wait(4800);
    },
  },
  'player-vod': { // a film resumed: sheet with title, bar, elapsed / −remaining, hint, the resume toast
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'movie', { resume: 1234000 }); await wait(900); },
  },
  'player-episode': { // an episode paused: "Series · Episode 1", centre icon, sheet pinned
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'episode'); await wait(2500);
      await press(page, 'Enter'); await wait(600);
    },
  },
  'player-seek': { // ▶ ▶ ▶: the "+30 sec" bubble
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'movie', { resume: 1234000 }); await wait(2500); await press(page, 'ArrowRight', 3, 150); await wait(250); },
  },
  'player-scrub': { // ▼ then ▶ x4: the knob, the lighter stretch ahead, the time over the knob
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'movie', { resume: 1234000 }); await wait(1500);
      await press(page, 'ArrowDown'); await press(page, 'ArrowRight', 4, 150); await wait(300);
    },
  },
  'player-nextup': { // the last 30 s of an episode: Watch credits | Next Episode filling up
    seed: true,
    steps: async (page, h) => {
      await openPlayer(page, h.url, 'episode'); await wait(1200);
      await shimDo(page, () => window.__shim.seekTo(45 * 60000 - 29000));
      await wait(4200);
    },
  },
  'player-error': { // live: retries, the other format, then the card
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'live', { index: 2, fail: true }); await wait(9500); },
  },
  'player-status': { // the status pill ("Reconnecting…") over a film
    seed: true,
    steps: async (page, h) => { await openPlayer(page, h.url, 'movie', { fail: true }); await wait(600); },
  },
  movie: { // a film never started: ▶ Play focused, ▶ Trailer (from a watch?v= link), backdrop + scrims
    seed: true,
    steps: async (page) => { await openDetail(page, 'movie', fx.movies[26].stream_id); await wait(1400); },
  },
  'movie-resume': { // a film from Continue Watching: ▶ Resume H:MM:SS, ↺ Start Over, Trailer, Favourite
    seed: true,
    steps: async (page) => { await openDetail(page, 'movie', fx.movies[3].stream_id, { resume: 4521000 }); await wait(1400); },
  },
  'movie-fav': { // no trailer id: Play | Favourite; a favourite: ♥ In Favourites
    seed: true,
    steps: async (page) => { await openDetail(page, 'movie', fx.movies[13].stream_id); await press(page, 'ArrowRight'); await wait(1400); },
  },
  'movie-loading': { // get_vod_info not back yet: the list's line, the poster standing in as backdrop
    seed: true, provider: { get_vod_info: { holdMs: 60000 } },
    steps: async (page) => { await openDetail(page, 'movie', fx.movies[26].stream_id); await wait(1200); },
  },
  series: { // first visit: Specials + 2 seasons, Specials shown, ▶ Play focused
    seed: true,
    steps: async (page) => { await openDetail(page, 'series', fx.series[5].series_id); await wait(1400); },
  },
  'series-resume': { // in progress: opens on Season 1, ▶ Resume S1 · E4, watched / part-watched cards
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW, { history: WATCHED });
      await wait(1400);
    },
  },
  'series-season': { // ▼ onto the pills, ▶: Season 2 shown on focus alone
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW); await wait(600);
      await press(page, 'ArrowDown', 1, 300); await press(page, 'ArrowRight', 1, 300); await wait(900);
    },
  },
  'series-episode': { // ▼ ▼ into the shelf, ▶ ×3: Episode 4 (in progress) focused, its label and plot
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW, { history: WATCHED });
      await wait(600);
      await press(page, 'ArrowDown', 1, 300); await press(page, 'ArrowDown', 1, 300);
      await press(page, 'ArrowRight', 3, 300); await wait(900);
    },
  },
  'series-scrolled': { // far along the shelf: the HorizontalScrollView has moved
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW); await wait(500);
      await press(page, 'ArrowDown', 2, 300); await press(page, 'ArrowRight', 7, 200); await wait(900);
    },
  },
  'series-loading': { // "Loading episodes…"
    seed: true, provider: { get_series_info: { holdMs: 60000 } },
    steps: async (page) => { await openDetail(page, 'series', fx.series[5].series_id); await wait(1200); },
  },
  'series-error': { // "Couldn't load episodes — …"
    seed: true, provider: { get_series_info: { status: 502 } },
    steps: async (page) => { await openDetail(page, 'series', fx.series[5].series_id); await wait(1200); },
  },
  'series-light': { // light theme, an episode focused
    seed: true, light: true,
    steps: async (page) => {
      await openDetail(page, 'series', SHOW); await wait(500);
      await press(page, 'ArrowDown', 2, 300); await press(page, 'ArrowRight', 1, 300); await wait(900);
    },
  },
  trailer: { // ▶ Trailer: the youtube-nocookie embed full screen (an offline stand-in page)
    seed: true,
    steps: async (page) => {
      await openDetail(page, 'movie', fx.movies[3].stream_id, { resume: 4521000 }); await wait(800);
      await press(page, 'ArrowRight', 2, 250); await press(page, 'Enter'); await wait(1500);
    },
  },
  'trailer-fail': { // the embed reports an error: back on the film with "No trailer available"
    seed: true, trailerFail: true,
    steps: async (page) => {
      await openDetail(page, 'movie', fx.movies[3].stream_id, { resume: 4521000 }); await wait(800);
      await press(page, 'ArrowRight', 2, 250); await press(page, 'Enter'); await wait(1600);
    },
  },
  toast: {
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.evaluate(async () => { const { toast } = await import('/js/ui/toast.js'); toast('Added to Favourites — The Iron Harbour'); });
      await wait(400);
    },
  },
};

export async function shoot(names, { log = console.log } = {}) {
  const want = names.length ? names : Object.keys(SCREENS);
  for (const n of want) if (!SCREENS[n]) throw new Error(`Unknown screen "${n}". Known: ${Object.keys(SCREENS).join(', ')}`);
  await mkdir(OUT, { recursive: true });
  const server = await startServer(0);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
  const files = [];
  try {
    for (const name of want) {
      const scr = SCREENS[name];
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      // Never reach the internet: the Netflix Top 10 file comes from the fixtures, anything else
      // that isn't the local server is refused.
      await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.hostname === '127.0.0.1' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        if (u.hostname === 'www.netflix.com' && u.pathname === '/tudum/top10/data/all-weeks-countries.tsv') {
          return route.fulfill({ status: 200, contentType: 'text/tab-separated-values; charset=utf-8',
            headers: { 'Access-Control-Allow-Origin': '*', ETag: '"fixture"' }, body: fx.top10Tsv() });
        }
        // The Movie Database and TheIntroDB (Because You Watched, Skip Intro): local stand-ins.
        const cors = { 'Access-Control-Allow-Origin': '*' };
        if (u.hostname === 'api.themoviedb.org') {
          const tv = u.pathname.includes('/tv');
          let body = { results: [] };
          if (u.pathname.includes('/search/')) body = { results: [{ id: 4242 }] };
          else if (u.searchParams.get('page') === '1') {
            body = { results: (tv ? fx.series.slice(14, 26) : fx.movies.slice(84, 100)).map((x) => (tv ? { name: x.name } : { title: x.name })) };
          }
          return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
        }
        if (u.hostname === 'api.theintrodb.org') {
          return route.fulfill({ status: 200, contentType: 'application/json', headers: cors,
            body: JSON.stringify({ intro: [{ start_ms: 0, end_ms: 90000 }], credits: [{ start_ms: 41 * 60000, end_ms: null }] }) });
        }
        if (u.hostname === 'www.youtube-nocookie.com' && u.pathname.startsWith('/embed/')) {
          return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fx.trailerStandIn(u.pathname.split('/')[2], !!scr.trailerFail) });
        }
        return route.abort();
      });
      if (scr.video) await ctx.addInitScript(FAKE_AVPLAY);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log(`  [${name}] page error: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') log(`  [${name}] console: ${m.text()}`); });
      await page.goto(`${server.url}/index.html`);
      server.set(scr.provider);
      if (scr.seed === 'account') {
        await seedAccountOnly(page, server.url);
        await page.reload();
      } else if (scr.seed === 'empty') {
        await seedEmpty(page, server.url);
        await page.reload();
      } else if (scr.seed) {
        await seed(page, server.url, scr.coach || null, scr.extra || {});
        if (scr.light) await page.evaluate(() => localStorage.setItem('dark', 'false'));
        if (scr.accounts === 2) { // a second saved account, for Settings → ACCOUNTS
          await page.evaluate(async (server) => {
            const st = await import('/js/store.js');
            st.saveAccount({ ...st.newAccount(), name: '', server, user: 'guest', pass: 'guest', ua: '', ok: true });
            st.setCurrent('');
          }, server.url);
        }
        await page.reload();
      } else {
        await page.evaluate(() => localStorage.clear()); await page.reload();
      }
      await scr.steps(page, { url: server.url });
      const file = path.join(OUT, `${name}.png`);
      await page.screenshot({ path: file });
      files.push(file);
      log(`saved ${path.relative(process.cwd(), file)}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  shoot(process.argv.slice(2)).catch((e) => { console.error(e.message || e); process.exit(1); });
}
