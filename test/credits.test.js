import { describe, it, expect } from 'vitest';
import { finishedAt, CREDITS_MS } from '../js/player.js';

describe('finished, into the credits', () => {
  it('counts as finished with under 3 minutes left (or nearly all of something short)', () => {
    const d = 50 * 60000;
    expect(CREDITS_MS).toBe(180000);
    expect(finishedAt(d - 170000, d)).toBe(true);   // 2m50s left: the credits
    expect(finishedAt(d - 200000, d)).toBe(false);  // 3m20s left on a 50-minute episode: still watching
    const film = 120 * 60000;
    expect(finishedAt(film * 0.91, film)).toBe(false); // 11 minutes left of a film: not finished
    expect(finishedAt(film - 120000, film)).toBe(true);
    expect(finishedAt(30 * 60000, film)).toBe(false);
  });
});
