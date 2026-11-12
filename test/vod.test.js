// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({
  categories: vi.fn(), streams: vi.fn(), vodInfo: vi.fn(), seriesInfo: vi.fn(),
}));
vi.mock('../js/player.js', () => ({
  open: vi.fn(), stop: vi.fn(), play: vi.fn(), pause: vi.fn(), seek: vi.fn(), on: vi.fn(), off: vi.fn(), retry: vi.fn(),
  isPlaying: vi.fn(() => false), isReady: vi.fn(() => false), position: vi.fn(() => 0), duration: vi.fn(() => 0),
  tracks: vi.fn(() => []), subtitlesAreOff: vi.fn(() => true), select: vi.fn(), subtitlesOff: vi.fn(), TEXT: 'TEXT', AUDIO: 'AUDIO',
}));

import * as api from '../js/api.js';
import * as player from '../js/player.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { moviesView } from '../js/views/movies.js';
import { movieDetailView } from '../js/views/movie-detail.js';
import { seriesDetailView } from '../js/views/series-detail.js';
import { playerVodView } from '../js/views/player.js';

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
  router.register('movie-detail', movieDetailView);
  router.register('series-detail', seriesDetailView);
  router.register('player-vod', playerVodView);
});
afterEach(() => router.reset());

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
    expect(router.current().params).toEqual({ queue: [MOVIES[0]], index: 0 });
  });

  it('offers Resume with the stored position, and play-from-start', async () => {
    store.setPosition(MOVIES[0], 754000);
    router.go('movie-detail', { item: MOVIES[0] });
    await tick();
    const resume = root.querySelector('[data-action="resume"]');
    expect(resume.textContent).toContain('12:34');
    resume.click();
    await tick();
    // the player resumes from the saved point itself (PlayerActivity.play(true))
    expect(router.current().params).toEqual({ queue: [MOVIES[0]], index: 0 });
    expect(player.open).toHaveBeenCalledWith(MOVIES[0], expect.objectContaining({ startMs: 754000 }));
  });

  it('play from the start forgets the saved point first (Start Over)', async () => {
    store.setPosition(MOVIES[0], 754000);
    router.go('movie-detail', { item: MOVIES[0] });
    await tick();
    root.querySelector('[data-action="restart"], [data-action="play"]').click();
    await tick();
    expect(store.position(MOVIES[0])).toBe(0);
    expect(player.open).toHaveBeenCalledWith(MOVIES[0], expect.objectContaining({ startMs: 0 }));
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
    const { queue, index } = router.current().params;
    const item = queue[index];
    expect(item).toMatchObject({ type: 'episode', id: '1001', parentId: '7', ext: 'mkv', parentName: 'Dark' });
    expect(queue.map((e) => e.id)).toEqual(['1001', '1002']); // the season only (SeriesActivity:381)
    expect(player.open).toHaveBeenCalledWith(item, expect.objectContaining({ startMs: 0 }));
  });

  it("on ended, opens the next episode of the season; the season's last one goes back", async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    root.querySelector('[data-episode="1001"]').click();
    await tick();
    player.open.mockClear();
    handler('ended')();
    expect(player.open.mock.calls[0][0]).toMatchObject({ id: '1002', parentId: '7' });
    expect(player.open.mock.calls[0][1]).toMatchObject({ startMs: 0 });
    handler('ended')(); // last episode of season 1: no crossing into season 2
    expect(player.open).toHaveBeenCalledTimes(1);
    expect(router.current().name).toBe('series-detail');
  });

  it('Play next picks the in-progress episode', async () => {
    store.setPosition({ type: 'episode', id: '1002', parentId: '7' }, 1000);
    router.go('series-detail', { item: SERIES });
    await tick();
    root.querySelector('[data-action="next"]').click();
    await tick();
    const { queue, index } = router.current().params;
    expect(queue[index].id).toBe('1002');
  });
});
