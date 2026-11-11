import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../js/store.js';
import * as player from '../js/player.js';
import { shim } from '../js/avplay-shim.js';

const live = { type: 'live', id: '42', name: 'News' };
const movie = { type: 'movie', id: '7', ext: 'mkv' };
const episode = { type: 'episode', id: '99', ext: 'mp4' };
const opens = () => shim.calls.filter((c) => c.name === 'open').map((c) => c.args[0]);

beforeEach(() => {
  localStorage.clear();
  const a = store.newAccount();
  Object.assign(a, { server: 'http://h.com:80', user: 'u', pass: 'p', ok: true });
  store.saveAccount(a);
  player.stop();
  shim.reset();
  globalThis.webapis = { avplay: shim };
});

describe('open', () => {
  it('live starts with the configured format via open -> prepare -> play', () => {
    player.open(live);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/42.ts']);
    expect(shim.names()).toEqual(expect.arrayContaining(['open', 'prepareAsync', 'play']));
    expect(shim.names().indexOf('open')).toBeLessThan(shim.names().indexOf('prepareAsync'));
    expect(shim.names().indexOf('prepareAsync')).toBeLessThan(shim.names().indexOf('play'));
    expect(shim.getState()).toBe('PLAYING');
  });
  it('live honours liveFormat=m3u8', () => {
    store.setLiveFormat('m3u8');
    player.open(live);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/42.m3u8']);
  });
  it('movie and episode use their VOD urls', () => {
    player.open(movie);
    player.open(episode);
    expect(opens()).toEqual(['http://h.com:80/movie/u/p/7.mkv', 'http://h.com:80/series/u/p/99.mp4']);
  });
  it('seeks to startMs before play for VOD, not for live', () => {
    player.open(movie, { startMs: 5000 });
    expect(shim.calls.find((c) => c.name === 'seekTo').args[0]).toBe(5000);
    expect(shim.names().indexOf('seekTo')).toBeLessThan(shim.names().indexOf('play'));
    shim.reset();
    player.open(live, { startMs: 5000 });
    expect(shim.names()).not.toContain('seekTo');
  });
  it('sets the stream User-Agent before prepare and emits ready/playing', () => {
    store.setUserAgent('MyUA/2');
    const seen = [];
    player.on('ready', () => seen.push('ready'));
    player.on('playing', () => seen.push('playing'));
    player.open(movie);
    expect(shim.props.USER_AGENT).toBe('MyUA/2');
    expect(shim.names().indexOf('setStreamingProperty')).toBeLessThan(shim.names().indexOf('prepareAsync'));
    expect(seen).toEqual(['ready', 'playing']);
  });
});

describe('live fallback', () => {
  it('a .ts failure retries .m3u8 once and emits no error if it works', () => {
    const errors = [];
    player.on('error', (e) => errors.push(e));
    shim.failWhen = (u) => u.endsWith('.ts');
    player.open(live);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/42.ts', 'http://h.com:80/live/u/p/42.m3u8']);
    expect(errors).toEqual([]);
    expect(shim.getState()).toBe('PLAYING');
  });
  it('runtime onerror also falls back, and an m3u8 start falls back to ts', () => {
    store.setLiveFormat('m3u8');
    player.open(live);
    shim.emitError();
    expect(opens()).toEqual(['http://h.com:80/live/u/p/42.m3u8', 'http://h.com:80/live/u/p/42.ts']);
  });
  it('emits error only after the retry also fails, and retries exactly once', () => {
    const errors = [];
    player.on('error', (e) => errors.push(e));
    shim.failWhen = () => true;
    player.open(live);
    expect(opens()).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });
  it('autoRecover=false emits error immediately without retrying', () => {
    store.setAutoRecover(false);
    const errors = [];
    player.on('error', (e) => errors.push(e));
    shim.failWhen = () => true;
    player.open(live);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/42.ts']);
    expect(errors).toHaveLength(1);
  });
  it('VOD errors are not retried', () => {
    const errors = [];
    player.on('error', (e) => errors.push(e));
    shim.failWhen = () => true;
    player.open(movie);
    expect(opens()).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe('events and stop', () => {
  it('timeupdate carries the position', () => {
    const t = [];
    player.on('timeupdate', (ms) => t.push(ms));
    player.open(movie);
    shim.tick(1234);
    expect(t).toEqual([1234]);
  });
  it('off removes a listener', () => {
    const t = [];
    const cb = (ms) => t.push(ms);
    player.on('timeupdate', cb);
    player.off('timeupdate', cb);
    player.open(movie);
    shim.tick(1);
    expect(t).toEqual([]);
  });
  it('VOD stream completion emits ended and clears the resume point', () => {
    let ended = 0;
    player.on('ended', () => { ended++; });
    shim.duration = 90000;
    player.open(movie, { startMs: 0 });
    shim.tick(89000);
    shim.complete();
    expect(ended).toBe(1);
    expect(store.position(movie)).toBe(0);
    expect(store.duration(movie)).toBe(89000);
  });
  it('stop persists position and duration for a movie', () => {
    shim.duration = 600000;
    player.open(movie);
    shim.tick(123000);
    player.stop();
    expect(store.position(movie)).toBe(123000);
    expect(store.duration(movie)).toBe(600000);
    expect(shim.getState()).toBe('NONE');
  });
  it('stop persists for an episode but never for a live item', () => {
    shim.duration = 1000;
    player.open(live);
    shim.tick(500);
    player.stop();
    expect(store.position(live)).toBe(0);
    expect(store.duration(live)).toBe(0);
    player.open(episode);
    shim.tick(800);
    player.stop();
    expect(store.position(episode)).toBe(800);
  });
  it('ignores late callbacks from a stopped session', () => {
    const t = [];
    player.on('timeupdate', (ms) => t.push(ms));
    player.open(movie);
    player.stop();
    shim.tick(5);
    expect(t).toEqual([]);
  });
  it('play/pause/seek/setRate delegate to AVPlay', () => {
    player.open(movie);
    player.pause();
    expect(shim.getState()).toBe('PAUSED');
    player.play();
    expect(shim.getState()).toBe('PLAYING');
    player.seek(9000.7);
    player.setRate(2);
    expect(shim.calls.at(-2)).toEqual({ name: 'seekTo', args: [9000] });
    expect(shim.calls.at(-1)).toEqual({ name: 'setSpeed', args: [2] });
  });
});
