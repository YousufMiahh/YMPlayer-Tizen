import { describe, it, expect, beforeEach } from 'vitest';
import * as tmdb from '../js/tmdb.js';
import { titleLogo } from '../js/ui/hero.js';

beforeEach(() => localStorage.clear());

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
      expect(url).toContain('/movie/603/images?include_image_language=en,null');
      return { ok: true, status: 200, json: async () => ({ logos: [{ iso_639_1: 'en', file_path: '/m.png' }] }) };
    });
    expect(await tmdb.logo('movie', '603')).toBe('https://image.tmdb.org/t/p/w500/m.png');
    expect(await tmdb.logo('movie', '603')).toBe('https://image.tmdb.org/t/p/w500/m.png');
    expect(calls).toBe(1);
    tmdb.setFetch(null);
  });

  it('keeps the name when there is no logo', async () => {
    tmdb.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ logos: [] }) }));
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
