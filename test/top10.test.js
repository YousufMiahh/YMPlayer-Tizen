// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as top10 from '../js/top10.js';
import { squash, fold, rank, query, score, tagLength } from '../js/match.js';

const HEAD = 'country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10';
const row = (iso, week, cat, rank, title, name = iso === 'GB' ? 'United Kingdom' : 'Elsewhere') =>
  `${name}\t${iso}\t${week}\t${cat}\t${rank}\t${title}\tN/A\t1`;
const HOUR = 3600000;

const res = (text, { status = 200, headers = {}, chunks = null } = {}) => ({
  status,
  headers: { get: (k) => headers[k] ?? null },
  text: async () => text,
  body: chunks ? {
    getReader() {
      const enc = new TextEncoder(); let i = 0;
      return { read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }) };
    },
  } : null,
});

beforeEach(() => localStorage.clear());

describe('Top10.parse', () => {
  it('keeps UK rows from the latest week only, films vs everything else, in rank order', () => {
    const d = top10.parse([HEAD,
      row('GB', '2026-10-25', 'Films (English)', 1, 'Old Film'),
      row('GB', '2026-11-01', 'TV (English)', 2, 'Show B'),
      row('GB', '2026-11-01', 'Films (Non-English)', 2, 'Film B'),
      row('US', '2026-11-08', 'Films (English)', 1, 'US Only'),
      row('GB', '2026-11-01', 'Films (English)', 1, 'Film A'),
      row('GB', '2026-11-01', 'TV (Non-English)', 1, 'Show A'),
      row('GB', '2026-10-18', 'TV (English)', 1, 'Older Show'),
    ].join('\n'));
    expect(d.week).toBe('2026-11-01');
    expect(d.films).toEqual(['Film A', 'Film B']);
    expect(d.tv).toEqual(['Show A', 'Show B']);
  });

  it('reads the file as it arrives: lines split across chunks, CRLF endings', () => {
    const text = [HEAD, row('GB', '2026-11-01', 'Films (English)', 1, 'Split Title'), row('GB', '2026-11-01', 'TV', 1, 'Tv')].join('\r\n');
    const p = top10.parser();
    for (let i = 0; i < text.length; i += 7) p.push(text.slice(i, i + 7));
    const d = p.end();
    expect(d.films).toEqual(['Split Title']);
    expect(d.tv).toEqual(['Tv']);
  });

  it('works with only country_name (no iso column), and skips bad ranks', () => {
    const d = top10.parse(['country_name\tweek\tcategory\tweekly_rank\tshow_title',
      'United Kingdom\t2026-11-01\tFilms\tx\tBad', 'United Kingdom\t2026-11-01\tFilms\t3\tGood', 'Ireland\t2026-11-01\tFilms\t1\tNo'].join('\n'));
    expect(d.films).toEqual(['Good']);
  });

  it('throws on an empty file or an unknown layout', () => {
    expect(() => top10.parse('')).toThrow('Empty Top 10 file');
    expect(() => top10.parse('a\tb\tc\n1\t2\t3')).toThrow('Unexpected Top 10 file layout');
  });
});

describe('Top10.due', () => {
  const at = (s) => new Date(s).getTime();
  it('no cache: due; a failed empty check waits an hour', () => {
    expect(top10.due(null)).toBe(true);
    const d = { ...top10.emptyData(), checked: at('2026-11-10T10:00') };
    expect(top10.due(d, at('2026-11-10T10:30'))).toBe(false);
    expect(top10.due(d, at('2026-11-10T11:01'))).toBe(true);
  });

  it('a known week: not before the Tuesday after the next week ends, and at most hourly', () => {
    const d = { ...top10.emptyData(), week: '2026-11-01', checked: at('2026-11-05T09:00') };
    expect(top10.due(d, at('2026-11-09T12:00'))).toBe(false); // the next list isn't out yet
    expect(top10.due(d, at('2026-11-10T00:00'))).toBe(true);  // Sunday 1st + 9 days
    expect(top10.due({ ...d, checked: at('2026-11-10T00:30') }, at('2026-11-10T01:00'))).toBe(false);
  });
});

describe('Top10.refresh', () => {
  const GOOD = [HEAD, row('GB', '2026-11-01', 'Films (English)', 1, 'Film A'), row('GB', '2026-11-01', 'TV (English)', 1, 'Show A')].join('\n');

  it('downloads (streamed), saves the cache with week, check time, ETag and Last-Modified', async () => {
    top10.setFetch(async () => res('', { headers: { ETag: '"v1"', 'Last-Modified': 'Tue, 03 Nov 2026 10:00:00 GMT' }, chunks: [GOOD.slice(0, 50), GOOD.slice(50)] }));
    const d = await top10.refresh(() => 1000);
    expect(d.films).toEqual(['Film A']);
    const saved = top10.load();
    expect(saved).toMatchObject({ week: '2026-11-01', checked: 1000, etag: '"v1"', lastModified: 'Tue, 03 Nov 2026 10:00:00 GMT', tv: ['Show A'] });
  });

  it('asks whether the file changed; 304 keeps the cached copy and stamps the check', async () => {
    top10.save({ ...top10.emptyData(), week: '2026-10-01', films: ['Kept'], etag: '"v1"', lastModified: 'LM', checked: 0 });
    let sent;
    top10.setFetch(async (url, init) => { sent = { url, init }; return res('', { status: 304 }); });
    const d = await top10.refresh(() => Date.now());
    expect(sent.url).toBe('https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv');
    expect(sent.init.headers).toEqual({ 'If-None-Match': '"v1"', 'If-Modified-Since': 'LM' });
    expect(d.films).toEqual(['Kept']);
    expect(top10.load().checked).toBeGreaterThan(0);
  });

  it('failure keeps the old copy and tries again in about 10 minutes', async () => {
    const now = new Date('2026-12-01T12:00').getTime();
    top10.save({ ...top10.emptyData(), week: '2026-10-01', films: ['Kept'], checked: 0 });
    top10.setFetch(async () => res('', { status: 503 }));
    const d = await top10.refresh(() => now);
    expect(d.films).toEqual(['Kept']);
    expect(top10.load().checked).toBe(now - HOUR + 10 * 60000);
    expect(top10.due(top10.load(), now + 9 * 60000)).toBe(false);
    expect(top10.due(top10.load(), now + 11 * 60000)).toBe(true);
  });

  it('failure with no cache returns null; not due returns the cache without fetching', async () => {
    top10.setFetch(async () => { throw new Error('offline'); });
    expect(await top10.refresh()).toBeNull();
    top10.save({ ...top10.emptyData(), week: '2099-01-01', films: ['F'], checked: Date.now() });
    let calls = 0;
    top10.setFetch(async () => { calls++; return res(''); });
    expect((await top10.refresh()).films).toEqual(['F']);
    expect(calls).toBe(0);
  });

  it('a file with no UK rows keeps the old copy', async () => {
    top10.save({ ...top10.emptyData(), week: '2026-10-01', films: ['Kept'], checked: 0 });
    top10.setFetch(async () => res([HEAD, row('US', '2026-11-01', 'Films', 1, 'X')].join('\n')));
    expect((await top10.refresh()).films).toEqual(['Kept']);
  });

  it('one job at a time (Top10.WORKER)', async () => {
    const order = [];
    const a = top10.enqueue(async () => { await new Promise((r) => setTimeout(r, 20)); order.push('a'); });
    const b = top10.enqueue(async () => { order.push('b'); });
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('Top10.match', () => {
  const lib = [
    { type: 'movie', id: '1', name: 'EN - The Iron Harbour (2024)', added: '100' },
    { type: 'movie', id: '2', name: 'UK: The Iron Harbour [4K]', added: '300' },
    { type: 'movie', id: '3', name: 'Quiet Ridge', added: '50' },
    { type: 'movie', id: '4', name: 'Quiet Ridge Returns', added: '60' },
    { type: 'movie', id: '5', name: 'Amélie', added: '1' },
  ];

  it('key strips provider tags, years, brackets and a ": season" suffix', () => {
    expect(top10.key('EN - The Iron Harbour (2024)')).toBe('theironharbour');
    expect(top10.key('4K | Quiet Ridge [Multi-Sub]')).toBe('quietridge');
    expect(top10.key('Wednesday: season 2')).toBe('wednesday');
    expect(top10.key('Wednesday: Season 2')).toBe('wednesdayseason2'); // Java's regex is case-sensitive
  });

  it('keeps Netflix order, the newest copy wins, and titles not in the library are dropped', () => {
    const got = top10.match(['Quiet Ridge', 'Nope', 'The Iron Harbour', 'Amelie'], lib);
    expect(got.map((i) => i.id)).toEqual(['3', '2', '5']);
  });

  it('matchAsync gives the same answer in slices', async () => {
    const big = [...lib, ...Array.from({ length: 5000 }, (_, i) => ({ type: 'movie', id: `x${i}`, name: `Filler ${i}` }))];
    expect((await top10.matchAsync(['The Iron Harbour', 'Quiet Ridge'], big, 1000)).map((i) => i.id)).toEqual(['2', '3']);
  });

  it('no titles or no library: nothing', () => {
    expect(top10.match([], lib)).toEqual([]);
    expect(top10.match(['A'], null)).toEqual([]);
  });
});

describe('Match (search ranking) and Item text helpers', () => {
  it('squash and fold', () => {
    expect(squash('Spider-Man: No Way Home (2021)')).toBe('spidermannowayhome2021');
    expect(squash('Amélie Poulain')).toBe('ameliepoulain');
    expect(fold('Crème Brûlée!')).toBe('creme brulee!');
  });

  it('provider tags are skipped (at most 2)', () => {
    expect(tagLength(['uk', 'premier', 'sports'])).toBe(1);
    expect(tagLength(['uk', 'hd', 'vip', 'one'])).toBe(2);
    expect(tagLength(['uk'])).toBe(0);
  });

  it('exact > prefix > phrase > word starts > contains, shorter names win ties', () => {
    const L = (name) => ({ name });
    const all = [L('Sky Sports Premier League'), L('UK: Premier Sports 1'), L('Premier Sports'), L('XPremierSportsX'), L('Premier Sports 2 HD')];
    expect(rank(all, 'premier sports', 10).map((i) => i.name))
      .toEqual(['Premier Sports', 'UK: Premier Sports 1', 'Premier Sports 2 HD', 'Sky Sports Premier League', 'XPremierSportsX']);
    expect(score(L('Spider-Man'), query('spiderman'))).toBe(1000);
    expect(rank(all, 'p', 10)).toEqual([]); // under 2 characters: no search
  });
});
