// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({
  categories: vi.fn(), streams: vi.fn(), vodInfo: vi.fn(), seriesInfo: vi.fn(),
}));
vi.mock('../js/player.js', () => ({
  open: vi.fn(), stop: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), on: vi.fn(), off: vi.fn(),
}));

import * as api from '../js/api.js';
import * as player from '../js/player.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { moviesView } from '../js/views/movies.js';
import { seriesView } from '../js/views/series.js';
import { movieDetailView } from '../js/views/movie-detail.js';
import { seriesDetailView } from '../js/views/series-detail.js';
import { playerVodView } from '../js/views/player-vod.js';

const MOVIES = [
  { type: 'movie', id: '100', name: 'Heat', icon: 'http://x/heat.jpg', ext: 'mkv', info: '8.2' },
  { type: 'movie', id: '101', name: 'Alien', ext: 'mp4' },
];
const SERIES = { type: 'series', id: '7', name: 'Dark', icon: 'http://x/dark.jpg' };
const SERIES_INFO = {
  info: { name: 'Dark', plot: 'Time loops', cover: 'http://x/dark.jpg' },
  episodes: {
    2: [{ id: '2001', episode_num: 1, title: 'Ep S2E1', container_extension: 'mp4' }],
    1: [
      { id: '1002', episode_num: 2, title: 'Ep S1E2', container_extension: 'mp4' },
      { id: '1001', episode_num: 1, title: 'Ep S1E1', container_extension: 'mkv' },
    ],
  },
};
let root; let av;
const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (keyCode) => router.onKey(new KeyboardEvent('keydown', { keyCode, cancelable: true, bubbles: true }));
const handler = (event) => player.on.mock.calls.filter((c) => c[0] === event).at(-1)[1];

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div><object id="av" type="application/avplayer" hidden></object>';
  root = document.getElementById('root');
  av = document.getElementById('av');
  vi.clearAllMocks();
  api.categories.mockResolvedValue([{ type: 'cat', id: '1', name: 'Action' }]);
  api.streams.mockResolvedValue(MOVIES);
  api.vodInfo.mockResolvedValue({ info: { plot: 'Cops and robbers', rating: '8.3' } });
  api.seriesInfo.mockResolvedValue(SERIES_INFO);
  router.init(root);
  router.register('movies', moviesView);
  router.register('series', seriesView);
  router.register('movie-detail', movieDetailView);
  router.register('series-detail', seriesDetailView);
  router.register('player-vod', playerVodView);
});
afterEach(() => router.reset());

describe('movies browse', () => {
  it('renders a poster grid from streams and opens detail', async () => {
    router.go('movies', {});
    await tick();
    expect(api.categories).toHaveBeenCalledWith('movie');
    root.querySelector('[data-cat="1"]').click();
    await tick();
    expect(api.streams).toHaveBeenCalledWith('movie', '1');
    const cards = [...root.querySelectorAll('[data-item]')];
    expect(cards.map((c) => c.dataset.item)).toEqual(['100', '101']);
    expect(cards[0].textContent).toContain('Heat');
    expect(cards[0].querySelector('img').src).toBe('http://x/heat.jpg');
    cards[0].click();
    await tick();
    expect(router.current().name).toBe('movie-detail');
    expect(router.current().params.item.id).toBe('100');
  });

  it('series grid opens series detail', async () => {
    api.streams.mockResolvedValue([SERIES]);
    router.go('series', {});
    await tick();
    root.querySelector('[data-cat="1"]').click();
    await tick();
    expect(api.streams).toHaveBeenCalledWith('series', '1');
    root.querySelector('[data-item="7"]').click();
    await tick();
    expect(router.current().name).toBe('series-detail');
  });
});

describe('movie detail', () => {
  it('shows plot and rating and plays from the start with no resume point', async () => {
    router.go('movie-detail', { item: MOVIES[0] });
    await tick();
    expect(api.vodInfo).toHaveBeenCalledWith('100');
    expect(root.textContent).toContain('Cops and robbers');
    expect(root.textContent).toContain('8.3');
    expect(root.querySelector('[data-action="resume"]')).toBeNull();
    root.querySelector('[data-action="play"]').click();
    await tick();
    expect(router.current().name).toBe('player-vod');
    expect(router.current().params).toMatchObject({ item: MOVIES[0], startMs: 0 });
  });

  it('offers Resume with the stored position, and play-from-start', async () => {
    store.setPosition(MOVIES[0], 754000);
    router.go('movie-detail', { item: MOVIES[0] });
    await tick();
    const resume = root.querySelector('[data-action="resume"]');
    expect(resume.textContent).toContain('12:34');
    resume.click();
    await tick();
    expect(router.current().params.startMs).toBe(754000);
  });
});

describe('player-vod', () => {
  const mountPlayer = (params) => { router.go('player-vod', params); };

  it('shows the av object, opens with startMs, and cleans up on unmount', () => {
    mountPlayer({ item: MOVIES[0], startMs: 5000 });
    expect(av.hidden).toBe(false);
    expect(player.open).toHaveBeenCalledWith(MOVIES[0], { startMs: 5000 });
    expect(store.history(false).map((h) => h.id)).toEqual(['100']);
    router.reset();
    expect(player.stop).toHaveBeenCalled();
    expect(av.hidden).toBe(true);
    expect(player.off).toHaveBeenCalled();
  });

  it('prompts to resume when a position is stored and no startMs was given', () => {
    store.setPosition(MOVIES[0], 90000);
    mountPlayer({ item: MOVIES[0] });
    expect(player.open).not.toHaveBeenCalled();
    root.querySelector('[data-action="resume"]').click();
    expect(player.stop).toHaveBeenCalled();
    expect(player.open).toHaveBeenCalledWith(MOVIES[0], { startMs: 90000 });
  });

  it('Start over from the prompt opens at 0', () => {
    store.setPosition(MOVIES[0], 90000);
    mountPlayer({ item: MOVIES[0] });
    root.querySelector('[data-action="restart"]').click();
    expect(player.open).toHaveBeenCalledWith(MOVIES[0], { startMs: 0 });
  });

  it('left/right seek -10s/+30s from the current position', () => {
    mountPlayer({ item: MOVIES[0], startMs: 60000 });
    handler('timeupdate')(60000);
    key(37);
    expect(player.seek).toHaveBeenLastCalledWith(50000);
    handler('timeupdate')(50000);
    key(39);
    expect(player.seek).toHaveBeenLastCalledWith(80000);
  });

  it('OK shows the controls', () => {
    mountPlayer({ item: MOVIES[0], startMs: 1 });
    const bar = root.querySelector('.vod-controls');
    expect(bar.hidden).toBe(true);
    key(13);
    expect(bar.hidden).toBe(false);
  });

  it('movie end goes back', async () => {
    router.go('movies', {});
    await tick();
    mountPlayer({ item: MOVIES[0], startMs: 1 });
    handler('ended')();
    expect(router.current().name).toBe('movies');
  });
});

describe('series detail + auto-next', () => {
  it('lists seasons and episodes (sorted) from seriesInfo with resume markers', async () => {
    const probe = { type: 'episode', id: '1002', parentId: '7' };
    store.setPosition(probe, 600000);
    router.go('series-detail', { item: SERIES });
    await tick();
    expect(api.seriesInfo).toHaveBeenCalledWith('7');
    expect(root.textContent).toContain('Time loops');
    expect([...root.querySelectorAll('[data-season]')].map((s) => s.dataset.season)).toEqual(['1', '2']);
    expect([...root.querySelectorAll('[data-episode]')].map((s) => s.dataset.episode)).toEqual(['1001', '1002']);
    expect(root.querySelector('[data-episode="1002"]').classList.contains('resume')).toBe(true);
    expect(root.querySelector('[data-episode="1001"]').classList.contains('resume')).toBe(false);
    root.querySelector('[data-season="2"]').click();
    expect([...root.querySelectorAll('[data-episode]')].map((s) => s.dataset.episode)).toEqual(['2001']);
  });

  it('selecting an episode opens an EPISODE item with parentId, stop before open', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    root.querySelector('[data-episode="1001"]').click();
    await tick();
    expect(router.current().name).toBe('player-vod');
    const { item } = router.current().params;
    expect(item).toMatchObject({ type: 'episode', id: '1001', parentId: '7', ext: 'mkv', parentName: 'Dark' });
    expect(player.open).toHaveBeenCalledWith(item, { startMs: 0 });
    expect(player.stop.mock.invocationCallOrder[0]).toBeLessThan(player.open.mock.invocationCallOrder[0]);
  });

  it('on ended, opens the next episode then crosses into the next season', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    root.querySelector('[data-episode="1001"]').click();
    await tick();
    player.open.mockClear(); player.stop.mockClear();
    handler('ended')();
    expect(player.stop).toHaveBeenCalled();
    expect(player.open.mock.calls[0][0]).toMatchObject({ id: '1002', parentId: '7' });
    expect(player.open.mock.calls[0][1]).toEqual({ startMs: 0 });
    expect(player.stop.mock.invocationCallOrder[0]).toBeLessThan(player.open.mock.invocationCallOrder[0]);
    handler('ended')();
    expect(player.open.mock.calls[1][0]).toMatchObject({ id: '2001', parentId: '7' });
    handler('ended')(); // last episode: back to the series detail
    expect(router.current().name).toBe('series-detail');
  });

  it('Play next picks the in-progress episode', async () => {
    store.setPosition({ type: 'episode', id: '1002', parentId: '7' }, 1000);
    router.go('series-detail', { item: SERIES });
    await tick();
    root.querySelector('[data-action="next"]').click();
    await tick();
    expect(router.current().params.item.id).toBe('1002');
  });
});
