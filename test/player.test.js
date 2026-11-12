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

describe('errors and retry (the ladder itself lives in the player screen)', () => {
  it('a prepare failure emits one error with the reason and does not retry by itself', () => {
    const errors = [];
    player.on('error', (e) => errors.push(e));
    shim.failWhen = () => true;
    player.open(live);
    expect(opens()).toEqual(['http://h.com:80/live/u/p/42.ts']);
    expect(errors).toEqual([{ what: 'PLAYER_ERROR_CONNECTION_FAILED' }]);
  });
  it('a runtime onerror emits the AVPlay error name', () => {
    const errors = [];
    player.on('error', (e) => errors.push(e));
    player.open(movie);
    shim.emitError('PLAYER_ERROR_INVALID_URI');
    expect(errors).toEqual([{ what: 'PLAYER_ERROR_INVALID_URI' }]);
  });
  it('format picks the live container (the screen flips .ts / .m3u8)', () => {
    player.open(live, { format: 'm3u8' });
    expect(opens()).toEqual(['http://h.com:80/live/u/p/42.m3u8']);
    expect(player.format()).toBe('m3u8');
  });
  it('retry reopens the same stream; VOD from where it was', () => {
    shim.duration = 600000;
    player.open(movie);
    shim.tick(42000);
    player.retry();
    expect(opens()).toHaveLength(2);
    expect(shim.names().lastIndexOf('close')).toBeLessThan(shim.names().lastIndexOf('open'));
    expect(shim.calls.filter((c) => c.name === 'seekTo').at(-1).args[0]).toBe(42000);
    expect(shim.getState()).toBe('PLAYING');
  });
  it('the picture is letter-boxed (fit inside the screen, as on Android)', () => {
    player.open(movie);
    expect(shim.displayMethod).toBe('PLAYER_DISPLAY_MODE_LETTER_BOX');
  });
  it('buffering start / complete are passed on', () => {
    const b = [];
    player.on('buffering', (on) => b.push(on));
    player.open(movie);
    b.length = 0;
    shim.buffering(true); shim.buffering(false);
    expect(b).toEqual([true, false]);
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
  it('VOD stream completion emits ended, clears the resume point and stores the real duration', () => {
    let ended = 0;
    player.on('ended', () => { ended++; });
    shim.duration = 90000;
    player.open(movie, { startMs: 0 });
    shim.tick(89000);
    shim.complete();
    expect(ended).toBe(1);
    expect(store.position(movie)).toBe(0);
    expect(store.duration(movie)).toBe(90000);
  });
  it('completion before any time tick never stores the start point (or 0) as the duration', () => {
    store.setDuration(movie, 5400000);
    store.setPosition(movie, 120000);
    shim.duration = 0; // the player doesn't know the length
    player.open(movie, { startMs: 120000 });
    shim.complete();
    expect(store.duration(movie)).toBe(5400000);
    expect(store.position(movie)).toBe(0);
    player.stop(); // nothing more saved for a finished stream
    expect(store.duration(movie)).toBe(5400000);
    expect(store.position(movie)).toBe(0);
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
  it('stop with no tick keeps an existing resume point (startMs seeds position)', () => {
    store.setPosition(movie, 5000);
    store.setDuration(movie, 600000);
    shim.duration = 0;
    player.open(movie, { startMs: 5000 });
    player.stop();
    expect(store.position(movie)).toBe(5000);
    expect(store.duration(movie)).toBe(600000);
  });
  it('stop after a load error does not wipe a saved resume point', () => {
    store.setPosition(movie, 7000);
    shim.failWhen = () => true;
    player.open(movie, { startMs: 7000 });
    player.stop();
    expect(store.position(movie)).toBe(7000);
  });
  it('controls are no-ops with no open session', () => {
    const playing = [];
    player.on('playing', () => playing.push(1));
    expect(() => { player.play(); player.pause(); player.seek(1); player.retry(); player.subtitlesOff(); player.stop(); }).not.toThrow();
    expect(player.tracks('AUDIO')).toEqual([]);
    expect(player.position()).toBe(0);
    expect(player.duration()).toBe(0);
    expect(playing).toEqual([]);
    expect(shim.calls).toEqual([]);
  });
  it('stop persists for an episode but never for a live item', () => {
    shim.duration = 1000000;
    player.open(live);
    shim.tick(500);
    player.stop();
    expect(store.position(live)).toBe(0);
    expect(store.duration(live)).toBe(0);
    player.open(episode);
    shim.tick(80000);
    player.stop();
    expect(store.position(episode)).toBe(80000);
  });
  it('stop follows PlayerActivity.savePosition: last minute = watched, under 10 s not kept', () => {
    shim.duration = 1000000;
    store.setPosition(episode, 50000);
    player.open(episode, { startMs: 50000 });
    shim.tick(960000); // 40 s from the end
    player.stop();
    expect(store.position(episode)).toBe(0);
    player.open(movie);
    shim.tick(9000);
    player.stop();
    expect(store.position(movie)).toBe(0);
  });
  it('ignores late callbacks from a stopped session', () => {
    const t = [];
    player.on('timeupdate', (ms) => t.push(ms));
    player.open(movie);
    player.stop();
    shim.tick(5);
    expect(t).toEqual([]);
  });
  it('play/pause/seek delegate to AVPlay and report playing changes', () => {
    const p = [];
    player.on('playing', (v) => p.push(v));
    player.open(movie);
    player.pause();
    expect(shim.getState()).toBe('PAUSED');
    expect(player.isPlaying()).toBe(false);
    player.play();
    expect(shim.getState()).toBe('PLAYING');
    expect(player.isPlaying()).toBe(true);
    player.seek(9000.7);
    expect(shim.calls.at(-1)).toEqual({ name: 'seekTo', args: [9000] });
    expect(player.position()).toBe(9000);
    expect(p).toEqual([true, false, true]);
  });
  it('stop reads the live position from AVPlay (not only the last tick)', () => {
    shim.duration = 600000;
    player.open(movie);
    shim.tick(30000);
    player.seek(200000); // no tick after the seek
    player.stop();
    expect(store.position(movie)).toBe(200000);
  });
});

describe('tracks (getTotalTrackInfo / setSelectTrack)', () => {
  const T = (index, type, info) => ({ index, type, extra_info: JSON.stringify(info) });
  const TRACKS = [
    T(0, 'VIDEO', { fourCC: 'H264' }),
    T(1, 'AUDIO', { language: 'eng', fourCC: 'EAC3', channels: '6' }),
    T(2, 'AUDIO', { language: 'fra', fourCC: 'AACL', channels: '2' }),
    T(3, 'AUDIO', { language: 'und', fourCC: 'DTS', channels: '8' }),
    T(4, 'TEXT', { track_lang: 'eng', subtitle_type: '0' }),
    T(5, 'TEXT', { track_lang: 'spa', subtitle_type: '0' }),
  ];
  const open = (item = movie) => {
    const o = shim.open.bind(shim);
    shim.open = (u) => { o(u); shim.setTracks(TRACKS); };
    player.open(item);
    shim.open = o;
  };

  it('labels follow ExoEngine.trackName: language, codec, channels', () => {
    open();
    expect(player.tracks('AUDIO').map((t) => t.label)).toEqual([
      'English  ·  Dolby Digital+  ·  5.1', 'French  ·  AAC  ·  Stereo', 'Audio 3  ·  DTS  ·  7.1']);
    expect(player.tracks('TEXT').map((t) => t.label)).toEqual(['English', 'Spanish']);
    expect(player.tracks('AUDIO')[0]).toMatchObject({ language: 'eng', selected: true, index: 1 });
    expect(player.tracks('TEXT')[0]).toMatchObject({ language: 'eng', selected: true, index: 4 });
  });
  it('select switches the track on the device; Off silences subtitles and stops drawing them', () => {
    const lines = [];
    player.on('subtitle', (s) => lines.push(s.text));
    open();
    player.select(player.tracks('AUDIO')[1]);
    expect(shim.calls.at(-1)).toEqual({ name: 'setSelectTrack', args: ['AUDIO', 2] });
    expect(player.tracks('AUDIO').find((t) => t.selected).index).toBe(2);
    player.select(player.tracks('TEXT')[1]);
    expect(shim.selectedTrack('TEXT')).toBe(5);
    shim.subtitle('Hola', 2000);
    expect(lines).toEqual(['Hola']);
    player.subtitlesOff();
    expect(shim.isSilent()).toBe(true);
    expect(player.subtitlesAreOff()).toBe(true);
    expect(player.tracks('TEXT').some((t) => t.selected)).toBe(false);
    expect(lines.at(-1)).toBe(''); // the line on screen goes
    player.select(player.tracks('TEXT')[0]); // picking a track turns them back on
    expect(shim.isSilent()).toBe(false);
    expect(player.subtitlesAreOff()).toBe(false);
  });
  it('the remembered languages are applied at start; "off" starts silent', () => {
    store.setAudioLanguage('fra');
    store.setSubtitleLanguage('spa');
    open();
    expect(shim.selectedTrack('AUDIO')).toBe(2);
    expect(shim.selectedTrack('TEXT')).toBe(5);
    player.stop();
    store.setSubtitleLanguage('off');
    open();
    expect(shim.isSilent()).toBe(true);
    expect(player.subtitlesAreOff()).toBe(true);
  });
  it('languages match across code forms (en / eng)', () => {
    expect(player.sameLanguage('en', 'eng')).toBe(true);
    expect(player.sameLanguage('fre', 'fra')).toBe(true);
    expect(player.sameLanguage('en', 'fr')).toBe(false);
  });
});
