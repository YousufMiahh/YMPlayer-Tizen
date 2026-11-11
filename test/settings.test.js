// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/home-rows.js', () => ({ clearCache: vi.fn() }));

import * as store from '../js/store.js';
import { router } from '../js/router.js';
import { settingsView } from '../js/views/settings.js';
import { setupView } from '../js/views/setup.js';
import { clearCache } from '../js/home-rows.js';

let root;
const stub = () => ({ mount() {}, unmount() {} });
const $ = (sel) => root.querySelector(sel);
const click = (sel) => $(sel).click();

function addAccounts() {
  const a = { ...store.newAccount(), server: 'a.tv', user: 'ann', pass: 'x' };
  store.saveAccount(a);
  const b = { ...store.newAccount(), server: 'b.tv', user: 'bob', pass: 'y' };
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
  router.register('setup', setupView);
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

  it('Customise Home lists every HOME_KEYS row and toggling flips homeShows', () => {
    addAccounts();
    router.go('settings');
    const keys = [...root.querySelectorAll('[data-home]')].map((b) => b.dataset.home);
    expect(keys).toEqual(store.HOME_KEYS.filter((k) => k !== 'top_movies' && k !== 'top_series'));
    expect(store.homeShows('fav_movie')).toBe(true);
    click('[data-home="fav_movie"]');
    expect(store.homeShows('fav_movie')).toBe(false);
    click('[data-home="fav_movie"]');
    expect(store.homeShows('fav_movie')).toBe(true);
  });

  it('Customise Home shows the Top 10 toggles only when a TMDB key exists', () => {
    addAccounts();
    router.go('settings');
    expect(root.querySelector('[data-home="top_movies"]')).toBeNull();
    expect(root.querySelector('[data-home="top_series"]')).toBeNull();
    router.reset(); router.init(root);
    router.register('settings', settingsView); router.register('setup', setupView);
    globalThis.YM_KEYS = { tmdb: 'k' };
    try {
      router.go('settings');
      expect(root.querySelector('[data-home="top_movies"]')).not.toBeNull();
      expect(root.querySelector('[data-home="top_series"]')).not.toBeNull();
    } finally { delete globalThis.YM_KEYS; }
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
    click('[data-setting="refresh"]');
    expect(store.refreshHours()).toBe(24);
    click('[data-setting="dark"]');
    expect(store.dark()).toBe(false);
    for (const [sel, setter] of [['sub_lang', 'subtitleLanguage'], ['audio_lang', 'audioLanguage']]) {
      const el = $(`[data-setting="${sel}"]`);
      el.value = 'eng';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      expect(store[setter]()).toBe('eng');
    }
  });

  it('switching account clears the Home cache and updates the current account', () => {
    const [, b] = addAccounts();
    router.go('settings');
    click(`[data-account="${b.id}"] [data-action="switch"]`);
    expect(store.current().id).toBe(b.id);
    expect(clearCache).toHaveBeenCalledTimes(1);
  });

  it('removing the last account routes to login', () => {
    const a = { ...store.newAccount(), server: 'a.tv', user: 'ann', pass: 'x' };
    store.saveAccount(a); store.setCurrent(a.id);
    router.go('settings');
    click(`[data-account="${a.id}"] [data-action="remove"]`);
    expect(store.accounts()).toHaveLength(0);
    expect(router.current().name).toBe('login');
  });
});

describe('setup view account switch', () => {
  it('also clears the Home cache', () => {
    const [, b] = addAccounts();
    router.go('setup');
    click(`[data-account="${b.id}"] [data-action="switch"]`);
    expect(clearCache).toHaveBeenCalledTimes(1);
  });
});
