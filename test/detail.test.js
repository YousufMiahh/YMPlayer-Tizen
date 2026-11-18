// @vitest-environment jsdom
// Movie page (MovieActivity), series page (SeriesActivity), trailer (TrailerActivity), Open.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({
  vodInfo: vi.fn(), seriesInfo: vi.fn(), errorMessage: (e) => (e ? e.message : ''),
}));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import { router } from '../js/router.js';
import * as D from '../js/detail.js';
import { youtubeId, embedUrl, openTrailer } from '../js/trailer.js';
import { openTarget, openItem } from '../js/open.js';
import { movieDetailView } from '../js/views/movie-detail.js';
import { seriesDetailView, LOADING, NO_EPISODES } from '../js/views/series-detail.js';
import { trailerView, LOAD_TIMEOUT_MS } from '../js/views/trailer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const keyDown = (keyCode, extra = {}) => router.onKey(new KeyboardEvent('keydown', { keyCode, cancelable: true, bubbles: true, ...extra }));
const stub = () => ({ mount() {}, unmount() {} });
const labels = () => [...root.querySelectorAll('.dp-buttons button')].map((b) => b.textContent);
const toastText = () => document.querySelector('.toast')?.textContent;

const MOVIE = { type: 'movie', id: '100', name: 'Heat (1995)', icon: 'http://x/heat.jpg', info: 'Crime  ·  ★ 8.2' };
const VOD_INFO = {
  info: {
    plot: 'Cops and robbers.', releasedate: '1995-12-15', duration: '02:50:00', genre: 'Crime', rating: '8.26',
    director: 'Michael Mann', cast: 'Al Pacino, Robert De Niro', backdrop_path: ['http://x/heat-bd.jpg'],
    movie_image: 'http://x/heat-big.jpg', youtube_trailer: 'https://www.youtube.com/watch?v=2GfZl4kuVNI',
  },
  movie_data: { stream_id: 100, container_extension: 'mkv' },
};
const SERIES = { type: 'series', id: '7', name: 'Dark', icon: 'http://x/dark.jpg', info: 'Sci-Fi  ·  ★ 8.7' };
const ep = (id, n, extra = {}) => ({ id, episode_num: n, title: `Ep ${id}`, container_extension: 'mp4', info: { duration: '00:52:00', plot: `Plot ${id}`, movie_image: `http://x/${id}.jpg` }, ...extra });
const SERIES_INFO = {
  info: { name: 'Dark', plot: 'Time loops.', releaseDate: '2017-12-01', genre: 'Sci-Fi', rating: '8.7', backdrop_path: ['http://x/dark-bd.jpg'], youtube_trailer: 'ESEUoa-mz2c' },
  episodes: {
    2: [ep('2001', 1), ep('2002', 2), ep('2003', 3)],
    1: [ep('1002', 2), ep('1001', 1), ep('1003', 3)], // provider order is kept
    0: [ep('9001', 1)],
  },
};
const epItem = (id) => ({ type: 'episode', id, parentId: '7', parentName: 'Dark' });

let root;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  vi.clearAllMocks();
  api.vodInfo.mockResolvedValue(VOD_INFO);
  api.seriesInfo.mockResolvedValue(SERIES_INFO);
  router.init(root);
  router.register('home', stub);
  router.register('movie-detail', movieDetailView);
  router.register('series-detail', seriesDetailView);
  router.register('trailer', trailerView);
  router.register('player-vod', stub);
  router.register('player-live', stub);
  router.go('home');
});
afterEach(() => { router.reset(); vi.useRealTimers(); });

// ------------------------------------------------------------ data

describe('meta, credits and labels (pure)', () => {
  it('rating is one decimal with one star; nothing for 0, blank or junk', () => {
    expect(D.rating('8.26')).toBe('★ 8.3');
    expect(D.rating('7')).toBe('★ 7.0');
    expect(D.rating('0')).toBeNull();
    expect(D.rating('')).toBeNull();
    expect(D.rating('n/a')).toBeNull();
    expect(D.rating(null)).toBeNull();
  });

  it('shortDuration only rewrites hh:mm:ss starting with 0', () => {
    expect(D.shortDuration('01:45:00')).toBe('1 hr 45 min');
    expect(D.shortDuration('00:52:00')).toBe('52 min');
    expect(D.shortDuration('soon')).toBe('soon');
  });

  it('movie meta is "year  ·  duration  ·  genre  ·  ★ rating" with a single star', () => {
    const m = D.movieInfo(VOD_INFO, MOVIE);
    expect(m.meta).toBe('1995  ·  2 hr 50 min  ·  Crime  ·  ★ 8.3');
    expect(m.meta.match(/★/g)).toHaveLength(1);
    expect(m.credits).toBe('Director: Michael Mann  ·  Cast: Al Pacino, Robert De Niro');
    expect(m.plot).toBe('Cops and robbers.');
    expect(m.backdrop).toBe('http://x/heat-bd.jpg');
    expect(m.trailer).toBe('2GfZl4kuVNI');
    expect(m.ext).toBe('mkv');
  });

  it('movie meta skips blanks, keeps odd durations raw, falls back for plot, cast, backdrop', () => {
    const m = D.movieInfo({ info: { description: 'D', release_date: '2001', duration: '1:47:00', rating: '0', actors: 'A, B', movie_image: 'http://x/m.jpg', backdrop_path: [] } }, MOVIE);
    expect(m.meta).toBe('2001  ·  1:47:00');
    expect(m.plot).toBe('D');
    expect(m.credits).toBe('Cast: A, B');
    expect(m.backdrop).toBe('http://x/m.jpg');
    expect(m.trailer).toBeNull();
    expect(D.movieInfo({ info: {} }, MOVIE)).toMatchObject({ meta: null, plot: null, credits: '', backdrop: 'http://x/heat.jpg' });
    expect(D.movieInfo({}, MOVIE)).toBeNull();
    expect(D.movieInfo({ info: [] }, MOVIE)).toBeNull();
  });

  it('movie buttons by state, Netflix-style: Play + Audio & Subtitles | Resume + Play From Beginning, then the small ones', () => {
    const lab = (t) => D.movieButtons(MOVIE, t).map((b) => b.label);
    expect(lab(null)).toEqual(['▶  Play', 'Audio & Subtitles', '♡  Favourite', '＋  Queue', '○  Mark Watched']);
    expect(lab('2GfZl4kuVNI')).toEqual(['▶  Play', 'Audio & Subtitles', '▶  Trailer', '♡  Favourite', '＋  Queue', '○  Mark Watched']);
    expect(D.movieButtons(MOVIE, null).filter((b) => b.hero).map((b) => b.action)).toEqual(['play', 'audio']);
    store.setPosition(MOVIE, 4521000);
    store.setDuration(MOVIE, 9042000);
    store.toggleFav(MOVIE);
    store.queueAdd(MOVIE);
    expect(lab('2GfZl4kuVNI')).toEqual(['▶  Resume', '↻  Play From Beginning', '▶  Trailer', '♥  In Favourites', '✓  In Queue', '○  Mark Watched']);
    expect(D.movieButtons(MOVIE, null)[0].progress).toBeCloseTo(0.5, 5);
    store.setWatched(MOVIE, true); // watched: no resume point, and out of the queue
    expect(lab(null)).toEqual(['▶  Play', 'Audio & Subtitles', '♥  In Favourites', '＋  Queue', '✓  Watched']);
  });

  it('series meta is "year  ·  genre  ·  ★ rating"; without info the list line stays', () => {
    expect(D.seriesInfo(SERIES_INFO, SERIES)).toMatchObject({ meta: '2017  ·  Sci-Fi  ·  ★ 8.7', plot: 'Time loops.', backdrop: 'http://x/dark-bd.jpg', trailer: 'ESEUoa-mz2c' });
    expect(D.seriesInfo({}, SERIES).meta).toBe('Sci-Fi  ·  ★ 8.7');
    // no backdrop: the cover only stands in when the list had no artwork
    expect(D.seriesInfo({ info: { cover: 'http://x/c.jpg' } }, SERIES).backdrop).toBeNull();
    expect(D.seriesInfo({ info: { cover: 'http://x/c.jpg' } }, { ...SERIES, icon: undefined }).backdrop).toBe('http://x/c.jpg');
  });

  it('seasons: numeric order with Specials first, provider episode order, Android field fallbacks', () => {
    const s = D.parseSeasons(SERIES_INFO, SERIES);
    expect(s.map((x) => x.season)).toEqual([0, 1, 2]);
    expect(s.map((x) => D.seasonLabel(x.season))).toEqual(['Specials', 'Season 1', 'Season 2']);
    expect(s[1].episodes.map((e) => e.id)).toEqual(['1002', '1001', '1003']);
    expect(s[1].episodes[0]).toMatchObject({ type: 'episode', num: '2', name: 'Ep 1002', ext: 'mp4', parentId: '7', parentName: 'Dark', parentIcon: 'http://x/dark.jpg', duration: '52 min', plot: 'Plot 1002', icon: 'http://x/1002.jpg' });
    const odd = D.parseSeasons({ episodes: [[{ id: 1 }, { id: '' }, { id: 3, season: '5', title: 'T', container_extension: 'mkv', info: { duration: '45:10' } }], { id: 9 }] }, SERIES);
    expect(odd.map((x) => [x.season, x.episodes.map((e) => `${e.id}/${e.num}/${e.name}/${e.ext}/${e.duration || ''}`)])).toEqual([
      [0, ['9/1/Dark/mp4/']], [1, ['1/1/Dark/mp4/']], [5, ['3/3/T/mkv/45:10']],
    ]);
  });

  it('series Play label follows the newest episode in history', () => {
    const s = D.parseSeasons(SERIES_INFO, SERIES);
    expect(D.seriesPlayLabel(s, null)).toBe('▶  Play');
    store.addHistory(epItem('2002'));
    store.setPosition(epItem('2002'), 60000);
    expect(D.seriesPlayLabel(s, D.lastWatched(SERIES))).toBe('▶  Resume S2 · E2');
    store.setPosition(epItem('2002'), 0); // finished
    expect(D.seriesPlayLabel(s, D.lastWatched(SERIES))).toBe('▶  Play S2 · E2');
    expect(D.seriesPlayLabel([], D.lastWatched(SERIES))).toBe('▶  Play');
    store.setPosition(epItem('2002'), 60000);
    expect(D.seriesPlayLabel([], D.lastWatched(SERIES))).toBe('▶  Resume');
    expect(D.startSeason(s, D.lastWatched(SERIES))).toBe(2);
    expect(D.playTargetEpisode(s, D.lastWatched(SERIES)).id).toBe('2002');
    expect(D.startSeason(s, null)).toBe(0);
    expect(D.playTargetEpisode(s, null).id).toBe('9001');
  });

  it('episode card: "N.  title", "M:SS left" while part-watched else the duration, progress', () => {
    const e = D.parseSeasons(SERIES_INFO, SERIES)[1].episodes[0];
    expect(D.episodeCard(e, SERIES)).toEqual({ image: 'http://x/1002.jpg', title: '2.  Ep 1002', sub: '52 min', progress: 0, watched: false });
    store.setDuration(e, 3120000); store.setPosition(e, 1200000);
    expect(D.episodeCard(e, SERIES)).toMatchObject({ sub: '32:00 left', progress: 1200000 / 3120000 });
    store.setPosition(e, 0); // watched to the end: back to the duration, no bar (Android draws no tick)
    expect(D.episodeCard(e, SERIES)).toMatchObject({ sub: '52 min', progress: 0 });
    expect(D.episodeCard({ ...e, icon: undefined }, SERIES).image).toBe('http://x/dark.jpg');
  });
});

describe('trailer ids', () => {
  it('youtubeId takes a bare id, ?v=, youtu.be, /embed/ and nothing else', () => {
    expect(youtubeId('2GfZl4kuVNI')).toBe('2GfZl4kuVNI');
    expect(youtubeId(' https://www.youtube.com/watch?v=2GfZl4kuVNI&t=3 ')).toBe('2GfZl4kuVNI');
    expect(youtubeId('youtu.be/2GfZl4kuVNI')).toBe('2GfZl4kuVNI');
    expect(youtubeId('https://www.youtube.com/embed/2GfZl4kuVNI/')).toBe('2GfZl4kuVNI');
    expect(youtubeId('')).toBeNull();
    expect(youtubeId('trailer coming soon')).toBeNull();
    expect(youtubeId(null)).toBeNull();
  });

  it('the embed is youtube-nocookie with Android\'s parameters and no key', () => {
    const u = new URL(embedUrl('2GfZl4kuVNI'));
    expect(u.origin + u.pathname).toBe('https://www.youtube-nocookie.com/embed/2GfZl4kuVNI');
    expect(Object.fromEntries(u.searchParams)).toEqual({ autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1', enablejsapi: '1' });
    expect(u.searchParams.has('key')).toBe(false);
  });
});

// ------------------------------------------------------------ Open

describe('Open.item routing', () => {
  it('movie -> movie page, series -> series page, live -> player with the live siblings, episode -> player alone', () => {
    const live = [{ type: 'live', id: '1' }, { type: 'movie', id: 'm' }, { type: 'live', id: '2' }];
    expect(openTarget(MOVIE)).toEqual({ name: 'movie-detail', params: { item: MOVIE } });
    expect(openTarget(SERIES)).toEqual({ name: 'series-detail', params: { item: SERIES } });
    expect(openTarget({ type: 'live', id: '2' }, live)).toEqual({ name: 'player-live', params: { channels: [live[0], live[2]], index: 1 } });
    expect(openTarget({ type: 'live', id: '9' }, live).params).toEqual({ channels: [{ type: 'live', id: '9' }], index: 0 });
    const e = epItem('1001');
    expect(openTarget(e)).toEqual({ name: 'player-vod', params: { queue: [e], index: 0 } });
    openItem(SERIES);
    expect(router.current().name).toBe('series-detail');
  });
});

// ------------------------------------------------------------ movie page

describe('movie page', () => {
  it('arrives on Play with the list line (one star), then fills in from get_vod_info', async () => {
    router.go('movie-detail', { item: MOVIE });
    expect(root.querySelector('.dp-title').textContent).toBe('Heat (1995)');
    expect(root.querySelector('.dp-meta').textContent).toBe('Crime  ·  ★ 8.2');
    expect(labels()).toEqual(['▶  Play', 'Audio & Subtitles', '♡  Favourite', '＋  Queue', '○  Mark Watched']);
    expect(document.activeElement.textContent).toBe('▶  Play');
    await tick();
    expect(api.vodInfo).toHaveBeenCalledWith('100');
    expect(root.querySelector('.dp-meta').textContent).toBe('1995  ·  2 hr 50 min  ·  Crime  ·  ★ 8.3');
    expect(root.querySelector('.dp-plot').textContent).toBe('Cops and robbers.');
    expect(root.querySelector('.dp-credits').textContent).toBe('Director: Michael Mann  ·  Cast: Al Pacino, Robert De Niro');
    expect(labels()).toEqual(['▶  Play', 'Audio & Subtitles', '▶  Trailer', '♡  Favourite', '＋  Queue', '○  Mark Watched']);
    expect(document.activeElement.textContent).toBe('▶  Play');
  });

  it('the Trailer button arriving keeps focus on the same place in the row', async () => {
    let resolve;
    api.vodInfo.mockReturnValue(new Promise((r) => { resolve = r; }));
    store.setPosition(MOVIE, 754000);
    router.go('movie-detail', { item: MOVIE });
    root.querySelectorAll('.dp-buttons button')[1].focus(); // Play From Beginning
    resolve(VOD_INFO); await tick();
    expect(labels()).toEqual(['▶  Resume', '↻  Play From Beginning', '▶  Trailer', '♡  Favourite', '＋  Queue', '○  Mark Watched']);
    expect(document.activeElement.textContent).toBe('↻  Play From Beginning');
  });

  it('a failed or empty get_vod_info leaves the list data as it is', async () => {
    api.vodInfo.mockRejectedValue(new Error('offline'));
    router.go('movie-detail', { item: MOVIE });
    await tick();
    expect(root.querySelector('.dp-meta').textContent).toBe('Crime  ·  ★ 8.2');
    expect(labels()).toEqual(['▶  Play', 'Audio & Subtitles', '♡  Favourite', '＋  Queue', '○  Mark Watched']);
  });

  it('Resume plays with the saved point kept; Start Over clears it first; both are Open.play([movie], 0)', async () => {
    store.setPosition(MOVIE, 754000);
    router.go('movie-detail', { item: MOVIE });
    await tick();
    root.querySelector('[data-action="play"]').click();
    expect(router.current().name).toBe('player-vod');
    expect(router.current().params).toEqual({ queue: [expect.objectContaining({ id: '100', ext: 'mkv' })], index: 0 });
    expect(store.position(MOVIE)).toBe(754000);
    router.back(); await tick();
    root.querySelector('[data-action="over"]').click();
    expect(store.position(MOVIE)).toBe(0);
    expect(router.current().name).toBe('player-vod');
  });

  it('coming back rebuilds the buttons (new Resume time), focus on Play, without asking the server again', async () => {
    router.go('movie-detail', { item: MOVIE });
    await tick();
    root.querySelector('[data-action="play"]').click();
    store.setPosition(MOVIE, 61000); // the player saved a point
    router.back();
    expect(labels()).toEqual(['▶  Resume', '↻  Play From Beginning', '▶  Trailer', '♡  Favourite', '＋  Queue', '○  Mark Watched']);
    expect(document.activeElement.textContent).toBe('▶  Resume');
    expect(root.querySelector('.dp-meta').textContent).toBe('1995  ·  2 hr 50 min  ·  Crime  ·  ★ 8.3');
    expect(api.vodInfo).toHaveBeenCalledTimes(1);
  });

  it('Audio & Subtitles sets the languages the player picks from the next thing you play', async () => {
    router.go('movie-detail', { item: MOVIE });
    await tick();
    root.querySelector('[data-action="audio"]').click();
    const items = [...document.querySelectorAll('.dialog-item')];
    expect(items.map((b) => b.textContent.trim())).toEqual(['Subtitles: Off', 'Subtitles: English', '✓  Subtitles: as the stream sets them', 'Audio: English', '✓  Audio: Original (as the stream sets it)']);
    items[0].click(); await tick();
    expect(store.subtitleLanguage()).toBe('off');
    expect(toastText()).toBe('Used from the next thing you play');
    document.querySelectorAll('.dialog-scrim').forEach((d) => d.remove());
  });

  it('Favourite toggles in place; Trailer opens the trailer screen', async () => {
    router.go('movie-detail', { item: MOVIE });
    await tick();
    const fav = root.querySelector('[data-action="fav"]');
    fav.click();
    expect(fav.textContent).toBe('♥  In Favourites');
    expect(store.isFav(MOVIE)).toBe(true);
    root.querySelector('[data-action="trailer"]').click();
    expect(router.current()).toMatchObject({ name: 'trailer', params: { id: '2GfZl4kuVNI' } });
  });

  it('the backdrop is the poster first, then backdrop_path[0], over both page scrims', async () => {
    const loads = [];
    vi.stubGlobal('Image', class { set src(v) { loads.push(v); this.onload && setTimeout(this.onload, 0); } });
    router.go('movie-detail', { item: MOVIE });
    const img = root.querySelector('.dp-backdrop');
    expect(root.querySelector('.dp-scrim-left')).not.toBeNull();
    expect(root.querySelector('.dp-scrim-bottom')).not.toBeNull();
    await tick(); await tick();
    expect(loads).toEqual(['http://x/heat.jpg', 'http://x/heat-bd.jpg']);
    expect(img.getAttribute('src')).toBe('http://x/heat-bd.jpg');
    expect(img.classList.contains('on')).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ------------------------------------------------------------ series page

describe('series page', () => {
  const pills = () => [...root.querySelectorAll('.season-pill')];
  const cards = () => [...root.querySelectorAll('.sp-shelf .card')];
  const activeSeason = () => root.querySelector('.season-pill.on')?.textContent;

  it('shows "Loading episodes…", then meta, Play S1: E… / Episodes & More / Audio & Subtitles, focus on Play', async () => {
    router.go('series-detail', { item: SERIES });
    expect(root.querySelector('.dp-meta').textContent).toBe(LOADING);
    expect(document.activeElement.textContent).toBe('▶  Play');
    await tick();
    expect(root.querySelector('.dp-meta').textContent).toBe('2017  ·  Sci-Fi  ·  ★ 8.7');
    expect(pills().map((p) => p.textContent)).toEqual(['Specials', 'Season 1', 'Season 2']);
    expect(activeSeason()).toBe('Specials');
    // a new series: the first episode of Season 1 (in the provider's order), not a Special
    expect(labels()).toEqual(['▶  Play S1: E2', 'Episodes & More', 'Audio & Subtitles', '▶  Trailer', '♡  Favourite']);
    expect(document.activeElement.textContent).toBe('▶  Play S1: E2');
    expect(root.querySelector('.sp-eplabel').textContent).toBe('S1: E2   Ep 1002');
    expect(root.querySelector('.series-page').classList.contains('sp-hero')).toBe(true); // the seasons wait for Episodes & More
  });

  it('Episodes & More brings up the seasons on the episode you\'d play; Back puts them away', async () => {
    store.addHistory(epItem('2002'));
    store.setDuration(epItem('2002'), 3000000); store.setPosition(epItem('2002'), 600000);
    router.go('series-detail', { item: SERIES });
    await tick();
    const page = root.querySelector('.series-page');
    root.querySelector('[data-action="more"]').click();
    expect(page.classList.contains('sp-hero')).toBe(false);
    expect(activeSeason()).toBe('Season 2');
    expect(document.activeElement).toBe(cards()[1]);
    expect(router.current().view.onBack()).toBe(true);
    expect(page.classList.contains('sp-hero')).toBe(true);
    expect(document.activeElement.textContent).toBe('▶  Resume S2: Ep. 2');
    expect(router.current().view.onBack()).toBe(false); // then Back leaves the page as usual
  });

  it('watching it: Resume S2: Ep. 2 with progress, Play From Beginning starts it again; a finished one moves on', async () => {
    store.addHistory(epItem('2002'));
    store.setDuration(epItem('2002'), 3000000); store.setPosition(epItem('2002'), 1500000);
    router.go('series-detail', { item: SERIES });
    await tick();
    expect(labels()).toEqual(['▶  Resume S2: Ep. 2', '↻  Play From Beginning', 'Episodes & More', '▶  Trailer', '♡  Favourite']);
    expect(root.querySelector('[data-action="play"] .hero-progress > span').style.width).toBe('50%');
    root.querySelector('[data-action="over"]').click();
    expect(store.position(epItem('2002'))).toBe(0);
    expect(router.current().params.queue[router.current().params.index].id).toBe('2002');
    router.back(); await tick();
    store.setWatched(epItem('2002'), true);
    router.back();
    router.go('series-detail', { item: SERIES }); await tick();
    expect(labels()[0]).toBe('▶  Resume S2: Ep. 3');
  });

  it('opens on the last-watched episode\'s season with "▶  Resume S2 · E3"; the card shows time left and progress', async () => {
    store.addHistory(epItem('2003'));
    store.setDuration(epItem('2003'), 3000000); store.setPosition(epItem('2003'), 1000000);
    router.go('series-detail', { item: SERIES });
    await tick();
    expect(activeSeason()).toBe('Season 2');
    expect(labels()[0]).toBe('▶  Resume S2: Ep. 3');
    const c = cards()[2];
    expect(c.querySelector('.title').textContent).toBe('3.  Ep 2003');
    expect(c.querySelector('.sub').textContent).toBe('33:20 left');
    expect(parseFloat(c.querySelector('.progress > i').style.width)).toBeCloseTo(100 / 3, 5);
    expect(cards()[0].querySelector('.sub').textContent).toBe('52 min');
    expect(cards()[0].querySelector('.progress')).toBeNull();
    expect(document.activeElement.textContent).toBe('▶  Resume S2: Ep. 3'); // not an episode
  });

  it('focusing a season pill switches the season at once (no OK); ▲ from a card goes to that pill', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    pills()[1].focus();
    expect(activeSeason()).toBe('Season 1');
    expect(cards().map((c) => c.querySelector('.title').textContent)).toEqual(['2.  Ep 1002', '1.  Ep 1001', '3.  Ep 1003']);
    pills()[2].focus();
    expect(activeSeason()).toBe('Season 2');
    cards()[1].focus();
    expect(keyDown(38)).toBe(true);
    expect(document.activeElement).toBe(pills()[2]);
  });

  it('a focused card shows "Episode N  ·  name" and its plot', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    pills()[1].focus();
    cards()[0].focus();
    const label = root.querySelector('.sp-eplabel');
    expect(label.hidden).toBe(false);
    expect(label.textContent).toBe('Episode 2  ·  Ep 1002');
    expect(root.querySelector('.dp-plot').textContent).toBe('Plot 1002');
  });

  it('OK on a card plays it with its own season as the queue', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    pills()[1].focus();
    cards()[2].click();
    const { queue, index } = router.current().params;
    expect(router.current().name).toBe('player-vod');
    expect(queue.map((e) => e.id)).toEqual(['1002', '1001', '1003']);
    expect(index).toBe(2);
    expect(queue[index]).toMatchObject({ type: 'episode', parentId: '7', parentName: 'Dark', ext: 'mp4' });
  });

  it('Play plays the last-watched episode in its season, or the first episode of Season 1', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    root.querySelector('[data-action="play"]').click();
    expect(router.current().params.queue.map((e) => e.id)).toEqual(['1002', '1001', '1003']);
    expect(router.current().params.index).toBe(0);
    router.back(); await tick();
    store.addHistory(epItem('1001'));
    router.go('series-detail', { item: SERIES }); await tick();
    expect(labels()[0]).toBe('▶  Resume S1: Ep. 1');
    root.querySelector('[data-action="play"]').click();
    expect(router.current().params).toEqual({ queue: expect.any(Array), index: 1 });
    expect(router.current().params.queue.map((e) => e.id)).toEqual(['1002', '1001', '1003']);
  });

  it('coming back keeps the season and the focused episode, and refreshes the cards and label', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    root.querySelector('[data-action="more"]').click();
    pills()[2].focus();
    cards()[1].focus();
    cards()[1].click();
    store.addHistory(epItem('2002'));
    store.setDuration(epItem('2002'), 3000000); store.setPosition(epItem('2002'), 2400000);
    router.back();
    expect(activeSeason()).toBe('Season 2');
    expect(document.activeElement).toBe(cards()[1]);
    expect(cards()[1].querySelector('.sub').textContent).toBe('10:00 left');
    expect(labels()[0]).toBe('▶  Resume S2: Ep. 2');
    expect(root.querySelector('.sp-eplabel').textContent).toBe('Episode 2  ·  Ep 2002');
    expect(api.seriesInfo).toHaveBeenCalledTimes(1);
  });

  it('Menu toggles the series favourite with a toast; the Favourite button follows', async () => {
    router.go('series-detail', { item: SERIES });
    await tick();
    expect(keyDown(10133)).toBe(true);
    expect(store.isFav(SERIES)).toBe(true);
    expect(toastText()).toBe('Added to Favourites — Dark');
    expect(root.querySelector('[data-action="fav"]').textContent).toBe('♥  In Favourites');
    root.querySelector('[data-action="fav"]').click();
    expect(store.isFav(SERIES)).toBe(false);
    expect(root.querySelector('[data-action="fav"]').textContent).toBe('♡  Favourite');
  });

  it('error and empty states use Android\'s words', async () => {
    api.seriesInfo.mockRejectedValueOnce(new Error('Server returned HTTP 502'));
    router.go('series-detail', { item: SERIES });
    await tick();
    expect(root.querySelector('.dp-meta').textContent).toBe("Couldn't load episodes — Server returned HTTP 502");
    expect(pills()).toHaveLength(0);
    router.back();
    api.seriesInfo.mockResolvedValueOnce({ info: { plot: 'P', youtube_trailer: 'ESEUoa-mz2c' }, episodes: [] });
    router.go('series-detail', { item: SERIES });
    await tick();
    expect(root.querySelector('.dp-meta').textContent).toBe(NO_EPISODES);
    expect(labels()).toEqual(['▶  Play', 'Episodes & More', 'Audio & Subtitles', '♡  Favourite']); // parse stops before the buttons are rebuilt
  });
});

// ------------------------------------------------------------ trailer

describe('trailer screen', () => {
  const frame = () => root.querySelector('iframe.trailer-frame');
  const fromPlayer = (data) => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), source: frame().contentWindow }));

  it('no id: "No trailer available" and nothing opens', () => {
    expect(openTrailer('coming soon')).toBe(false);
    expect(toastText()).toBe('No trailer available');
    expect(router.current().name).toBe('home');
  });

  it('opens the keyless embed full screen; focus stays on the page; Back closes it', async () => {
    router.go('movie-detail', { item: MOVIE });
    await tick();
    openTrailer('2GfZl4kuVNI');
    expect(router.current().name).toBe('trailer');
    expect(frame().getAttribute('src')).toBe(embedUrl('2GfZl4kuVNI'));
    expect(frame().getAttribute('allow')).toBe('autoplay; encrypted-media; fullscreen');
    expect(frame().tabIndex).toBe(-1);
    expect(root.querySelector('.trailer').contains(document.activeElement)).toBe(true);
    const f = frame();
    router.back();
    expect(f.getAttribute('src')).toBe('about:blank');
    expect(router.current().name).toBe('movie-detail');
  });

  it('OK and the media keys drive the embed through postMessage', () => {
    openTrailer('2GfZl4kuVNI');
    const post = vi.spyOn(frame().contentWindow, 'postMessage');
    const sent = () => post.mock.calls.map((c) => JSON.parse(c[0])).map((m) => `${m.func}${m.args && m.args.length ? `(${m.args[0]})` : ''}`);
    keyDown(13);
    fromPlayer({ event: 'infoDelivery', info: { playerState: 1, currentTime: 30 } });
    keyDown(13);
    keyDown(39); keyDown(37); keyDown(415); keyDown(19);
    expect(sent()).toEqual(['playVideo', 'pauseVideo', 'seekTo(40)', 'seekTo(35)', 'playVideo', 'pauseVideo']);
  });

  it('a player error closes the screen with "No trailer available"', async () => {
    router.go('movie-detail', { item: MOVIE });
    await tick();
    openTrailer('2GfZl4kuVNI');
    fromPlayer({ event: 'onError', info: 150 });
    expect(router.current().name).toBe('movie-detail');
    expect(toastText()).toBe('No trailer available');
  });

  it('an embed that never loads gives up after the timeout; one that loads stays', () => {
    vi.useFakeTimers();
    openTrailer('2GfZl4kuVNI');
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(router.current().name).toBe('home');
    openTrailer('2GfZl4kuVNI');
    frame().dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS * 2);
    expect(router.current().name).toBe('trailer');
  });
});
