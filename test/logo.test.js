import { describe, it, expect, beforeEach } from 'vitest';
import * as tmdb from '../js/tmdb.js';
import { titleLogo } from '../js/ui/hero.js';

beforeEach(() => { localStorage.clear(); tmdb._resetDetails(); });

describe('title logos', () => {
  it('picks English first, then a logo without words, most liked first, as PNG', () => {
    expect(tmdb.pickLogo([
      { iso_639_1: 'fr', file_path: '/fr.png', vote_average: 9 },
      { iso_639_1: null, file_path: '/none.png', vote_average: 8 },
      { iso_639_1: 'en', file_path: '/en1.svg', vote_average: 5 },
      { iso_639_1: 'en', file_path: '/en2.png', vote_average: 3 },
    ])).toBe('https://image.tmdb.org/t/p/w500/en1.png');
    expect(tmdb.pickLogo([{ iso_639_1: null, file_path: '/none.png' }])).toBe('https://image.tmdb.org/t/p/w500/none.png');
    expect(tmdb.pickLogo([{ iso_639_1: 'de', file_path: '/de.png' }])).toBeNull();
    expect(tmdb.pickLogo([])).toBeNull();
  });

  it('asks TMDB once per title and remembers the answer', async () => {
    let calls = 0;
    tmdb.setFetch(async (url) => {
      calls++;
      expect(url).toContain('/movie/603?append_to_response=images,release_dates&include_image_language=en,null');
      return { ok: true, status: 200, json: async () => ({ images: { logos: [{ iso_639_1: 'en', file_path: '/m.png' }] } }) };
    });
    expect(await tmdb.logo('movie', '603')).toBe('https://image.tmdb.org/t/p/w500/m.png');
    expect(await tmdb.logo('movie', '603')).toBe('https://image.tmdb.org/t/p/w500/m.png');
    expect(calls).toBe(1);
    tmdb.setFetch(null);
  });

  it('keeps the name when there is no logo', async () => {
    tmdb.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ images: { logos: [] } }) }));
    const h = document.createElement('h1');
    h.textContent = 'The Matrix';
    document.body.appendChild(h);
    await titleLogo(h, 'movie', 'The Matrix', '603');
    expect(h.textContent).toBe('The Matrix');
    expect(h.classList.contains('has-logo')).toBe(false);
    tmdb.setFetch(null);
    h.remove();
  });
});

describe('backdrops for a widened Home card', () => {
  it('a backdrop without words first, then English', () => {
    expect(tmdb.pickBackdrop([
      { iso_639_1: 'en', file_path: '/en.jpg', vote_average: 9 },
      { iso_639_1: null, file_path: '/plain.jpg', vote_average: 5 },
      { iso_639_1: 'fr', file_path: '/fr.jpg', vote_average: 10 },
    ])).toBe('https://image.tmdb.org/t/p/w780/plain.jpg');
    expect(tmdb.pickBackdrop([{ iso_639_1: 'en', file_path: '/en.jpg' }])).toBe('https://image.tmdb.org/t/p/w780/en.jpg');
    expect(tmdb.pickBackdrop([])).toBeNull();
  });
});

describe('details under a Home card', () => {
  it('genre, year, seasons, the UK rating and the summary in one request', async () => {
    let calls = 0;
    tmdb.setFetch(async (url) => {
      calls++;
      expect(url).toContain('/tv/1396?append_to_response=images,content_ratings');
      return { ok: true, status: 200, json: async () => ({
        genres: [{ name: 'Drama' }, { name: 'Crime' }], first_air_date: '2008-01-20', number_of_seasons: 5,
        overview: 'A chemistry teacher…', content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }, { iso_3166_1: 'GB', rating: '15' }] },
        images: { logos: [], backdrops: [{ iso_639_1: null, file_path: '/b.jpg' }] },
      }) };
    });
    const d = await tmdb.details('tv', '1396');
    expect(tmdb.detailsLine(d, true)).toBe('Series  ·  Drama  ·  2008  ·  5 Seasons');
    expect(d.cert).toBe('15');
    expect(d.overview).toBe('A chemistry teacher…');
    expect(d.backdrop).toBe('https://image.tmdb.org/t/p/w780/b.jpg');
    await tmdb.details('tv', '1396');
    expect(calls).toBe(1);
    tmdb.setFetch(null);
  });

  it('films: running time and the British certificate', () => {
    expect(tmdb.ukRating({ release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ certification: '' }, { certification: '12A' }] }] } }, false)).toBe('12A');
    expect(tmdb.detailsLine({ genres: ['Action'], year: '2024', runtime: '1h 52m', seasons: 0 }, false)).toBe('Film  ·  Action  ·  2024  ·  1h 52m');
  });
});
