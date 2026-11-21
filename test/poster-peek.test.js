import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPosterPeek, PEEK_AFTER_MS, metaLine, cleanTitle, yearOf } from '../js/poster-peek.js';

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => vi.useRealTimers());

function setup() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const cells = [0, 1, 2].map(() => { const c = document.createElement('button'); host.appendChild(c); return c; });
  const items = [{ name: 'Gangs of London (2020)', info: '★ 8.0', plot: 'A city torn apart.' }, { name: 'Spooks' }, { name: 'Citadel' }];
  const peek = createPosterPeek({ host, elementAt: (i) => cells[i], itemAt: (i) => items[i] });
  return { host, cells, peek };
}

describe('poster details', () => {
  it('show after resting on a poster, with name, year and rating, and the story', () => {
    const { host, cells, peek } = setup();
    peek.selected(0);
    vi.advanceTimersByTime(PEEK_AFTER_MS - 100);
    expect(host.querySelector('.poster-peek')).toBeNull();
    vi.advanceTimersByTime(200);
    const p = host.querySelector('.poster-peek');
    expect(p.querySelector('.pp-title').textContent).toBe('Gangs of London');
    expect(p.querySelector('.pp-meta').textContent).toBe('2020  ·  ★ 8.0');
    expect(p.querySelector('.pp-plot').textContent).toBe('A city torn apart.');
    expect(cells[0].classList.contains('peeking')).toBe(true);
  });

  it('moving on hides them at once and starts again for the next poster', () => {
    const { cells, peek } = setup();
    peek.selected(0);
    vi.advanceTimersByTime(PEEK_AFTER_MS + 10);
    expect(peek.showing).toBe(true);
    peek.selected(1);
    expect(peek.showing).toBe(false);
    expect(cells[0].classList.contains('peeking')).toBe(false);
    peek.selected(2); // still moving: nothing shows until you stop
    vi.advanceTimersByTime(PEEK_AFTER_MS / 2);
    expect(peek.showing).toBe(false);
    vi.advanceTimersByTime(PEEK_AFTER_MS);
    expect(peek.showing).toBe(true);
    expect(cells[2].classList.contains('peeking')).toBe(true);
  });

  it('titles and details lines', () => {
    expect(cleanTitle('The Agency (2024)')).toBe('The Agency');
    expect(metaLine({ name: 'Spooks', info: '' })).toBe('');
    expect(yearOf('Quiet Witness 1987 (1994)')).toBe('1994');
    expect(cleanTitle('Quiet Witness 1987 (1994)')).toBe('Quiet Witness 1987');
  });
});
