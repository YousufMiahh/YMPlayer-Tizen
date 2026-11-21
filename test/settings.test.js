// @vitest-environment jsdom
// Settings (SettingsActivity.java): sections, rows, values, defaults, dialogs.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as store from '../js/store.js';
import * as api from '../js/api.js';
import * as repo from '../js/repo.js';
import * as coach from '../js/ui/coach.js';
import * as toast from '../js/ui/toast.js';
import { router } from '../js/router.js';
import { isDark } from '../js/ui/theme.js';
import { label } from '../js/accounts-ui.js';
import {
  settingsView, lastUpdated, refreshLabel, subscriptionText, sampleStyle, PREVIEW, REFRESH_HOURS, UA_MESSAGE, CREDIT, SAMPLE_TEXT,
} from '../js/views/settings.js';
import { VERSION } from '../js/version.js';
import { seedLibrary } from './helpers.js';

let root; let login;
const stub = () => ({ mount() {}, unmount() {} });
const row = (key) => root.querySelector(`.srow[data-key="${key}"]`);
const value = (key) => row(key).querySelector('.srow-value').textContent;
const click = (key) => row(key).click();
const tick = () => new Promise((r) => setTimeout(r, 0));
const dlg = (sel) => document.querySelector(`.dialog ${sel}`);

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
  login = vi.spyOn(api, 'login').mockResolvedValue({ user_info: { status: 'Active', exp_date: '1803945600', active_cons: '1', max_connections: '2' } });
  router.init(root);
  router.register('login', stub);
  router.register('settings', settingsView);
  router.register('home', stub);
});
afterEach(() => { router.reset(); login.mockRestore(); toast.hide(); document.querySelectorAll('.dialog-scrim').forEach((d) => d.remove()); });

describe('Settings: the list', () => {
  it("has Android's sections and rows in Android's order, with the defaults", () => {
    const [a, b] = addAccounts();
    router.go('settings');
    const out = [];
    for (const el of root.querySelector('.settings-col').querySelectorAll('.section-heading, .srow, .srow-sample, .settings-credit')) {
      if (el.classList.contains('section-heading')) out.push(`# ${el.textContent}`);
      else if (el.classList.contains('srow-sample')) out.push(`(sample) ${el.textContent}`);
      else if (el.classList.contains('settings-credit')) out.push(`(credit) ${el.textContent}`);
      else out.push(`${el.querySelector('.srow-label').textContent} | ${el.querySelector('.srow-value').textContent}${el.classList.contains('info') ? ' | info' : ''}`);
    }
    expect(out).toEqual([
      '# ACCOUNTS',
      `${label(a)} | ✓  In use | info`,
      `${label(b)} | Switch`,
      'Subscription | Checking… | info',
      'Add Account | ',
      'Edit This Account | ',
      'Remove This Account | ',
      '# SYNC',
      'Sync With Your Other Devices | On',
      'Sync Now | Not set up in this version',
      '# APPEARANCE',
      'Theme | Dark',
      'Live TV Preview | On with sound',
      'Film & Series Previews | On',
      "# HIDE WHAT YOU DON'T WATCH",
      'Countries & Languages | Showing everything',
      'Rename Categories | Give categories your own names',
      'Hidden Categories | None',
      '# CUSTOMISE HOME SCREEN',
      'Continue Watching | On',
      'Recent Channels | On',
      'Favourite Channels | On',
      'Favourite Movies | On',
      'Favourite Series | On',
      'Top 10 Movies in the UK | On',
      'Top 10 Series in the UK | On',
      'Because You Watched… | On',
      'Recently Added Movies | On',
      'Recently Added Series | On',
      '# SUBTITLES',
      'Size | Medium',
      'Colour | White',
      'Background | Off',
      'Background Opacity | 75%',
      `(sample) ${SAMPLE_TEXT}`,
      '# PLAYBACK',
      'Live Stream Format | MPEG-TS',
      'Fix Frozen Video Automatically | On',
      `User Agent | ${store.DEFAULT_UA}`,
      '# LIBRARY',
      'Refresh Automatically | Every 12 hours',
      'Refresh Now | Not yet',
      'Clear Watch History | ',
      'Show Tutorial | Quick tour of the basics',
      '# ABOUT',
      `Version | YM Player ${VERSION} | info`,
      "What's New | What changed in this version",
      `(credit) ${CREDIT}`,
    ]);
    expect(CREDIT).toBe('Developed by Yousuf Miah');
    expect(label(a)).toBe('ann @ a.tv');
    expect(label({ name: ' Ben TV ', user: 'x', server: 'http://b.tv:80' })).toBe('Ben TV');
    expect(label({ user: 'x', server: 'https://b.tv:8080/p' })).toBe('x @ b.tv:8080/p');
  });

  it('has none of the rows Android does not have, nor the ones that cannot work on a Samsung TV', () => {
    addAccounts();
    router.go('settings');
    const text = root.textContent;
    for (const gone of ['Dark theme', 'Extras', 'Ambient', 'Phone', 'Subtitle language', 'Audio language',
      'Video Player', 'Remembered Player Choices', 'Last Error Report', 'Audio Sync', 'Check for Updates']) expect(text).not.toContain(gone);
    expect(root.querySelector('.settings-col input')).toBeNull(); // no inline text fields: values are text, edits are dialogs
    expect(root.querySelector('h1')).toBeNull();
  });

  it('rows are whole pills: actionable ones are buttons, info rows cannot take focus; the first actionable row starts focused', () => {
    const [, b] = addAccounts();
    router.go('settings');
    expect(row('subscription').tagName).toBe('DIV');
    expect(row('version').tagName).toBe('DIV');
    expect(row('theme').tagName).toBe('BUTTON');
    expect(document.activeElement).toBe(row(`account_${b.id}`));
  });

  it('Subscription fills in from the provider, or says "Offline — …"', async () => {
    addAccounts();
    router.go('settings');
    expect(value('subscription')).toBe('Checking…');
    await tick();
    expect(value('subscription')).toMatch(/^Active {2}· {2}Expires: [12] Mar 2027 {2}· {2}Connections: 1\/2$/);
    login.mockRejectedValue(new Error('Server returned HTTP 502'));
    expect(await subscriptionText()).toBe('Offline — Server returned HTTP 502');
  });
});

describe('Settings: each row saves at once', () => {
  beforeEach(() => { addAccounts(); router.go('settings'); });

  it('Live TV Preview cycles Off → On (muted) → On with sound', () => {
    expect(PREVIEW).toEqual(['Off', 'On (muted)', 'On with sound']);
    click('preview'); expect(store.previewMode()).toBe(0); expect(value('preview')).toBe('Off');
    click('preview'); expect(store.previewMode()).toBe(1); expect(value('preview')).toBe('On (muted)');
    click('preview'); expect(store.previewMode()).toBe(2); expect(value('preview')).toBe('On with sound');
  });

  it('Theme flips Dark / Light, re-themes the app and restarts at Home', () => {
    click('theme');
    expect(store.dark()).toBe(false);
    expect(isDark()).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(router.current().name).toBe('home');
    expect(router.stackDepth()).toBe(1);
    router.go('settings');
    expect(value('theme')).toBe('Light');
    click('theme');
    expect(store.dark()).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('Customise Home Screen: every HOME_KEYS row toggles On / Off', () => {
    for (const k of store.HOME_KEYS) {
      click(`home_${k}`);
      expect(store.homeShows(k)).toBe(false); expect(value(`home_${k}`)).toBe('Off');
      click(`home_${k}`);
      expect(store.homeShows(k)).toBe(true); expect(value(`home_${k}`)).toBe('On');
    }
  });

  it('Subtitles: Size, Colour, Background and Opacity cycle, and the sample follows', () => {
    const sample = root.querySelector('.srow-sample span');
    expect(sample.style.fontSize).toBe(`${23 * 1.4}px`);
    for (const [i, name] of [[2, 'Large'], [3, 'Extra Large'], [0, 'Small'], [1, 'Medium']]) {
      click('sub_size'); expect(store.subtitleSize()).toBe(i); expect(value('sub_size')).toBe(name);
    }
    for (const [i, name] of [[1, 'Yellow'], [2, 'Cyan'], [3, 'Green'], [4, 'Pink'], [5, 'Orange'], [0, 'White']]) {
      click('sub_color'); expect(store.subtitleColor()).toBe(i); expect(value('sub_color')).toBe(name);
    }
    click('sub_color');
    expect(sampleStyle().color).toBe('#FFE14D');
    expect(sampleStyle().background).toBe('transparent');
    expect(sampleStyle().textShadow).not.toBe('none');
    click('sub_opacity'); // Background is off: the toast says so
    expect(store.subtitleOpacity()).toBe(3); expect(value('sub_opacity')).toBe('100%');
    expect(toast.current()).toBe('Turn Background on to see this');
    toast.hide();
    click('sub_bg');
    expect(store.subtitleBackground()).toBe(true); expect(value('sub_bg')).toBe('On');
    expect(sampleStyle().background).toBe('rgba(0, 0, 0, 1.000)');
    expect(sampleStyle().textShadow).toBe('none');
    for (const [i, name] of [[0, '25%'], [1, '50%'], [2, '75%']]) {
      click('sub_opacity'); expect(store.subtitleOpacity()).toBe(i); expect(value('sub_opacity')).toBe(name);
    }
    expect(toast.current()).toBeNull();
    click('sub_bg');
    expect(store.subtitleBackground()).toBe(false); expect(value('sub_bg')).toBe('Off');
  });

  it('Live Stream Format flips MPEG-TS / HLS; Fix Frozen Video Automatically flips On / Off', () => {
    click('live_format'); expect(store.liveFormat()).toBe('m3u8'); expect(value('live_format')).toBe('HLS');
    click('live_format'); expect(store.liveFormat()).toBe('ts'); expect(value('live_format')).toBe('MPEG-TS');
    click('auto_recover'); expect(store.autoRecover()).toBe(false); expect(value('auto_recover')).toBe('Off');
    click('auto_recover'); expect(store.autoRecover()).toBe(true); expect(value('auto_recover')).toBe('On');
  });

  it('Refresh Automatically cycles 12 → 24 → 6 → every launch → only when asked', () => {
    expect(REFRESH_HOURS).toEqual([12, 24, 6, 0, -1]);
    expect(refreshLabel(3)).toBe('Every 3 hours');
    for (const [h, t] of [[24, 'Once a day'], [6, 'Every 6 hours'], [0, 'Every time the app opens'], [-1, 'Only when I ask'], [12, 'Every 12 hours']]) {
      click('refresh');
      expect(store.refreshHours()).toBe(h);
      expect(value('refresh')).toBe(t);
    }
  });

  it('Refresh Now shows when the library was last updated, "Updating…", then the new time or the failure', async () => {
    expect(lastUpdated(0)).toBe('Not yet');
    const now = new Date(2026, 10, 12, 18, 5);
    expect(lastUpdated(new Date(2026, 10, 12, 9, 7).getTime(), now)).toBe('Updated today at 09:07');
    expect(lastUpdated(new Date(2026, 2, 3, 21, 30).getTime(), now)).toBe('Updated 3 Mar, 21:30');
    let finish;
    const spy = vi.spyOn(repo, 'refreshAll').mockReturnValue(new Promise((r) => { finish = r; }));
    click('refresh_now');
    expect(value('refresh_now')).toBe('Updating…');
    store.setLastRefresh(Date.now());
    finish(); await tick();
    expect(value('refresh_now')).toMatch(/^Updated today at \d\d:\d\d$/);
    spy.mockRejectedValue(new Error('Server returned HTTP 500'));
    click('refresh_now');
    await tick();
    expect(value('refresh_now')).toBe('Failed — Server returned HTTP 500');
    spy.mockRestore();
  });
});

describe('Settings: User Agent dialog', () => {
  beforeEach(() => { addAccounts(); router.go('settings'); });

  it("opens Android's dialog: title, message, the field holding the current agent, Default / Cancel / Save", () => {
    click('user_agent');
    expect(dlg('.dialog-title').textContent).toBe('User Agent');
    expect(dlg('.dialog-message').textContent).toBe(UA_MESSAGE);
    expect(dlg('.dialog-input').value).toBe(store.DEFAULT_UA);
    expect([...document.querySelectorAll('.dialog .dialog-button')].map((b) => b.textContent)).toEqual(['Default', 'Cancel', 'Save']);
  });

  it('Save stores the trimmed text (what the next request and stream will send) and the row shows it', async () => {
    click('user_agent');
    dlg('.dialog-input').value = '  IPTVSmartersPlayer ';
    dlg('[data-value="positive"]').click();
    await tick();
    expect(store.userAgent()).toBe('IPTVSmartersPlayer');
    expect(value('user_agent')).toBe('IPTVSmartersPlayer');
  });

  it('Cancel and Back change nothing; Default puts the built-in agent back', async () => {
    store.setUserAgent('VLC/3.0.20');
    click('user_agent');
    dlg('.dialog-input').value = 'Other';
    dlg('[data-value="negative"]').click();
    await tick();
    expect(store.userAgent()).toBe('VLC/3.0.20');
    click('user_agent');
    dlg('[data-value="neutral"]').click();
    await tick();
    expect(store.userAgent()).toBe(store.DEFAULT_UA);
    expect(value('user_agent')).toBe(store.DEFAULT_UA);
  });

  it('▼ or the keyboard\'s Done leaves the field for Save; the row keeps its focused look under the dialog', () => {
    row('user_agent').focus();
    click('user_agent');
    const field = dlg('.dialog-input');
    expect(document.activeElement).toBe(field);
    expect(row('user_agent').classList.contains('keep-focus')).toBe(true);
    field.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 65376, bubbles: true, cancelable: true }));
    expect(document.activeElement.textContent).toBe('Save');
  });
});

describe('Settings: accounts', () => {
  it('Switch makes it current, forgets the library in memory and restarts at Home', () => {
    const [, b] = addAccounts();
    const clear = vi.spyOn(repo, 'clear');
    router.go('settings');
    click(`account_${b.id}`);
    expect(store.current().id).toBe(b.id);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(router.current().name).toBe('home');
    expect(router.stackDepth()).toBe(1);
    clear.mockRestore();
  });

  it('Add Account and Edit This Account open Login in add / edit mode', () => {
    addAccounts();
    router.go('settings');
    click('add_account');
    expect(router.current()).toMatchObject({ name: 'login', params: { add: true } });
    router.back();
    click('edit_account');
    expect(router.current()).toMatchObject({ name: 'login', params: { edit: true } });
  });

  it('Remove asks first; Cancel (or Back) keeps the account', async () => {
    addAccounts();
    router.go('settings');
    click('remove_account');
    expect(dlg('.dialog-title').textContent).toBe('Remove ann @ a.tv?');
    expect(dlg('.dialog-message').textContent).toBe('Its favourites and watch history will be deleted from this device.');
    expect([...document.querySelectorAll('.dialog .dialog-button')].map((b) => b.textContent)).toEqual(['Cancel', 'Remove']);
    dlg('[data-value="negative"]').click();
    await tick();
    expect(store.accounts()).toHaveLength(2);
    expect(router.current().name).toBe('settings');
  });

  it('Remove deletes its saved library and data, then restarts at Home with the next account', async () => {
    const [a, b] = addAccounts();
    seedLibrary();
    const mine = repo._backend().keys();
    expect(mine.length).toBe(6);
    store.setCurrent(b.id); seedLibrary(); store.setCurrent(a.id); // b has a library too
    router.go('settings');
    click('remove_account');
    dlg('[data-value="positive"]').click();
    await tick();
    expect(store.accounts().map((x) => x.id)).toEqual([b.id]);
    expect(repo._backend().keys().filter((k) => mine.includes(k))).toEqual([]);
    expect(repo._backend().keys()).toHaveLength(6);
    expect(router.current().name).toBe('home');
  });

  it('removing one of two accounts with the same server and user keeps the library the other uses', async () => {
    const a = { ...store.newAccount(), name: 'Lounge', server: 'a.tv', user: 'ann', pass: 'x', ok: true };
    store.saveAccount(a);
    const b = { ...store.newAccount(), name: 'Bedroom', server: 'http://a.tv/', user: 'ann', pass: 'x', ok: true };
    store.saveAccount(b);
    store.setCurrent(a.id);
    seedLibrary();
    expect(repo._backend().keys()).toHaveLength(6);
    router.go('settings');
    click('remove_account');
    dlg('[data-value="positive"]').click();
    await tick();
    expect(store.accounts().map((x) => x.id)).toEqual([b.id]);
    expect(repo._backend().keys()).toHaveLength(6); // still there for "Bedroom"
    expect(repo.hasLibrary()).toBe(true);
  });

  it('switching or removing an account forgets the TV guide listings', async () => {
    const guide = await import('../js/guide.js');
    const clear = vi.spyOn(guide, 'clear');
    const [, b] = addAccounts();
    router.go('settings');
    click(`account_${b.id}`);
    expect(clear).toHaveBeenCalledTimes(1);
    router.go('settings');
    click('remove_account');
    dlg('[data-value="positive"]').click();
    await tick();
    expect(clear).toHaveBeenCalledTimes(2);
    clear.mockRestore();
  });

  it('removing the last account routes to Login', async () => {
    const a = { ...store.newAccount(), server: 'a.tv', user: 'ann', pass: 'x', ok: true };
    store.saveAccount(a); store.setCurrent(a.id);
    router.go('settings');
    click('remove_account');
    dlg('[data-value="positive"]').click();
    await tick();
    expect(store.accounts()).toHaveLength(0);
    expect(router.current().name).toBe('login');
  });
});

describe('Settings: Clear Watch History and Show Tutorial', () => {
  it('Clear Watch History clears this account\'s resume points, lengths and history at once, with a toast (no dialog, as on Android)', () => {
    const [a, b] = addAccounts();
    const film = { type: 'movie', id: '7', name: 'Film' }; const chan = { type: 'live', id: '3', name: 'One' };
    for (const acc of [b, a]) {
      store.setCurrent(acc.id);
      store.addHistory(film); store.addHistory(chan); store.setPosition(film, 60000); store.setDuration(film, 6000000);
      store.toggleFav(film);
    }
    router.go('settings');
    click('clear_history');
    expect(document.querySelector('.dialog')).toBeNull();
    expect(toast.current()).toBe('Watch history cleared');
    expect(store.history(false)).toEqual([]);
    expect(store.history(true)).toEqual([]);
    expect(store.position(film)).toBe(0);
    expect(store.duration(film)).toBe(0);
    expect(store.isFav(film)).toBe(true); // favourites stay
    store.setCurrent(b.id); // the other account is untouched
    expect(store.history(false)).toHaveLength(1);
    expect(store.position(film)).toBe(60000);
  });

  it('Show Tutorial switches the tutorial on, forgets every tour that was seen and restarts at Home', () => {
    addAccounts();
    for (const k of ['home', 'live', 'vod', 'search', 'player_live', 'player_vod']) localStorage.setItem(`coach_seen_${k}`, 'true');
    localStorage.setItem('coach_asked', 'true'); localStorage.setItem('coach_on', 'false');
    router.go('settings');
    expect(coach.wants('home')).toBe(false);
    click('tutorial');
    for (const k of ['home', 'live', 'vod', 'search', 'player_live', 'player_vod']) expect(coach.wants(k)).toBe(true);
    expect(localStorage.getItem('coach_asked')).toBe('true'); // the welcome offer is not asked again
    expect(router.current().name).toBe('home');
    expect(router.stackDepth()).toBe(1);
  });
});

describe('Settings: the end of the list', () => {
  it('▼ on the last row scrolls on by up to half the screen, so Version and the credit come into view', () => {
    vi.stubGlobal('requestAnimationFrame', undefined); // no glide: the scroll lands at once
    addAccounts();
    router.go('settings', {});
    const screen = root.querySelector('.section-settings');
    Object.defineProperty(screen, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(screen, 'clientHeight', { value: 1080, configurable: true });
    screen.scrollTop = 1600;
    const view = router.current().view;
    const down = () => { const e = new KeyboardEvent('keydown', { keyCode: 40, cancelable: true }); return [view.onKey(e), e.defaultPrevented]; };
    row('clear_history').focus();
    expect(down()[0]).toBe(false); // not the last row: ordinary focus movement
    row('whats_new').focus(); // the last row you can land on
    screen.scrollTop = 1600;
    expect(down()).toEqual([true, true]);
    expect(screen.scrollTop).toBe(1920); // 3000 − 1080: the end
    screen.scrollTop = 1000;
    down();
    expect(screen.scrollTop).toBe(1540); // half a screen at most
    vi.unstubAllGlobals();
  });
});

describe('Settings: coming back', () => {
  it('returns to the row you left (Login and back)', () => {
    addAccounts();
    router.go('settings', {}); // as the top bar opens it
    row('edit_account').focus();
    click('edit_account');
    router.back();
    expect(document.activeElement).toBe(row('edit_account'));
  });
});
