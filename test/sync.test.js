import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as core from '../js/sync-core.js';
import * as sync from '../js/sync.js';
import * as store from '../js/store.js';

// Shared test vector: the Fire TV, phone and Mac apps check the same numbers.
const VEC = { server: 'HTTP://Example.com:80/', user: 'user1', pass: 'p@ss' };

describe('sync keys and encryption', () => {
  it('normalises the server', () => {
    expect(core.normServer(' HTTPS://Line.TV:443/// ')).toBe('line.tv');
    expect(core.normServer('http://a.b:8080/')).toBe('a.b:8080');
  });

  it('derives the same id and key for the same login however the server is typed', () => {
    const a = core.deriveKeys(VEC.server, VEC.user, VEC.pass);
    const b = core.deriveKeys('example.com', ' user1 ', 'p@ss');
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{64}$/);
    expect(core.hex(a.key)).toBe(core.hex(b.key));
    expect(core.deriveKeys('example.com', 'user1', 'other').id).not.toBe(a.id);
    // the vector (Java / Swift tests must print the same)
    expect(a.id).toBe('ae08bc466b590e674b630cab58c367667533e7c70fe3619833c3a4f71fa02cc9');
    expect(core.hex(a.key)).toBe('3e9ee9fe8e62906119bba43ac6009185ae44e5aa724ef2fce95e5ee9cbff3e89');
  });

  it('encrypts so only the same key opens it', () => {
    const { key } = core.deriveKeys(VEC.server, VEC.user, VEC.pass);
    const doc = { v: 1, hello: 'wörld' };
    const nonce = new Uint8Array(12).map((_, i) => i);
    const blob = core.encrypt(key, doc, nonce);
    expect(blob).toBe('AAECAwQFBgcICQoLGMrYpSJHJ7+tKuNmtDWAWOqqBLxvlha4GzMJcRt7hXGHawuIPp6PZg==');
    expect(core.decrypt(key, blob)).toEqual(doc);
    expect(core.decrypt(key, core.encrypt(key, doc))).toEqual(doc);
    const other = core.deriveKeys('x', 'y', 'z').key;
    expect(() => core.decrypt(other, blob)).toThrow();
  });
});

const it7 = { type: 'movie', id: '7', name: 'Seven' };

function stateWith(over = {}) {
  const st = { hist: {} };
  for (const m of core.MAPS) st[m] = {};
  return Object.assign(st, over);
}

describe('stamping and merging', () => {
  it('keeps the times of things unchanged since the last sync', () => {
    const s1 = core.stamp(stateWith({ watched: { 'movie:7': {} } }), null, 1000);
    expect(s1.watched['movie:7'].t).toBe(1000);
    const s2 = core.stamp(stateWith({ watched: { 'movie:7': {} } }), s1, 5000);
    expect(s2.watched['movie:7'].t).toBe(1000);
    const s3 = core.stamp(stateWith(), s2, 9000);
    expect(s3.watched['movie:7']).toEqual({ x: 1, t: 9000 });
  });

  it('newest change wins, both ways', () => {
    const base = core.stamp(stateWith({ fav: { 'movie:7': { o: 0, i: it7 } } }), null, 1000);
    // phone removes the favourite at 2000, TV adds a position at 3000
    const phone = core.stamp(stateWith(), base, 2000);
    const tv = core.stamp(stateWith({ fav: { 'movie:7': { o: 0, i: it7 } }, pos: { 'movie:7': { p: 60000, d: 90000 } } }), base, 3000);
    const m1 = core.merge(phone, base, 2000).doc;
    const m2 = core.merge(tv, m1, 3000);
    expect(m2.dirty).toBe(true);
    const st = core.toState(m2.doc);
    expect(st.fav['movie:7']).toBeUndefined(); // the removal was newer than the TV's untouched copy
    expect(st.pos['movie:7'].p).toBe(60000);
  });

  it('a newer position replaces an older one', () => {
    const a = core.stamp(stateWith({ pos: { 'episode:1': { p: 1000 } } }), null, 100);
    const b = core.stamp(stateWith({ pos: { 'episode:1': { p: 5000 } } }), null, 200);
    expect(core.toState(core.merge(a, b, 300).doc).pos['episode:1'].p).toBe(5000);
    expect(core.toState(core.merge(b, a, 300).doc).pos['episode:1'].p).toBe(5000);
    expect(core.merge(a, b, 300).dirty).toBe(false);
  });

  it('history keeps the order of play across devices', () => {
    const h = (k, o) => ({ [k]: { o, i: { type: k.split(':')[0], id: k.split(':')[1] } } });
    const tv = core.stamp(stateWith({ hist: { ...h('movie:1', 1), ...h('movie:2', 0) } }), null, 1000);
    const phone = core.stamp(stateWith({ hist: { ...h('movie:3', 0) } }), null, 2000);
    const m = core.merge(tv, phone, 2000).doc;
    const st = core.toState(m);
    expect(Object.keys(st.hist).sort((a, b) => st.hist[a].o - st.hist[b].o)).toEqual(['movie:3', 'movie:2', 'movie:1']);
    // replaying movie:1 on the TV brings it to the front
    const tv2 = core.stamp(stateWith({ hist: { ...h('movie:1', 0), ...h('movie:3', 1), ...h('movie:2', 2) } }), m, 5000);
    const st2 = core.toState(core.merge(tv2, m, 5000).doc);
    expect(Object.keys(st2.hist).sort((a, b) => st2.hist[a].o - st2.hist[b].o)).toEqual(['movie:1', 'movie:3', 'movie:2']);
  });

  it('clearing history spreads', () => {
    const one = core.stamp(stateWith({ hist: { 'live:5': { o: 0, i: { type: 'live', id: '5' } } } }), null, 1000);
    const cleared = core.stamp(stateWith(), one, 2000);
    expect(cleared.histclear.live).toBe(2000);
    expect(core.toState(core.merge(cleared, one, 2000).doc).hist).toEqual({});
  });

  it('old removals are tidied away', () => {
    const d = core.emptyDoc();
    d.watched['movie:1'] = { x: 1, t: 0 };
    const { doc, dirty } = core.merge(core.emptyDoc(), d, core.TOMBSTONE_MS + 10);
    expect(doc.watched['movie:1']).toBeUndefined();
    expect(dirty).toBe(true);
  });

  it('passes through maps this app does not keep', () => {
    const d = core.emptyDoc();
    d.adelay['movie:1'] = { ms: 200, t: 5 };
    const s = core.stamp(stateWith(), d, 10, core.MAPS.filter((m) => m !== 'adelay'));
    expect(s.adelay['movie:1']).toEqual({ ms: 200, t: 5 });
  });
});

// ------------------------------------------------------------ the whole thing, two TVs, a fake server

function fakeServer() {
  const rows = new Map();
  return {
    rows,
    fetch: vi.fn(async (url, opt) => {
      const body = JSON.parse(opt.body);
      const fn = url.split('/').pop();
      let out;
      if (fn === 'ym_sync_get') out = rows.has(body.p_id) ? [rows.get(body.p_id)] : [];
      else {
        const r = rows.get(body.p_id);
        if (body.p_version === 0) {
          if (r) out = null; else { rows.set(body.p_id, { data: body.p_data, version: 1 }); out = 1; }
        } else if (!r || r.version !== body.p_version) out = null;
        else { rows.set(body.p_id, { data: body.p_data, version: r.version + 1 }); out = r.version + 1; }
      }
      return { ok: true, json: async () => out };
    }),
  };
}

function login() {
  const a = store.newAccount();
  Object.assign(a, { server: 'http://line.tv', user: 'me', pass: 'secret', ok: true });
  store.saveAccount(a);
  store.setCurrent(a.id);
}

let server;
const devices = { a: {}, b: {} };
function use(name) {
  // save the other device's storage, load this one's
  for (const k of Object.keys(devices)) if (devices[k].active) { devices[k].data = { ...localStorage }; devices[k].active = false; }
  localStorage.clear();
  for (const [k, v] of Object.entries(devices[name].data || {})) localStorage.setItem(k, v);
  devices[name].active = true;
}

describe('sync between two devices', () => {
  beforeEach(() => {
    server = fakeServer();
    globalThis.fetch = server.fetch;
    sync._configure('https://x.supabase.co', 'sb_publishable_test');
    devices.a = {}; devices.b = {};
    localStorage.clear();
  });

  it('favourites, positions, watched and hidden categories reach the other device', async () => {
    use('a'); login();
    store.toggleFav({ type: 'movie', id: '7', name: 'Seven' });
    store.addHistory({ type: 'movie', id: '7', name: 'Seven' });
    store.setPosition({ type: 'movie', id: '7' }, 120000);
    store.setDuration({ type: 'movie', id: '7' }, 6000000);
    store.setWatched({ type: 'episode', id: '9' }, true);
    store.setAccountList('hide_cat_live', ['12']);
    store.setCatName('movie', '3', 'My films');
    await sync.syncNow();
    expect(server.rows.size).toBe(1);
    const row = [...server.rows.values()][0];
    expect(row.data).not.toMatch(/Seven|secret|line\.tv/); // encrypted

    use('b'); login();
    store.toggleFav({ type: 'live', id: '1', name: 'BBC One' });
    const changed = await sync.syncNow();
    expect(changed).toBe(true);
    expect(store.isFav({ type: 'movie', id: '7' })).toBe(true);
    expect(store.isFav({ type: 'live', id: '1' })).toBe(true);
    expect(store.position({ type: 'movie', id: '7' })).toBe(120000);
    expect(store.duration({ type: 'movie', id: '7' })).toBe(6000000);
    expect(store.continueWatching().map((i) => i.id)).toEqual(['7']);
    expect(store.isWatched({ type: 'episode', id: '9' })).toBe(true);
    expect(store.accountList('hide_cat_live')).toEqual(['12']);
    expect(store.catName('movie', '3')).toBe('My films');

    // B removes the film favourite; A gets the removal and B's channel
    store.toggleFav({ type: 'movie', id: '7', name: 'Seven' });
    await sync.syncNow();
    use('a');
    await sync.syncNow();
    expect(store.isFav({ type: 'movie', id: '7' })).toBe(false);
    expect(store.isFav({ type: 'live', id: '1' })).toBe(true);
  });

  it('two devices saving at once both get merged', async () => {
    use('a'); login(); await sync.syncNow();
    use('b'); login(); await sync.syncNow();
    // B saves between A's fetch and A's save
    use('a');
    store.queueAdd({ type: 'movie', id: '1', name: 'One' });
    const realFetch = server.fetch;
    let injected = false;
    globalThis.fetch = async (url, opt) => {
      if (!injected && url.endsWith('ym_sync_put')) {
        injected = true;
        const r = [...server.rows.entries()][0];
        server.rows.set(r[0], { ...r[1], version: r[1].version + 1 }); // someone else saved
      }
      return realFetch(url, opt);
    };
    await sync.syncNow();
    globalThis.fetch = realFetch;
    expect(injected).toBe(true);
    expect(store.inQueue({ type: 'movie', id: '1' })).toBe(true);
    use('b'); await sync.syncNow();
    expect(store.inQueue({ type: 'movie', id: '1' })).toBe(true);
  });

  it('subtitle style, languages and Home rows follow too; a default never replaces a choice', async () => {
    use('a'); login();
    store.setSubtitleSize(3);
    store.setSubtitleLanguage('en');
    store.setHomeShows('top_movies', false);
    await sync.syncNow();
    use('b'); login();
    expect(store.subtitleSize()).toBe(1);
    await sync.syncNow();
    expect(store.subtitleSize()).toBe(3);
    expect(store.subtitleLanguage()).toBe('en');
    expect(store.homeShows('top_movies')).toBe(false);
    expect(store.homeShows('top_series')).toBe(true);
    store.setSubtitleColor(2);
    await sync.syncNow();
    use('a'); await sync.syncNow();
    expect(store.subtitleColor()).toBe(2);
    expect(store.subtitleSize()).toBe(3);
  });

  it('keeps settings this app does not have (from the Mac or phone)', () => {
    const d = core.emptyDoc();
    d.settings.home_queue = { v: false, t: 5 };
    const s = core.stamp(stateWith({ settings: { sub_size: { v: 2 } } }), d, 10);
    expect(s.settings.home_queue).toEqual({ v: false, t: 5 });
    expect(s.settings.sub_size).toEqual({ v: 2, t: 10 });
  });

  it('does nothing when switched off or not set up', async () => {
    use('a'); login();
    store.setSyncEnabled(false);
    await sync.syncNow();
    expect(server.fetch).not.toHaveBeenCalled();
    store.setSyncEnabled(true);
    sync._configure('', '');
    await sync.syncNow();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('items keep their fields through the shared format', () => {
    const ep = { type: 'episode', id: '5', name: 'Pilot', parentId: '2', parentName: 'Show', parentIcon: 'p.png', duration: '45:00', season: 1, categoryId: '9', tmdb: '1396' };
    const w = sync.toWire(ep);
    expect(w).toMatchObject({ pid: '2', pname: 'Show', picon: 'p.png', dur: '45:00', cat: '9', season: 1 });
    expect(sync.fromWire(w)).toEqual(ep);
  });
});
