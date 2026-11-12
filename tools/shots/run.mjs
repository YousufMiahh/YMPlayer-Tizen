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
async function seed(page, url, coach = null) {
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

export const SCREENS = {
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
  'home-remove': { // Hold OK on Continue Watching
    seed: true,
    steps: async (page) => { await toHome(page); await press(page, 'ArrowRight'); await holdOk(page); await wait(500); },
  },
  'home-fav': { // Hold OK on a Recently Added card: favourite toggled, toast
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await page.waitForSelector('.home-row[data-row="new_movies"]', { timeout: 15000 });
      await press(page, 'ArrowDown', 7, 300); await holdOk(page); await wait(600);
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
      await page.keyboard.type('sky ne', { delay: 60 }); await wait(900);
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
  'live-catmenu': { // Hold OK on a category: Favourite / Hide
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
      await holdOk(page); await wait(400); await press(page, 'ArrowDown'); await press(page, 'Enter'); await wait(700);
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
  series: { // Continue Watching (one entry per series), then into a provider category
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
  settings: {
    seed: true,
    steps: async (page) => {
      await toHome(page);
      await press(page, 'ArrowUp'); await press(page, 'ArrowRight', 5, 60); await press(page, 'Enter');
      await wait(700); await press(page, 'ArrowDown', 2); await wait(500);
    },
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
        await seed(page, server.url, scr.coach || null);
        if (scr.light) await page.evaluate(() => localStorage.setItem('dark', 'false'));
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
