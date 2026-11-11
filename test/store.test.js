import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../js/store.js';
import * as Item from '../js/item.js';

const ch = (id, type = 'live') => ({ type, id: String(id), name: `n${id}` });

function twoAccounts() {
  const a = store.newAccount();
  Object.assign(a, { server: 'http://a', user: 'ua', pass: 'pa', ok: true });
  store.saveAccount(a);
  const b = store.newAccount();
  Object.assign(b, { server: 'http://b', user: 'ub', pass: 'pb', ok: true });
  store.saveAccount(b);
  return [a, b];
}

beforeEach(() => localStorage.clear());

describe('item', () => {
  it('key is type:id and json round-trips', () => {
    const i = { type: 'movie', id: '7', name: 'X', added: 5 };
    expect(Item.key(i)).toBe('movie:7');
    expect(Item.fromJson(JSON.parse(JSON.stringify(Item.toJson(i))))).toEqual(i);
  });
});

describe('accounts', () => {
  it('first account has empty id, later ones are distinct', () => {
    const [a, b] = twoAccounts();
    expect(a.id).toBe('');
    expect(b.id).not.toBe('');
    expect(store.accounts()).toHaveLength(2);
    expect(store.current().id).toBe('');
  });

  it('adopts legacy single server/user/pass as first account', () => {
    localStorage.setItem('server', 'http://old');
    localStorage.setItem('user', 'u');
    localStorage.setItem('pass', 'p');
    expect(store.accounts()).toHaveLength(1);
    expect(store.server()).toBe('http://old');
    expect(store.user()).toBe('u');
    expect(store.pass()).toBe('p');
    expect(store.accounts()[0].id).toBe('');
    expect(JSON.parse(localStorage.getItem('accounts'))).toHaveLength(1);
  });

  it('hasAccount needs ok + server + user', () => {
    expect(store.hasAccount()).toBe(false);
    twoAccounts();
    expect(store.hasAccount()).toBe(true);
  });

  it('userAgent defaults and setUserAgent stores/clears', () => {
    twoAccounts();
    expect(store.userAgent()).toBe('XtreamPlayer/1.0 (Linux; Android; Fire TV)');
    store.setUserAgent('Custom/2');
    expect(store.userAgent()).toBe('Custom/2');
    store.setUserAgent('XtreamPlayer/1.0 (Linux; Android; Fire TV)');
    expect(store.userAgent()).toBe('XtreamPlayer/1.0 (Linux; Android; Fire TV)');
    expect(store.current().ua).toBe('');
  });

  it('removeAccount drops that account data only and falls back to first', () => {
    const [a, b] = twoAccounts();
    store.setCurrent(b.id);
    store.toggleFav(ch(1));
    store.setPosition(ch(1, 'movie'), 500);
    store.setCurrent(a.id);
    store.toggleFav(ch(2));
    store.removeAccount(b.id);
    expect(store.accounts()).toHaveLength(1);
    expect(store.current().id).toBe('');
    expect(store.favs('live').map((x) => x.id)).toEqual(['2']);
    expect(localStorage.getItem(`${b.id}_fav_live`)).toBeNull();
    expect(localStorage.getItem(`${b.id}_pos_movie:1`)).toBeNull();
  });
});

describe('namespacing', () => {
  it('favourites are isolated per account and use prefix scheme', () => {
    const [a, b] = twoAccounts();
    store.setCurrent(a.id);
    store.toggleFav(ch(1));
    expect(store.isFav(ch(1))).toBe(true);
    expect(localStorage.getItem('fav_live')).not.toBeNull(); // legacy account: no prefix
    store.setCurrent(b.id);
    expect(store.isFav(ch(1))).toBe(false);
    expect(store.favs('live')).toEqual([]);
    store.toggleFav(ch(1));
    expect(localStorage.getItem(`${b.id}_fav_live`)).not.toBeNull();
    store.setCurrent(a.id);
    expect(store.isFav(ch(1))).toBe(true);
  });

  it('positions, history and fav categories are isolated too', () => {
    const [a, b] = twoAccounts();
    store.setCurrent(a.id);
    store.setPosition(ch(9, 'movie'), 1000);
    store.addHistory(ch(9, 'movie'));
    store.toggleFavCategory('live', 'c1');
    store.setCurrent(b.id);
    expect(store.position(ch(9, 'movie'))).toBe(0);
    expect(store.history(false)).toEqual([]);
    expect(store.favCategories('live')).toEqual([]);
  });
});

describe('favourites', () => {
  it('toggleFav returns new state and persists', () => {
    expect(store.toggleFav(ch(1))).toBe(true);
    expect(store.isFav(ch(1))).toBe(true);
    expect(store.favs('live')).toEqual([ch(1)]);
    expect(store.toggleFav(ch(1))).toBe(false);
    expect(store.isFav(ch(1))).toBe(false);
    expect(store.favs('live')).toEqual([]);
  });

  it('favs are per type', () => {
    store.toggleFav(ch(1, 'movie'));
    expect(store.favs('live')).toEqual([]);
    expect(store.favs('movie')).toHaveLength(1);
  });

  it('toggleFavCategory returns new state and persists', () => {
    expect(store.toggleFavCategory('movie', '5')).toBe(true);
    expect(store.favCategories('movie')).toEqual(['5']);
    expect(store.isFavCategory('movie', '5')).toBe(true);
    expect(store.toggleFavCategory('movie', '5')).toBe(false);
    expect(store.favCategories('movie')).toEqual([]);
  });
});

describe('resume', () => {
  it('position round-trips and clears on 0', () => {
    const m = ch(3, 'movie');
    expect(store.position(m)).toBe(0);
    store.setPosition(m, 12345);
    expect(store.position(m)).toBe(12345);
    expect(localStorage.getItem('pos_movie:3')).toBe('12345');
    store.setPosition(m, 0);
    expect(store.position(m)).toBe(0);
    expect(localStorage.getItem('pos_movie:3')).toBeNull();
  });

  it('duration round-trips; 0 is ignored', () => {
    const m = ch(3, 'movie');
    store.setDuration(m, 9000);
    expect(store.duration(m)).toBe(9000);
    store.setDuration(m, 0);
    expect(store.duration(m)).toBe(9000);
  });
});

describe('history', () => {
  it('caps at 40 newest-first', () => {
    for (let i = 1; i <= 45; i++) store.addHistory(ch(i, 'movie'));
    const h = store.history(false);
    expect(h).toHaveLength(40);
    expect(h[0].id).toBe('45');
    expect(h[39].id).toBe('6');
  });

  it('de-dupes and moves to front; live and vod separate', () => {
    store.addHistory(ch(1));
    store.addHistory(ch(2));
    store.addHistory(ch(1));
    store.addHistory(ch(1, 'movie'));
    expect(store.history(true).map((x) => x.id)).toEqual(['1', '2']);
    expect(store.history(false).map((x) => x.id)).toEqual(['1']);
  });
});

describe('settings', () => {
  it('homeShows defaults true and toggles', () => {
    expect(store.homeShows('continue')).toBe(true);
    store.setHomeShows('continue', false);
    expect(store.homeShows('continue')).toBe(false);
    expect(localStorage.getItem('home_continue')).toBe('false');
    expect(store.homeShows('top_movies')).toBe(true);
  });

  it('global settings have defaults and persist', () => {
    expect(store.liveFormat()).toBe('ts');
    expect(store.previewMode()).toBe(2);
    expect(store.refreshHours()).toBe(12);
    expect(store.dark()).toBe(true);
    expect(store.autoRecover()).toBe(true);
    expect(store.subtitleSize()).toBe(1);
    expect(store.subtitleColor()).toBe(0);
    expect(store.subtitleBackground()).toBe(false);
    expect(store.subtitleOpacity()).toBe(2);
    expect(store.subtitleLanguage()).toBe('');
    expect(store.audioLanguage()).toBe('');
    store.setLiveFormat('m3u8');
    store.setPreviewMode(0);
    store.setRefreshHours(-1);
    store.setDark(false);
    store.setAutoRecover(false);
    store.setSubtitleSize(3);
    store.setSubtitleColor(4);
    store.setSubtitleBackground(true);
    store.setSubtitleOpacity(1);
    store.setSubtitleLanguage('en');
    store.setAudioLanguage('fr');
    expect(store.liveFormat()).toBe('m3u8');
    expect(store.previewMode()).toBe(0);
    expect(store.refreshHours()).toBe(-1);
    expect(store.dark()).toBe(false);
    expect(store.autoRecover()).toBe(false);
    expect(store.subtitleSize()).toBe(3);
    expect(store.subtitleColor()).toBe(4);
    expect(store.subtitleBackground()).toBe(true);
    expect(store.subtitleOpacity()).toBe(1);
    expect(store.subtitleLanguage()).toBe('en');
    expect(store.audioLanguage()).toBe('fr');
  });

  it('lastRefresh is per account', () => {
    const [a, b] = twoAccounts();
    store.setCurrent(a.id);
    store.setLastRefresh(111);
    store.setCurrent(b.id);
    expect(store.lastRefresh()).toBe(0);
    store.setLastRefresh(222);
    expect(localStorage.getItem(`${b.id}_lib_time`)).toBe('222');
    expect(localStorage.getItem('lib_time')).toBe('111');
  });
});
