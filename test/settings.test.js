// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { settingsView } from '../js/views/settings.js';
import * as repo from '../js/repo.js';
import { label } from '../js/accounts-ui.js';
import { lastUpdated } from '../js/views/settings.js';
import { seedLibrary } from './helpers.js';

let root;
const stub = () => ({ mount() {}, unmount() {} });
const $ = (sel) => root.querySelector(sel);
const click = (sel) => $(sel).click();

function addAccounts() {
  const a = { ...store.newAccount(), server: 'a.tv', user: 'ann', pass: 'x', ok: true };
  store.saveAccount(a);
  const b = { ...store.newAccount(), server: 'b.tv', user: 'bob', pass: 'y', ok: true };
  store.saveAccount(b);
  store.setCurrent(a.id);
  return [a, b];
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
  router.init(root);
  router.register('login', stub);
  router.register('settings', settingsView);
  router.register('home', stub);
});
afterEach(() => router.reset());

describe('settings view', () => {
  it('toggling live format persists to the store (the next live play reads it)', () => {
    addAccounts();
    router.go('settings');
    expect(store.liveFormat()).toBe('ts');
    click('[data-setting="live_format"]');
    expect(store.liveFormat()).toBe('m3u8');
    expect($('[data-setting="live_format"]').textContent).toContain('HLS');
    click('[data-setting="live_format"]');
    expect(store.liveFormat()).toBe('ts');
  });

  it('Customise Home lists every HOME_KEYS row (Top 10 included, no key needed) and toggling flips homeShows', () => {
    addAccounts();
    router.go('settings');
    const keys = [...root.querySelectorAll('[data-home]')].map((b) => b.dataset.home);
    expect(keys).toEqual(store.HOME_KEYS);
    expect(store.HOME_NAMES.top_movies).toBe('Top 10 Movies in the UK');
    expect(store.HOME_NAMES.top_series).toBe('Top 10 Series in the UK');
    expect(store.homeShows('fav_movie')).toBe(true);
    click('[data-home="fav_movie"]');
    expect(store.homeShows('fav_movie')).toBe(false);
    click('[data-home="fav_movie"]');
    expect(store.homeShows('fav_movie')).toBe(true);
  });

  it('user-agent edits persist and are what the next api request will send', () => {
    addAccounts();
    router.go('settings');
    const input = $('[data-setting="user_agent"]');
    expect(input.value).toBe(store.DEFAULT_UA);
    input.value = 'MyAgent/2.0';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.userAgent()).toBe('MyAgent/2.0');
  });

  it('subtitle, audio, preview, refresh and theme settings persist', () => {
    addAccounts();
    router.go('settings');
    click('[data-setting="sub_size"]');
    expect(store.subtitleSize()).toBe(2);
    click('[data-setting="sub_color"]');
    expect(store.subtitleColor()).toBe(1);
    click('[data-setting="sub_bg"]');
    expect(store.subtitleBackground()).toBe(true);
    click('[data-setting="sub_opacity"]');
    expect(store.subtitleOpacity()).toBe(3);
    click('[data-setting="preview"]');
    expect(store.previewMode()).toBe(0);
    expect($('[data-setting="refresh"]').textContent).toBe('Every 12 hours');
    click('[data-setting="refresh"]');
    expect(store.refreshHours()).toBe(24);
    expect($('[data-setting="refresh"]').textContent).toBe('Once a day');
    for (const [h, t] of [[6, 'Every 6 hours'], [0, 'Every time the app opens'], [-1, 'Only when I ask'], [12, 'Every 12 hours']]) {
      click('[data-setting="refresh"]');
      expect(store.refreshHours()).toBe(h);
      expect($('[data-setting="refresh"]').textContent).toBe(t);
    }
    click('[data-setting="dark"]');
    expect(store.dark()).toBe(false);
    for (const [sel, setter] of [['sub_lang', 'subtitleLanguage'], ['audio_lang', 'audioLanguage']]) {
      const el = $(`[data-setting="${sel}"]`);
      el.value = 'eng';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(store[setter]()).toBe('eng');
    }
  });

  it('ACCOUNTS comes first: one row per account ("✓  In use" / "Switch"), then Add, Edit, Remove', () => {
    const [a, b] = addAccounts();
    router.go('settings');
    const sec = root.querySelector('.settings-col > section');
    expect(sec.querySelector('h2').textContent).toBe('Accounts');
    const rows = [...sec.querySelectorAll('.setting')].map((r) => [r.querySelector('span').textContent, r.querySelector('button').textContent]);
    expect(rows).toEqual([
      [label(a), '✓  In use'], [label(b), 'Switch'],
      ['Add Account', ''], ['Edit This Account', ''], ['Remove This Account', ''],
    ]);
    expect(label(a)).toBe('ann @ a.tv');
    expect(label({ name: ' Ben TV ', user: 'x', server: 'http://b.tv:80' })).toBe('Ben TV');
    expect(label({ user: 'x', server: 'https://b.tv:8080/p' })).toBe('x @ b.tv:8080/p');
  });

  it('Switch makes it current, forgets the library in memory and restarts at Home', () => {
    const [, b] = addAccounts();
    const clear = vi.spyOn(repo, 'clear');
    router.go('settings');
    click(`[data-account="${b.id}"] [data-action="switch"]`);
    expect(store.current().id).toBe(b.id);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(router.current().name).toBe('home');
    expect(router.stackDepth()).toBe(1);
    clear.mockRestore();
  });

  it('Add Account and Edit This Account open Login in add / edit mode', () => {
    addAccounts();
    router.go('settings');
    click('[data-action="add"]');
    expect(router.current()).toMatchObject({ name: 'login', params: { add: true } });
    router.back();
    click('[data-action="edit"]');
    expect(router.current()).toMatchObject({ name: 'login', params: { edit: true } });
  });

  it('Remove asks first; Cancel keeps the account', async () => {
    addAccounts();
    router.go('settings');
    click('[data-action="remove"]');
    expect(document.querySelector('.dialog-title').textContent).toBe('Remove ann @ a.tv?');
    expect(document.querySelector('.dialog-message').textContent).toBe('Its favourites and watch history will be deleted from this device.');
    document.querySelector('.dialog [data-value="negative"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.accounts()).toHaveLength(2);
  });

  it('Remove deletes its saved library and data, then restarts at Home with the next account', async () => {
    const [a, b] = addAccounts();
    seedLibrary();
    const mine = repo._backend().keys();
    expect(mine.length).toBe(6);
    store.setCurrent(b.id); seedLibrary(); store.setCurrent(a.id); // b has a library too
    router.go('settings');
    click('[data-action="remove"]');
    document.querySelector('.dialog [data-value="positive"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.accounts().map((x) => x.id)).toEqual([b.id]);
    expect(repo._backend().keys().filter((k) => mine.includes(k))).toEqual([]);
    expect(repo._backend().keys()).toHaveLength(6);
    expect(router.current().name).toBe('home');
  });

  it('removing the last account routes to Login', async () => {
    const a = { ...store.newAccount(), server: 'a.tv', user: 'ann', pass: 'x', ok: true };
    store.saveAccount(a); store.setCurrent(a.id);
    router.go('settings');
    click('[data-action="remove"]');
    document.querySelector('.dialog [data-value="positive"]').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.accounts()).toHaveLength(0);
    expect(router.current().name).toBe('login');
  });

  it('Refresh Now shows when the library was last updated, "Updating…", then the new time', async () => {
    addAccounts();
    expect(lastUpdated(0)).toBe('Not yet');
    const now = new Date(2026, 10, 12, 18, 5);
    expect(lastUpdated(new Date(2026, 10, 12, 9, 7).getTime(), now)).toBe('Updated today at 09:07');
    expect(lastUpdated(new Date(2026, 2, 3, 21, 30).getTime(), now)).toBe('Updated 3 Mar, 21:30');
    let finish;
    const spy = vi.spyOn(repo, 'refreshAll').mockReturnValue(new Promise((r) => { finish = r; }));
    router.go('settings');
    expect($('[data-setting="refresh_now"]').textContent).toBe('Not yet');
    click('[data-setting="refresh_now"]');
    expect($('[data-setting="refresh_now"]').textContent).toBe('Updating…');
    store.setLastRefresh(Date.now());
    finish(); await new Promise((r) => setTimeout(r, 0));
    expect($('[data-setting="refresh_now"]').textContent).toMatch(/^Updated today at \d\d:\d\d$/);
    spy.mockRejectedValue(new Error('Server returned HTTP 500'));
    click('[data-setting="refresh_now"]');
    await new Promise((r) => setTimeout(r, 0));
    expect($('[data-setting="refresh_now"]').textContent).toBe('Failed — Server returned HTTP 500');
    spy.mockRestore();
  });
});
