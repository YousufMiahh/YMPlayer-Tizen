// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({
  categories: vi.fn(),
  streams: vi.fn(),
  shortEpg: vi.fn(),
  epg: vi.fn(),
}));
vi.mock('../js/player.js', () => ({
  open: vi.fn(), stop: vi.fn(), play: vi.fn(), pause: vi.fn(), on: vi.fn(), off: vi.fn(),
}));

import * as api from '../js/api.js';
import * as player from '../js/player.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { playerLiveView } from '../js/views/player-live.js';

const CATS = [
  { type: 'cat', id: '1', name: 'News' },
  { type: 'cat', id: '2', name: 'Sports' },
  { type: 'cat', id: '3', name: 'Movies' },
];
const CH = {
  1: [{ type: 'live', id: '10', name: 'BBC One', num: '1', icon: 'http://x/bbc.png' }, { type: 'live', id: '11', name: 'Sky News', num: '2' }],
  2: [{ type: 'live', id: '20', name: 'Sky Sports', num: '3' }],
  3: [],
};
let root; let av;
const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (keyCode, extra = {}) => {
  const e = new KeyboardEvent('keydown', { keyCode, cancelable: true, bubbles: true, ...extra });
  return router.onKey(e);
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div><object id="av" type="application/avplayer" hidden></object>';
  root = document.getElementById('root');
  av = document.getElementById('av');
  vi.clearAllMocks();
  api.categories.mockResolvedValue(CATS);
  api.streams.mockImplementation(async (t, c) => CH[c] || []);
  api.shortEpg.mockImplementation(async (id) => [`Now ${id}`, `Next ${id}`]);
  api.epg.mockResolvedValue([
    { title: 'Evening News', timeRange: () => '18:00 – 19:00', progress: () => 0.5 },
    { title: 'Weather', timeRange: () => '19:00 – 19:05', progress: () => 0 },
  ]);
  router.init(root);
  router.register('player-live', playerLiveView);
});
afterEach(() => router.reset());

const rows = () => [...root.querySelectorAll('[data-channel]')];

describe('live player', () => {
  const channels = [...CH[1], ...CH[2]];
  const mountPlayer = (index = 0) => router.go('player-live', { channels, index });

  it('shows the avplayer object, tunes the first channel, records history', () => {
    mountPlayer(0);
    expect(av.hidden).toBe(false);
    expect(player.open).toHaveBeenCalledTimes(1);
    expect(player.open.mock.calls[0][0].id).toBe('10');
    expect(store.history(true).map((h) => h.id)).toEqual(['10']);
  });

  it('Down zaps to the next channel: stop() strictly before open()', () => {
    mountPlayer(0);
    vi.clearAllMocks();
    const order = [];
    player.stop.mockImplementation(() => order.push('stop'));
    player.open.mockImplementation((i) => order.push(`open:${i.id}`));
    expect(key(40)).toBe(true);
    expect(order).toEqual(['stop', 'open:11']);
    key(40);
    expect(order).toEqual(['stop', 'open:11', 'stop', 'open:20']);
    expect(store.history(true)[0].id).toBe('20');
  });

  it('Up goes back and wraps; CH+/CH- also zap', () => {
    mountPlayer(0);
    vi.clearAllMocks();
    const order = [];
    player.stop.mockImplementation(() => order.push('stop'));
    player.open.mockImplementation((i) => order.push(`open:${i.id}`));
    key(38);
    expect(order).toEqual(['stop', 'open:20']); // wrapped to last
    key(427); // CH+
    key(428); // CH-
    expect(order).toEqual(['stop', 'open:20', 'stop', 'open:10', 'stop', 'open:20']);
  });

  it('OK shows the info overlay with Now/Next from api.epg', async () => {
    mountPlayer(0);
    const ov = root.querySelector('.live-info');
    expect(ov.hidden).toBe(false); // banner appears on tune
    expect(key(13)).toBe(true); // OK toggles it away...
    expect(ov.hidden).toBe(true);
    api.epg.mockClear();
    expect(key(13)).toBe(true); // ...and back, re-reading the EPG
    await tick();
    expect(api.epg).toHaveBeenCalledWith('10', expect.any(Number));
    expect(ov.hidden).toBe(false);
    expect(ov.querySelector('.now').textContent).toContain('Evening News');
    expect(ov.querySelector('.now').textContent).toContain('18:00 – 19:00');
    expect(ov.querySelector('.next').textContent).toContain('Weather');
    expect(ov.textContent).toContain('BBC One');
  });

  it('Left/Right also show the overlay', async () => {
    mountPlayer(0);
    key(13); // hide the tune banner
    key(39);
    await tick();
    expect(root.querySelector('.live-info').hidden).toBe(false);
  });

  it('unmount stops the player and hides the avplayer object', () => {
    mountPlayer(0);
    router.reset();
    expect(player.stop).toHaveBeenCalled();
    expect(av.hidden).toBe(true);
    expect(document.body.classList.contains('video-on')).toBe(false);
  });

  it('shows an error message when the stream fails', () => {
    mountPlayer(0);
    const cb = player.on.mock.calls.find((c) => c[0] === 'error')[1];
    cb('boom');
    expect(root.querySelector('.live-error').hidden).toBe(false);
  });
});
