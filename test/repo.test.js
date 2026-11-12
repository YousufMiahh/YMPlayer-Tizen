// @vitest-environment jsdom
// Library store (Repo.java): tiers, local category filtering, indexes, refresh rules, per-account
// isolation, failure behaviour, progress and first-time setup ordering.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/api.js', async (orig) => ({ ...(await orig()), categories: vi.fn(), streams: vi.fn(), progress: vi.fn(() => 0) }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as repo from '../js/repo.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const LISTS = {
  live: [{ type: 'live', id: '1', name: 'BBC', categoryId: '10', added: 5 }, { type: 'live', id: '2', name: 'ITV', categoryId: '11', added: 9 }],
  movie: [{ type: 'movie', id: 'm1', name: 'A', categoryId: '20', added: 100 }, { type: 'movie', id: 'm2', name: 'B', categoryId: '20', added: 300 },
    { type: 'movie', id: 'm3', name: 'C', categoryId: '21', added: 200 }],
  series: [{ type: 'series', id: 's1', name: 'S', categoryId: '30', added: 1 }],
};
const CATS = { live: [{ type: 'cat', id: '10', name: 'News' }], movie: [{ type: 'cat', id: '20', name: 'Action' }], series: [] };

function account(id, server, user) {
  const a = { ...store.newAccount(), server, user, pass: 'p', ok: true };
  if (id !== undefined) a.id = id;
  store.saveAccount(a); store.setCurrent(a.id);
  return a;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.categories.mockImplementation(async (t) => CATS[t]);
  api.streams.mockImplementation(async (t, c) => (c == null ? LISTS[t] : LISTS[t].filter((i) => i.categoryId === c)));
  account('', 'http://a.tv', 'ann');
});

describe('record names', () => {
  it('match Android: lib_<hex String.hashCode(base|user)>_<type>_<kind>', () => {
    expect(repo.hash('')).toBe('0');
    expect(repo.hash('a')).toBe('61');
    expect(repo.hash('hello')).toBe('5e918d2');
    expect(repo.hash('http://a.tv|ann')).toBe((() => { let h = 0; for (const c of 'http://a.tv|ann') h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(16); })());
    expect(repo.fileName('live', 'all')).toBe(`lib_${repo.hash('http://a.tv|ann')}_live_all`);
  });
});

describe('tiers: memory -> saved copy -> provider', () => {
  it('first whole-list read downloads once, saves it, then serves from memory', async () => {
    const [x, y] = await Promise.all([repo.streams('movie'), repo.streams('movie')]);
    expect(x).toBe(y);
    expect(api.streams).toHaveBeenCalledTimes(1); // one download per type at a time
    expect(repo._backend().has(repo.fileName('movie', 'all'))).toBe(true);
    await repo.streams('movie');
    expect(api.streams).toHaveBeenCalledTimes(1);
  });

  it('after clear() it reads the saved copy, not the provider', async () => {
    await repo.streams('movie');
    repo.clear();
    expect(repo.cached('movie')).toBeNull();
    expect(await repo.streams('movie')).toEqual(LISTS.movie);
    expect(api.streams).toHaveBeenCalledTimes(1);
  });

  it('categories are filtered locally once the whole list exists (no request per click)', async () => {
    await repo.streams('movie');
    expect((await repo.streams('movie', '20')).map((i) => i.id)).toEqual(['m1', 'm2']);
    expect((await repo.streams('movie', 21)).map((i) => i.id)).toEqual(['m3']);
    expect(api.streams).toHaveBeenCalledTimes(1);
    repo.clear(); // saved copy only
    expect((await repo.streams('movie', '20')).map((i) => i.id)).toEqual(['m1', 'm2']);
    expect(api.streams).toHaveBeenCalledTimes(1);
  });

  it('a first-ever category visit with nothing saved asks for just that category', async () => {
    expect((await repo.streams('live', '11')).map((i) => i.id)).toEqual(['2']);
    expect(api.streams).toHaveBeenCalledWith('live', '11');
    expect(repo.cached('live')).toBeNull();
  });

  it('category lists: memory -> saved -> provider', async () => {
    expect(await repo.categories('live')).toEqual(CATS.live);
    repo.clear();
    expect(await repo.categories('live')).toEqual(CATS.live);
    expect(api.categories).toHaveBeenCalledTimes(1);
  });

  it('a damaged saved record is forgotten and fetched again', async () => {
    repo._backend().put(repo.fileName('movie', 'all'), 'garbage');
    expect(await repo.streams('movie')).toEqual(LISTS.movie);
    expect(api.streams).toHaveBeenCalledTimes(1);
  });
});

describe('indexes', () => {
  it('cached() never downloads; byId() looks up the loaded list', async () => {
    expect(repo.cached('movie')).toBeNull();
    expect(repo.byId('movie', 'm2')).toBeNull();
    await repo.streams('movie');
    expect(repo.cached('movie')).toBe(await repo.streams('movie'));
    expect(repo.byId('movie', 'm2').name).toBe('B');
    expect(repo.byId('movie', 'nope')).toBeNull();
  });

  it('recentlyAdded is newest first by "added" and limited', async () => {
    expect((await repo.recentlyAdded('movie', 2)).map((i) => i.id)).toEqual(['m2', 'm3']);
    expect((await repo.recentlyAdded('movie', 10)).map((i) => i.id)).toEqual(['m2', 'm3', 'm1']);
  });
});

describe('refresh rules (Repo.isDue, Prefs refresh_hours / lib_time)', () => {
  const H = 3600000;
  it('never refreshed is always due', () => {
    store.setRefreshHours(-1);
    expect(repo.isDue()).toBe(true);
  });
  it('manual only (-1) is never due once refreshed; every launch (0) always is', () => {
    store.setLastRefresh(Date.now());
    store.setRefreshHours(-1);
    expect(repo.isDue()).toBe(false);
    store.setRefreshHours(0);
    expect(repo.isDue()).toBe(true);
  });
  it('N hours: due only once more than N hours have passed (default 12)', () => {
    const t = 1_000_000_000_000;
    store.setLastRefresh(t);
    expect(store.refreshHours()).toBe(12);
    expect(repo.isDue(t + 12 * H)).toBe(false);
    expect(repo.isDue(t + 12 * H + 1)).toBe(true);
    store.setRefreshHours(6);
    expect(repo.isDue(t + 6 * H + 1)).toBe(true);
  });
  it('lib_time is per account', () => {
    store.setLastRefresh(123);
    account(undefined, 'http://b.tv', 'ben');
    expect(store.lastRefresh()).toBe(0);
    expect(repo.isDue()).toBe(true);
  });
  it('refreshIfDue runs refreshAll only when due, and records the time', async () => {
    const done = vi.fn();
    expect(await repo.refreshIfDue(done)).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
    expect(store.lastRefresh()).toBeGreaterThan(0);
    expect(repo.hasLibrary()).toBe(true);
    api.streams.mockClear();
    expect(await repo.refreshIfDue(done)).toBe(false);
    expect(api.streams).not.toHaveBeenCalled();
  });
});

describe('failure keeps the old copy', () => {
  it('a refresh that fails replaces nothing in memory or on disk, and lib_time stays', async () => {
    await repo.refreshAll();
    const t = store.lastRefresh();
    const before = await repo.streams('movie');
    api.streams.mockImplementation(async (type) => { if (type === 'movie') throw new Error('HTTP 500'); return LISTS[type]; });
    await expect(repo.refreshAll()).rejects.toThrow('HTTP 500');
    expect(await repo.streams('movie')).toBe(before);
    repo.clear();
    expect(await repo.streams('movie')).toEqual(LISTS.movie);
    expect(store.lastRefresh()).toBe(t);
    expect(repo.isRefreshing()).toBe(false);
  });

  it('a successful refresh swaps the new list in and tells onUpdated', async () => {
    await repo.streams('movie');
    const updated = vi.fn();
    repo.setOnUpdated(updated);
    const fresh = [{ type: 'movie', id: 'm9', name: 'New', categoryId: '20', added: 999 }];
    api.streams.mockImplementation(async (t) => (t === 'movie' ? fresh : LISTS[t]));
    expect(await repo.downloadType('movie')).toBe(1);
    expect(await repo.streams('movie')).toBe(fresh);
    expect((await repo.streams('movie', '20')).map((i) => i.id)).toEqual(['m9']); // old per-category copies dropped
    expect(repo.byId('movie', 'm9').name).toBe('New');
    expect(updated).toHaveBeenCalledTimes(1);
  });
});

describe('per-account isolation', () => {
  it('each account has its own saved library; switching drops memory', async () => {
    await repo.refreshAll();
    expect(repo.hasLibrary()).toBe(true);
    const annFiles = repo._backend().keys();
    account(undefined, 'http://b.tv', 'ben');
    expect(repo.hasLibrary()).toBe(false);
    api.streams.mockImplementation(async (t) => [{ type: t, id: `ben-${t}`, name: 'Ben' }]);
    expect((await repo.streams('movie')).map((i) => i.id)).toEqual(['ben-movie']);
    store.setCurrent(''); // back to ann: her saved copy, no download
    api.streams.mockClear();
    expect((await repo.streams('movie')).map((i) => i.id)).toEqual(['m1', 'm2', 'm3']);
    expect(api.streams).not.toHaveBeenCalled();
    expect(annFiles.every((k) => repo._backend().has(k))).toBe(true);
  });

  it('a download that started for one account is never saved under another', async () => {
    let release;
    api.categories.mockImplementation(() => new Promise((r) => { release = () => r([]); }));
    const p = repo.downloadType('movie');
    await tick();
    account(undefined, 'http://b.tv', 'ben');
    release();
    await expect(p).rejects.toThrow(/account changed/);
    expect(repo.hasLibrary()).toBe(false);
    store.setCurrent('');
    expect(repo._backend().has(repo.fileName('movie', 'all'))).toBe(false);
  });

  it('deleteFiles removes only that account’s records', async () => {
    await repo.refreshAll();
    const b = account(undefined, 'http://b.tv', 'ben');
    await repo.refreshAll();
    expect(repo._backend().keys()).toHaveLength(12);
    await repo.deleteFiles('a.tv', 'ann'); // normalised like Android (http:// added)
    expect(repo._backend().keys()).toHaveLength(6);
    expect(repo.hasLibrary()).toBe(true);
    await repo.deleteFiles(b.server, b.user);
    expect(repo.hasLibrary()).toBe(false);
  });
});

describe('warmUp (splash) and preload', () => {
  it('warmUp does nothing without a saved library', async () => {
    expect(await repo.warmUp()).toBe(false);
    expect(api.streams).not.toHaveBeenCalled();
  });
  it('warmUp loads Live TV and all categories from the saved copy', async () => {
    await repo.refreshAll();
    repo.clear(); vi.clearAllMocks();
    expect(await repo.warmUp()).toBe(true);
    expect(repo.cached('live')).toEqual(LISTS.live);
    expect(api.streams).not.toHaveBeenCalled();
    expect(api.categories).not.toHaveBeenCalled();
  });
  it('preload fills memory for every saved type', async () => {
    await repo.refreshAll();
    repo.clear();
    await repo.preload();
    for (const t of repo.TYPES) expect(repo.cached(t)).toEqual(LISTS[t]);
  });
});

describe('first-time setup (Repo.startSetup)', () => {
  it('Live TV first, then Movies and Series together; progress events; lib_time on success', async () => {
    const log = [];
    const gates = {};
    api.streams.mockImplementation((t) => new Promise((r) => { gates[t] = () => r(LISTS[t]); }));
    repo.setSetupListener({
      started: (t) => log.push(`start ${t}`),
      finished: (t, n, e) => log.push(`done ${t} ${n} ${e ? e.message : ''}`.trim()),
      allDone: (ok) => log.push(`all ${ok}`),
    });
    const p = repo.startSetup();
    expect(repo.isSetupRunning()).toBe(true);
    expect(repo.isRefreshing()).toBe(true);
    await tick();
    expect(log).toEqual(['start live']);
    expect(Object.keys(gates)).toEqual(['live']);
    gates.live(); await tick();
    expect(log).toEqual(['start live', 'done live 2', 'start movie', 'start series']);
    expect(Object.keys(gates).sort()).toEqual(['live', 'movie', 'series']); // both in flight at once
    gates.series(); gates.movie();
    expect(await p).toBe(true);
    expect(log.slice(-3)).toEqual(['done series 1', 'done movie 3', 'all true']);
    expect(repo.isSetupRunning()).toBe(false);
    expect(store.lastRefresh()).toBeGreaterThan(0);
    expect(repo.hasLibrary()).toBe(true);
  });

  it('a failed section is reported, the others finish, and lib_time is not set', async () => {
    api.streams.mockImplementation(async (t) => { if (t === 'series') throw new Error('HTTP 502'); return LISTS[t]; });
    const finished = [];
    let ok;
    repo.setSetupListener({ finished: (t, n, e) => finished.push([t, n, e && e.message]), allDone: (v) => { ok = v; } });
    expect(await repo.startSetup()).toBe(false);
    expect(finished[0]).toEqual(['live', 2, null]);
    expect(finished.slice(1).sort()).toEqual([['movie', 3, null], ['series', -1, 'HTTP 502']]);
    expect(ok).toBe(false);
    expect(store.lastRefresh()).toBe(0);
    expect(repo.hasLibrary()).toBe(false);
    api.streams.mockImplementation(async (t) => LISTS[t]);
    expect(await repo.startSetup(['series'])).toBe(true); // Try Again: failed types only
    expect(repo.hasLibrary()).toBe(true);
  });

  it('starting again while running for the same account joins the running one', async () => {
    const p1 = repo.startSetup();
    expect(repo.startSetup()).toBe(p1);
    await p1;
  });

  it('a reader that needs a list Setup is downloading shares that download', async () => {
    let gate;
    api.streams.mockImplementation((t) => (t === 'movie' ? new Promise((r) => { gate = () => r(LISTS.movie); }) : Promise.resolve(LISTS[t])));
    const p = repo.startSetup();
    await tick(); await tick();
    const read = repo.streams('movie');
    await tick();
    gate();
    expect(await read).toEqual(LISTS.movie);
    expect(api.streams.mock.calls.filter((c) => c[0] === 'movie')).toHaveLength(1);
    await p;
  });

  it('progress() reports what api.progress counts for the running download', () => {
    api.progress.mockImplementation((t) => (t === 'movie' ? 1234 : 0));
    expect(repo.progress('movie')).toBe(1234);
    expect(repo.progress('live')).toBe(0);
  });
});

describe('storage backends', () => {
  it('without IndexedDB (jsdom) it uses memory', () => {
    expect(repo._backend().kind).toBe('memory');
  });

  it('IndexedDB that cannot open falls back to memory', async () => {
    const b = repo.idbBackend({ open() { throw new Error('denied'); } });
    await b.put('k', [1]);
    expect(b.kind).toBe('memory');
    expect(await b.get('k')).toEqual([1]);
  });

  it('IndexedDB backend: put/get/del and a synchronous has() via the lib_saved manifest', async () => {
    const fake = fakeIdb();
    const b = repo.idbBackend(fake);
    expect(b.has('x')).toBe(false);
    await b.put('x', [{ id: '1' }]);
    expect(b.has('x')).toBe(true);
    expect(JSON.parse(localStorage.getItem('lib_saved'))).toEqual(['x']);
    const again = repo.idbBackend(fake); // next launch: has() answers before the DB opens
    expect(again.has('x')).toBe(true);
    expect(await again.get('x')).toEqual([{ id: '1' }]);
    fake.data.delete('x'); // the TV cleared the database behind our back
    expect(await again.get('x')).toBeUndefined();
    expect(again.has('x')).toBe(false);
    await b.put('y', [2]);
    await b.del('y');
    expect(b.has('y')).toBe(false);
    expect(fake.data.has('y')).toBe(false);
  });
});

/** Just enough of IndexedDB for idbBackend (async callbacks like the real thing). */
function fakeIdb() {
  const data = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const db = {
    createObjectStore() {},
    transaction() {
      const t = {};
      const os = {
        get(k) { const r = {}; later(() => { r.result = data.get(k); if (r.onsuccess) r.onsuccess(); later(() => t.oncomplete && t.oncomplete()); }); return r; },
        put(v, k) { const r = {}; later(() => { data.set(k, structuredClone(v)); if (r.onsuccess) r.onsuccess(); later(() => t.oncomplete && t.oncomplete()); }); return r; },
        delete(k) { const r = {}; later(() => { data.delete(k); if (r.onsuccess) r.onsuccess(); later(() => t.oncomplete && t.oncomplete()); }); return r; },
      };
      t.objectStore = () => os;
      return t;
    },
  };
  return {
    data,
    open() {
      const req = {};
      later(() => { req.result = db; if (req.onupgradeneeded) req.onupgradeneeded(); req.onsuccess(); });
      return req;
    },
  };
}
