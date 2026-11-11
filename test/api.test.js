import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as store from '../js/store.js';
import * as api from '../js/api.js';

function login(server = 'http://h.com:80', user = 'u s', pass = 'p&w') {
  const a = store.newAccount();
  Object.assign(a, { server, user, pass, ok: true });
  store.saveAccount(a);
}

const mockFetch = (body, status = 200) => {
  const fn = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  globalThis.fetch = fn;
  return fn;
};
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => { localStorage.clear(); login(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('normalize', () => {
  it('strips get.php tail and query', () => {
    expect(api.normalize('line.ex.com:8080/get.php?username=a&password=b')).toBe('http://line.ex.com:8080');
  });
  it('prepends http only when there is no scheme; keeps https', () => {
    expect(api.normalize('  host.com:80 ')).toBe('http://host.com:80');
    expect(api.normalize('https://host.com')).toBe('https://host.com');
  });
  it('strips trailing slashes and other tails', () => {
    expect(api.normalize('http://h.com:8080///')).toBe('http://h.com:8080');
    for (const t of ['player_api.php', 'xmltv.php', 'panel_api.php']) {
      expect(api.normalize(`http://h.com/${t}`)).toBe('http://h.com');
    }
  });
  it('empty stays empty', () => {
    expect(api.normalize('  ')).toBe('');
  });
});

describe('parseLink', () => {
  it('extracts server/user/pass from a pasted M3U link', () => {
    expect(api.parseLink('http://line.ex.com:8080/get.php?username=bob&password=p%40ss&type=m3u_plus&output=ts'))
      .toEqual({ server: 'http://line.ex.com:8080', user: 'bob', pass: 'p@ss' });
  });
  it('plain server gives no credentials', () => {
    expect(api.parseLink('line.ex.com:8080')).toEqual({ server: 'http://line.ex.com:8080', user: '', pass: '' });
  });
});

describe('login / describeAccount', () => {
  it('requests player_api.php with encoded credentials and returns parsed body', async () => {
    const f = mockFetch({ user_info: { status: 'Active' } });
    const r = await api.login();
    expect(f.mock.calls[0][0]).toBe('http://h.com:80/player_api.php?username=u%20s&password=p%26w');
    expect(r.user_info.status).toBe('Active');
  });
  it('rejects a non-JSON-object body', async () => {
    mockFetch('<html>nope</html>');
    await expect(api.login()).rejects.toThrow(/Xtream/);
  });
  it('describes status, expiry and connections', () => {
    const exp = Date.UTC(2030, 0, 15, 12) / 1000;
    const s = api.describeAccount({ user_info: { status: 'Active', exp_date: String(exp), active_cons: '1', max_connections: '2' } });
    expect(s).toContain('Status: Active');
    expect(s).toContain('15 Jan 2030');
    expect(s).toContain('Connections: 1/2');
  });
  it('never expiry and missing user_info', () => {
    expect(api.describeAccount({ user_info: { status: 'Active', exp_date: 'never' } })).toContain('Expires: never');
    expect(api.describeAccount({ user_info: { status: 'Active', exp_date: null } })).toContain('Expires: never');
    expect(api.describeAccount({})).toBe('');
  });
});

describe('categories', () => {
  it('maps category_id/category_name and uses the right action', async () => {
    const f = mockFetch([{ category_id: '5', category_name: ' Sports ', parent_id: 0 }]);
    const r = await api.categories('movie');
    expect(f.mock.calls[0][0]).toContain('&action=get_vod_categories');
    expect(r).toEqual([{ type: 'cat', id: '5', name: 'Sports' }]);
    await api.categories('live');
    expect(f.mock.calls[1][0]).toContain('action=get_live_categories');
    await api.categories('series');
    expect(f.mock.calls[2][0]).toContain('action=get_series_categories');
  });
  it('returns [] (no throw) when the body is an error object', async () => {
    mockFetch({});
    expect(await api.categories('live')).toEqual([]);
    mockFetch({ user_info: { auth: 0 } });
    expect(await api.categories('live')).toEqual([]);
  });
  it('returns [] for non-JSON garbage', async () => {
    mockFetch('<html>');
    expect(await api.categories('live')).toEqual([]);
  });
});

describe('streams', () => {
  it("streams('live','5') maps kept fields into Items", async () => {
    const f = mockFetch([{
      num: 3, name: ' BBC One ', stream_type: 'live', stream_id: 101, stream_icon: 'http://i/1.png',
      added: '1700000000', category_id: '5', container_extension: 'ts', epg_channel_id: 'x', huge: 'y'.repeat(1000),
    }]);
    const r = await api.streams('live', '5');
    expect(f.mock.calls[0][0]).toContain('&action=get_live_streams&category_id=5');
    expect(r).toEqual([{
      type: 'live', id: '101', name: 'BBC One', icon: 'http://i/1.png', num: '3', ext: 'ts',
      categoryId: '5', added: 1700000000,
    }]);
  });
  it('series uses series_id/cover/plot/last_modified and genre+rating info', async () => {
    mockFetch([{ series_id: 9, name: 'S', cover: 'c.jpg', plot: 'P', genre: 'Drama', rating: '7.46', category_id: '2', last_modified: '1600000000' }]);
    const r = await api.streams('series');
    expect(r[0]).toMatchObject({ type: 'series', id: '9', icon: 'c.jpg', plot: 'P', categoryId: '2', added: 1600000000 });
    expect(r[0].info).toContain('Drama');
    expect(r[0].info).toContain('★ 7.5');
  });
  it('movie info is the rating; no category param when omitted', async () => {
    const f = mockFetch([{ stream_id: 4, name: 'M', rating: '0', container_extension: 'mkv', stream_icon: '' }]);
    const r = await api.streams('movie');
    expect(f.mock.calls[0][0]).not.toContain('category_id');
    expect(f.mock.calls[0][0]).toContain('action=get_vod_streams');
    expect(r[0].ext).toBe('mkv');
    expect(r[0].info).toBeUndefined();
    expect(r[0].icon).toBeUndefined();
  });
  it('skips entries without an id, tolerates error object', async () => {
    mockFetch([{ name: 'no id' }, { stream_id: 1, name: 'ok' }]);
    expect((await api.streams('live')).map((i) => i.id)).toEqual(['1']);
    mockFetch({ message: 'x' });
    expect(await api.streams('live')).toEqual([]);
  });
  it('parses a large array delivered in small chunks with tricky strings', async () => {
    const arr = [];
    for (let i = 0; i < 500; i++) arr.push({ stream_id: i, name: `n"{[}]${i}\\`, plot: 'x'.repeat(50) });
    const text = JSON.stringify(arr);
    const enc = new TextEncoder().encode(text);
    const stream = new ReadableStream({
      start(c) { for (let i = 0; i < enc.length; i += 37) c.enqueue(enc.slice(i, i + 37)); c.close(); },
    });
    globalThis.fetch = vi.fn(async () => new Response(stream));
    const r = await api.streams('live');
    expect(r).toHaveLength(500);
    expect(r[499].name).toBe('n"{[}]499\\');
  });
});

describe('detail', () => {
  it('seriesInfo / vodInfo hit the right actions and return objects', async () => {
    const f = mockFetch({ episodes: {} });
    expect(await api.seriesInfo('7')).toEqual({ episodes: {} });
    expect(f.mock.calls[0][0]).toContain('&action=get_series_info&series_id=7');
    await api.vodInfo('8');
    expect(f.mock.calls[1][0]).toContain('&action=get_vod_info&vod_id=8');
  });
  it('non-object body gives {}', async () => {
    mockFetch('[]');
    expect(await api.vodInfo('1')).toEqual({});
  });
});

describe('epg', () => {
  const listing = (o) => ({ epg_listings: o });
  it('decodes base64, tolerates plain text, drops ended entries', async () => {
    const t = now();
    const f = mockFetch(listing([
      { title: b64('Old Show'), description: b64('gone'), start_timestamp: t - 7200, stop_timestamp: t - 3600 },
      { title: b64('News Ünï'), description: b64('Headlines'), start_timestamp: t - 600, stop_timestamp: t + 600 },
      { title: 'Plain Title', description: 'Plain desc', start_timestamp: t + 600, stop_timestamp: t + 1200 },
    ]));
    const r = await api.epg('42', 3);
    expect(f.mock.calls[0][0]).toContain('&action=get_short_epg&stream_id=42&limit=3');
    expect(r.map((p) => p.title)).toEqual(['News Ünï', 'Plain Title']);
    expect(r[0].desc).toBe('Headlines');
    expect(r[1].desc).toBe('Plain desc');
    expect(r[0].progress()).toBeCloseTo(0.5, 1);
    expect(r[0].timeRange()).toMatch(/^\d\d:\d\d – \d\d:\d\d$/);
  });
  it('defaults limit to 6 and returns [] on failure', async () => {
    const f = mockFetch(listing([]));
    await api.epg('1');
    expect(f.mock.calls[0][0]).toContain('limit=6');
    globalThis.fetch = vi.fn(async () => { throw new Error('net'); });
    expect(await api.epg('1')).toEqual([]);
    mockFetch({});
    expect(await api.epg('1')).toEqual([]);
  });
  it('shortEpg returns [now, next] strings, null where missing', async () => {
    const t = now();
    mockFetch(listing([{ title: b64('A'), start_timestamp: t - 60, stop_timestamp: t + 60 }]));
    const [n, x] = await api.shortEpg('1');
    expect(n).toMatch(/^\d\d:\d\d – \d\d:\d\d {2}A$/);
    expect(x).toBeNull();
  });
});

describe('robustness fixes', () => {
  it('plain titles that look like base64 are kept', async () => {
    const t = now();
    mockFetch({ epg_listings: [{ title: 'Film', description: 'Test', start_timestamp: t, stop_timestamp: t + 60 }] });
    const [p] = await api.epg('1');
    expect(p.title).toBe('Film');
    expect(p.desc).toBe('Test');
  });
  it('whitespace/BOM-prefixed error object with a nested array returns []', async () => {
    mockFetch('\n  {"user_info":{"auth":0},"x":[{"stream_id":1,"name":"n"}]}');
    expect(await api.streams('live')).toEqual([]);
    mockFetch('\uFEFF{"x":[{"category_id":"1","category_name":"c"}]}');
    expect(await api.categories('live')).toEqual([]);
  });
  it('whitespace/BOM-prefixed real array still parses', async () => {
    mockFetch('\uFEFF \n[{"stream_id":1,"name":"n"}]');
    expect(await api.streams('live')).toHaveLength(1);
  });
});

describe('playUrl', () => {
  it('produces the three exact shapes', () => {
    login('http://h.com:80', 'bob', 'pw');
    store.setCurrent(store.accounts()[1].id);
    expect(api.playUrl({ type: 'live', id: '12' }, 'm3u8')).toBe('http://h.com:80/live/bob/pw/12.m3u8');
    expect(api.playUrl({ type: 'live', id: '12' }, 'ts')).toBe('http://h.com:80/live/bob/pw/12.ts');
    expect(api.playUrl({ type: 'movie', id: '3', ext: 'mkv' })).toBe('http://h.com:80/movie/bob/pw/3.mkv');
    expect(api.playUrl({ type: 'movie', id: '3' })).toBe('http://h.com:80/movie/bob/pw/3.mp4');
    expect(api.playUrl({ type: 'episode', id: '99', ext: 'avi' })).toBe('http://h.com:80/series/bob/pw/99.avi');
  });
  it('url-encodes credentials and normalizes the server', () => {
    expect(api.playUrl({ type: 'live', id: '1' }, 'ts')).toBe('http://h.com:80/live/u%20s/p%26w/1.ts');
  });
});

describe('user agent', () => {
  it('requests do not throw when UA header cannot be set and pass it as a header attempt', async () => {
    const f = mockFetch({});
    await api.login();
    expect(f.mock.calls[0][1].headers['User-Agent']).toBe(store.userAgent());
  });
});
