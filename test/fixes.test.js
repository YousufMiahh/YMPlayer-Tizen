// @vitest-environment jsdom
// Integration-review fixes that have no screen of their own: the missing video engine, request
// timeouts, the TV's mute, the debounced backdrop, modal dialogs, tours that end with their
// screen, sliced search ranking, the build version stamp.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as store from '../js/store.js';
import * as api from '../js/api.js';
import * as player from '../js/player.js';
import { shim } from '../js/avplay-shim.js';
import { createPreview, muteTv, restoreTvMute, MUTE_FLAG } from '../js/live-preview.js';
import * as backdrop from '../js/ui/backdrop.js';
import { showDialog, isOpen as dialogOpen } from '../js/ui/dialog.js';
import * as coach from '../js/ui/coach.js';
import { createRouter } from '../js/router.js';
import * as match from '../js/match.js';
import { boot, exitApp } from '../js/app.js';
import { valid, stampConfig, stampVersionJs } from '../tools/stamp-version.mjs';

const read = (f) => readFileSync(resolve(process.cwd(), f), 'utf8');
const key = (keyCode, type = 'keydown', extra = {}) => {
  const e = new KeyboardEvent(type, { keyCode, bubbles: true, cancelable: true, ...extra });
  (document.activeElement || document.body).dispatchEvent(e);
  return e;
};

beforeEach(() => {
  localStorage.clear();
  const a = store.newAccount();
  Object.assign(a, { server: 'http://h.com:80', user: 'u', pass: 'p', ok: true });
  store.saveAccount(a);
  document.body.innerHTML = '<div id="root"></div><object id="av" type="application/avplayer" hidden></object>';
  player.stop();
  shim.reset();
  delete globalThis.webapis;
  delete globalThis.tizen;
});
afterEach(() => {
  vi.restoreAllMocks(); // before the real timers come back (a spy on the fake setTimeout must not be put back over them)
  vi.useRealTimers();
  delete globalThis.webapis;
  delete globalThis.tizen;
});

// ------------------------------------------------------------------ 1: the video engine

describe('the video engine (webapis.avplay)', () => {
  it('index.html loads Samsung\'s webapis.js as a classic script before the app module', () => {
    const html = read('index.html');
    const api$ = html.indexOf('<script src="$WEBAPIS/webapis/webapis.js"></script>');
    expect(api$).toBeGreaterThan(0);
    expect(api$).toBeLessThan(html.indexOf('<script type="module">'));
  });

  it('the shim stands in only where there is no Tizen at all', () => {
    expect(player.getAvplay()).toBe(shim); // a browser / these tests
    const real = { open() {} };
    globalThis.webapis = { avplay: real };
    expect(player.getAvplay()).toBe(real);
    globalThis.tizen = {};
    expect(player.getAvplay()).toBe(real);
    delete globalThis.webapis; // a TV whose webapis.js did not load
    expect(player.getAvplay()).toBeNull();
    expect(player.available()).toBe(false);
  });

  it('on a TV without AVPlay, open() reports it loudly and never touches the shim', () => {
    globalThis.tizen = {};
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const errors = [];
    const onError = (e) => errors.push(e);
    player.on('error', onError);
    player.open({ type: 'movie', id: '7', ext: 'mkv' });
    player.off('error', onError);
    expect(errors).toEqual([{ what: 'Video player unavailable on this TV', fatal: true }]);
    expect(shim.calls).toEqual([]);
    expect(log).toHaveBeenCalled();
    // nothing is "playing", and the calls a screen makes afterwards are harmless
    expect(player.current()).toBeNull();
    expect(player.isPlaying()).toBe(false);
    expect(player.position()).toBe(0);
    expect(() => { player.play(); player.pause(); player.seek(5); player.retry(); player.stop(); }).not.toThrow();
  });

  it('the live preview keeps the artwork on a TV without AVPlay', () => {
    globalThis.tizen = { tvaudiocontrol: { isMute: () => false, setMute: vi.fn() } };
    const box = document.createElement('div'); const logo = document.createElement('img');
    const p = createPreview({ box, logo, holes: () => [document.body] });
    expect(() => p.start({ type: 'live', id: '1' })).not.toThrow();
    expect(p.playing).toBe(false);
    expect(shim.calls).toEqual([]);
    expect(logo.style.opacity).toBe('1');
    expect(document.documentElement.classList.contains('preview-on')).toBe(false);
    expect(globalThis.tizen.tvaudiocontrol.setMute).not.toHaveBeenCalled();
    expect(() => { p.relayout(); p.stop(); }).not.toThrow();
  });
});

// ------------------------------------------------------------------ 3: timeouts

describe('request timeouts (Http.java: connect 15 s, read 45 s)', () => {
  const never = () => new Promise(() => {});
  const outcome = (p) => { const o = {}; p.then((v) => { o.value = v; }, (e) => { o.error = e; }); return o; };
  const body = (chunks) => { // a stream that sends these pieces and then goes quiet
    let i = 0;
    return { getReader: () => ({ read: () => (i < chunks.length ? Promise.resolve({ done: false, value: new TextEncoder().encode(chunks[i++]) }) : never()), cancel: async () => {} }) };
  };

  beforeEach(() => { vi.useFakeTimers(); });

  it('the values are Android\'s', () => {
    expect([api.CONNECT_TIMEOUT_MS, api.READ_TIMEOUT_MS]).toEqual([15000, 45000]);
  });

  it('a login that never answers fails after the connect timeout, and the request is aborted', async () => {
    let signal;
    globalThis.fetch = vi.fn((url, o) => { signal = o.signal; return never(); });
    const o = outcome(api.loginAt('http://h.com:80', 'u', 'p'));
    await vi.advanceTimersByTimeAsync(14999);
    expect(o.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(o.error.name).toBe('TimeoutError');
    expect(api.errorMessage(o.error)).toBe('The server took too long to answer');
    expect(api.isUnreachable(o.error)).toBe(false); // Login goes on to its next address
    expect(signal.aborted).toBe(true);
    const o2 = outcome(api.login()); // the saved account's check (Settings → Subscription)
    await vi.advanceTimersByTimeAsync(15001);
    expect(o2.error.name).toBe('TimeoutError');
  });

  it('a list download whose server accepts the connection and says nothing fails (Setup shows its retry)', async () => {
    globalThis.fetch = vi.fn(never);
    const o = outcome(api.streams('movie'));
    await vi.advanceTimersByTimeAsync(59999); // connect + the first read
    expect(o.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(o.error.name).toBe('TimeoutError');
  });

  it('a download that stalls part-way fails after the idle timeout; each piece restarts the clock', async () => {
    let feed;
    const reader = { read: () => new Promise((r) => { feed = (s) => r({ done: false, value: new TextEncoder().encode(s) }); }), cancel: async () => {} };
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, body: { getReader: () => reader } }));
    const o = outcome(api.streams('movie'));
    await vi.advanceTimersByTimeAsync(40000);
    feed('[{"stream_id":1,"name":"A"},');
    await vi.advanceTimersByTimeAsync(40000); // 80 s in all, but never 45 s without a byte
    expect(o.error).toBeUndefined();
    expect(api.progress('movie')).toBe(1);
    await vi.advanceTimersByTimeAsync(5001);
    expect(o.error.name).toBe('TimeoutError');
  });

  it('text answers time out mid-body too, and a quick answer leaves no timer behind', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, body: body(['{"user_info":']) }));
    const o = outcome(api.loginAt('http://h.com:80', 'u', 'p'));
    await vi.advanceTimersByTimeAsync(45001);
    expect(o.error.name).toBe('TimeoutError');
    globalThis.fetch = vi.fn(async () => new Response('{"user_info":{"auth":1}}'));
    const r = await api.loginAt('http://h.com:80', 'u', 'p');
    expect(r.user_info.auth).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    globalThis.fetch = vi.fn(async () => new Response('[{"category_id":"1","category_name":"A"}]'));
    expect((await api.categories('live')).length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('works where fetch ignores the abort signal, and without Response streams', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: never }));
    const o = outcome(api.categories('live'));
    await vi.advanceTimersByTimeAsync(45001);
    expect(o.error.name).toBe('TimeoutError'); // an error, not an empty list
  });
});

// ------------------------------------------------------------------ 4: the TV's mute

describe('the muted preview never leaves the TV muted', () => {
  let muted; let ac;
  beforeEach(() => {
    muted = false;
    ac = { isMute: () => muted, setMute: vi.fn((m) => { muted = m; }) };
    globalThis.tizen = { tvaudiocontrol: ac };
  });

  it('muting records it on the TV; restoring unmutes once and clears the record', () => {
    muteTv();
    expect(muted).toBe(true);
    expect(localStorage.getItem(MUTE_FLAG)).toBe('true');
    expect(restoreTvMute()).toBe(true);
    expect(muted).toBe(false);
    expect(localStorage.getItem(MUTE_FLAG)).toBeNull();
    expect(restoreTvMute()).toBe(false);
    expect(ac.setMute).toHaveBeenCalledTimes(2);
  });

  it('a TV the viewer muted themselves is left alone', () => {
    muted = true;
    muteTv();
    expect(localStorage.getItem(MUTE_FLAG)).toBeNull();
    expect(restoreTvMute()).toBe(false);
    expect(muted).toBe(true);
    expect(ac.setMute).not.toHaveBeenCalled();
  });

  it('a refused unmute keeps the record, so it is tried again', () => {
    muteTv();
    ac.setMute.mockImplementationOnce(() => { throw new Error('busy'); });
    expect(restoreTvMute()).toBe(false);
    expect(localStorage.getItem(MUTE_FLAG)).toBe('true');
    expect(restoreTvMute()).toBe(true);
  });

  it('the app died with the TV muted: the next launch gives the sound back', () => {
    muted = true;
    localStorage.setItem(MUTE_FLAG, 'true'); // left by the last run
    const dispose = boot(document.getElementById('root'));
    expect(muted).toBe(false);
    expect(localStorage.getItem(MUTE_FLAG)).toBeNull();
    dispose();
  });

  it('hidden, pagehide, beforeunload and exit all restore it', () => {
    const dispose = boot(document.getElementById('root'));
    const leave = [
      () => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.hidden;
      },
      () => window.dispatchEvent(new Event('pagehide')),
      () => window.dispatchEvent(new Event('beforeunload')),
      () => exitApp(),
    ];
    for (const go of leave) {
      muteTv();
      expect(muted).toBe(true);
      go();
      expect(muted).toBe(false);
      expect(localStorage.getItem(MUTE_FLAG)).toBeNull();
    }
    // coming back to the foreground does not unmute anything by itself
    muteTv();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(muted).toBe(true);
    dispose();
    restoreTvMute();
  });
});

// ------------------------------------------------------------------ 5: the backdrop

describe('backdrop.tint is debounced', () => {
  let t = 0;
  beforeEach(() => { vi.useFakeTimers(); t = 0; backdrop.setClock(() => t); backdrop._reset(); backdrop.install(document.body); backdrop.setSection('home'); });
  afterEach(() => { backdrop.setSampler(null); backdrop.setClock(null); backdrop.uninstall(); backdrop._reset(); });

  it('holding a direction key: only the artwork focus rests on is fetched', async () => {
    const sampler = vi.fn(async () => new Uint8ClampedArray([200, 30, 30, 255]));
    backdrop.setSampler(sampler);
    const resting = backdrop.current();
    for (let i = 0; i < 20; i++) { backdrop.tint(`http://x/${i}.png`); await vi.advanceTimersByTimeAsync(60); }
    expect(sampler).not.toHaveBeenCalled();
    expect(backdrop.current()).toBe(resting);
    await vi.advanceTimersByTimeAsync(backdrop.TINT_DELAY_MS);
    expect(sampler).toHaveBeenCalledTimes(1);
    expect(sampler).toHaveBeenCalledWith('http://x/19.png');
    t += backdrop.FADE_MS;
    expect(backdrop.current()).toBe(backdrop.tone(0xC81E1E)); // faded to that artwork's colour
    expect(backdrop.current()).not.toBe(resting);
  });

  it('a section change cancels a waiting tint, and every tint() promise settles', async () => {
    const sampler = vi.fn(async () => new Uint8ClampedArray([200, 30, 30, 255]));
    backdrop.setSampler(sampler);
    const settled = vi.fn();
    backdrop.tint('http://x/a.png').then(settled);
    backdrop.tint('http://x/b.png').then(settled);
    backdrop.setSection('movies');
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toHaveBeenCalledTimes(2);
    expect(sampler).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ 8, 9: dialogs

describe('dialogs are modal and wait for OK to be released', () => {
  it('opened while OK is held: OK is ignored until its key-up, whatever `repeat` says', async () => {
    key(13); // Hold OK begins on a card
    const d = showDialog({ title: 'Remove?', positive: 'Remove', negative: 'Cancel', focus: 'positive' });
    key(13); // the remote sends the held key again, as a new press (no repeat flag)
    key(13, 'keydown', { repeat: true });
    expect(dialogOpen()).toBe(true);
    key(13, 'keyup');
    key(13);
    expect(await d.result).toBe('positive');
  });

  it('opened with no key down: the first OK counts', async () => {
    const d = showDialog({ title: 'x', positive: 'Yes', negative: 'No', focus: 'negative' });
    key(13);
    expect(await d.result).toBe('negative');
  });

  it('no key reaches the screen underneath while it is open, typing in its own field still works', () => {
    const seen = [];
    const under = (e) => seen.push(e.keyCode);
    document.addEventListener('keydown', under);
    const d = showDialog({ title: 'User Agent', input: { value: '' }, positive: 'Save', negative: 'Cancel' });
    const typed = key(65); // 'a' in the field
    expect(typed.defaultPrevented).toBe(false); // the browser still types it
    key(39); // the caret
    for (const k of [415, 19, 413, 417, 412, 10252, 427, 428, 10133, 457, 403, 404, 38]) key(k);
    document.querySelector('.dialog-button').focus();
    for (const k of [415, 413, 427, 10133, 457, 403, 37, 39]) key(k);
    expect(seen).toEqual([]);
    d.close();
    key(415);
    expect(seen).toEqual([415]);
    document.removeEventListener('keydown', under);
  });

  it('with one dialog over another, only the top one takes the keys', async () => {
    const lower = showDialog({ title: 'a', items: ['one', 'two'] });
    const upper = showDialog({ title: 'b', positive: 'OK' });
    key(13);
    expect(await upper.result).toBe('positive');
    expect(dialogOpen()).toBe(true);
    lower.close();
  });
});

// ------------------------------------------------------------------ 10: tours end with their screen

describe('a tutorial overlay cannot outlive its screen', () => {
  it('leaving a screen by any route takes its tour down at once', () => {
    vi.useFakeTimers();
    localStorage.setItem('coach_on', 'true');
    const router = createRouter();
    const root = document.getElementById('root');
    router.init(root);
    const screen = (name) => () => ({
      mount(r) { r.textContent = name; coach.show(name, [{ target: null, title: 'T', body: 'B' }]); },
      unmount() { if (name === 'b') throw new Error('unmount failed'); },
    });
    router.register('a', screen('a')); router.register('b', screen('b'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const leave of [() => router.go('b'), () => router.back(), () => router.replace('b'), () => router.resetTo('a'), () => router.reset()]) {
      vi.advanceTimersByTime(coach.SHOW_DELAY_MS + 1);
      if (!coach.showing()) { localStorage.removeItem('coach_seen_a'); localStorage.removeItem('coach_seen_b'); router.resetTo('a'); vi.advanceTimersByTime(coach.SHOW_DELAY_MS + 1); }
      expect(coach.showing()).toBe(true);
      leave();
      expect(coach.showing()).toBe(false);
      expect(document.querySelector('.coach')).toBeNull();
      localStorage.removeItem('coach_seen_a'); localStorage.removeItem('coach_seen_b');
      if (!router.current()) { router.init(root); router.go('a'); }
    }
    router.reset();
  });
});

// ------------------------------------------------------------------ 15: search ranking in slices

describe('Match.rankAsync', () => {
  const lib = Array.from({ length: 9000 }, (_, i) => ({ type: 'movie', id: String(i), name: i % 7 === 0 ? `The Matrix ${i}` : i % 11 === 0 ? `UK: Matrix Reloaded ${i}` : `Film ${i}` }));

  it('gives rank()\'s hits in rank()\'s order, yielding between slices', async () => {
    vi.useFakeTimers();
    const st = vi.spyOn(globalThis, 'setTimeout');
    const p = match.rankAsync(lib, 'matrix', 120, { slice: 2000 });
    let out; p.then((v) => { out = v; });
    await Promise.resolve();
    expect(out).toBeUndefined(); // not one synchronous task
    await vi.runAllTimersAsync();
    expect(st).toHaveBeenCalledTimes(4); // 9000 items: after 2000, 4000, 6000, 8000
    expect(out.map((x) => x.id)).toEqual(match.rank(lib, 'matrix', 120).map((x) => x.id));
    expect(out.length).toBe(120);
  });

  it('a small list is ranked without waiting; a replaced search stops early', async () => {
    expect((await match.rankAsync(lib.slice(0, 50), 'matrix', 10)).map((x) => x.id)).toEqual(match.rank(lib.slice(0, 50), 'matrix', 10).map((x) => x.id));
    expect(await match.rankAsync(lib, 'm', 10)).toEqual([]); // under two characters
    expect(await match.rankAsync(lib, 'matrix', 10, { slice: 1000, cancelled: () => true })).toBeNull();
  });
});

// ------------------------------------------------------------------ the build version, the placeholder

describe('the build version stamp (tools/stamp-version.mjs)', () => {
  it('writes 1.0.<run> into config.xml and js/version.js and nothing else', () => {
    const xml = read('config.xml'); const js = read('js/version.js');
    const x2 = stampConfig(xml, '1.0.321'); const j2 = stampVersionJs(js, '1.0.321');
    expect(new DOMParser().parseFromString(x2, 'application/xml').documentElement.getAttribute('version')).toBe('1.0.321');
    expect(x2.replace('version="1.0.321" viewmodes', 'V')).toBe(xml.replace(/version="[\d.]+" viewmodes/, 'V'));
    expect(x2).toContain('<?xml version="1.0" encoding="UTF-8"?>'); // the XML declaration is not the version
    expect(j2).toContain("export const VERSION = '1.0.321';");
    expect(j2.replace("'1.0.321'", 'V')).toBe(js.replace(/VERSION = '[\d.]+'/, 'VERSION = V'));
    expect(() => stampConfig('<widget/>', '1.0.1')).toThrow();
    expect(() => stampVersionJs('nothing', '1.0.1')).toThrow();
  });
  it('accepts only versions Tizen will package', () => {
    expect(['1.0.0', '1.0.65535', '255.255.1'].every(valid)).toBe(true);
    expect(['1.0', '1.0.65536', '256.0.1', 'v1.0.1', '1.0.1-rc', ''].some(valid)).toBe(false);
  });
  it('the build stamps before it tests and packages', () => {
    const yml = read('.github/workflows/build.yml');
    const stamp = yml.indexOf('node tools/stamp-version.mjs "1.0.${{ github.run_number }}"');
    expect(stamp).toBeGreaterThan(0);
    expect(stamp).toBeLessThan(yml.indexOf('npm test'));
    expect(stamp).toBeLessThan(yml.indexOf('rsync -a'));
    expect(yml).toMatch(/branches: \[main, master\]/);
  });
});

describe('the focused input\'s hint', () => {
  it('uses the focused secondary colour, not TEXT3 (invisible on the white pill)', () => {
    const css = read('css/ui.css').replace(/\s+/g, ' ');
    expect(css).toMatch(/\.pill-input:focus::placeholder \{ color: var\(--on-focus2\); \}/);
  });
});
