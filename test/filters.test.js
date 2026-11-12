// @vitest-environment jsdom
// Filters.java + FilterSettings.java: tags, writing systems, hidden categories per account,
// what disappears where, the Settings dialogs, and Home's Recently Added.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', async (importOriginal) => ({ ...(await importOriginal()), categories: vi.fn(), streams: vi.fn() }));

import * as api from '../js/api.js';
import * as store from '../js/store.js';
import * as filters from '../js/filters.js';
import * as fs from '../js/filter-settings.js';
import * as rows from '../js/home-rows.js';
import * as toast from '../js/ui/toast.js';
import { isOpen } from '../js/ui/dialog.js';
import { seedLibrary } from './helpers.js';

const CAT = (id, name) => ({ type: 'cat', id, name });
const LIVE_CATS = [CAT('1', 'UK | News'), CAT('2', 'FR: Sport'), CAT('3', '|IN| Hindi'), CAT('4', 'قنوات عربية'), CAT('5', 'Radio')];
const MOVIE_CATS = [CAT('10', 'FR | Films'), CAT('11', 'Action'), CAT('12', 'UK | Drama')];
const M = (id, cat, added) => ({ type: 'movie', id, name: `M${id}`, categoryId: cat, added });
const MOVIES = [M('a', '10', 50), M('b', '11', 40), M('c', '12', 30), M('d', '11', 20)];

const ev = (keyCode) => { const e = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { value: keyCode }); return e; };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  filters._reset();
  store.saveAccount({ id: '', server: 'http://s', user: 'u', pass: 'p', ok: true });
  store.setCurrent('');
  seedLibrary({ live: [], movie: MOVIES, series: [], cats: { live: LIVE_CATS, movie: MOVIE_CATS, series: [] } });
});
afterEach(() => { for (let i = 0; i < 3 && isOpen(); i++) window.dispatchEvent(ev(27)); toast.hide(); });

describe('Filters.tag', () => {
  it('reads the leading country / language tag', () => {
    expect(filters.tag('UK| SPORT ʰᵉᵛᶜ')).toBe('UK');
    expect(filters.tag('FR: Sport')).toBe('FR');
    expect(filters.tag('|IN| Hindi')).toBe('IN');
    expect(filters.tag('  usa - news')).toBe('US');
    expect(filters.tag('GB » Kids')).toBe('UK');
    expect(filters.tag('EX-YU | Filmovi')).toBe('EX-YU');
    expect(filters.tag('4K | UHD')).toBe('4K');
    expect(filters.tag('AR  Movies')).toBe('AR'); // two spaces count as a separator
    expect(filters.tag('Radio')).toBeNull();
    expect(filters.tag('Action Movies')).toBeNull();
    expect(filters.tag(null)).toBeNull();
  });

  it('names written mostly in another alphabet get a writing-system tag (40 % of the letters)', () => {
    expect(filters.tag('قنوات عربية')).toBe('#ARABIC');
    expect(filters.tag('Первый канал')).toBe('#CYRILLIC');
    expect(filters.tag('हिंदी फ़िल्में')).toBe('#DEVANAGARI');
    expect(filters.tag('한국 드라마')).toBe('#KOREAN');
    expect(filters.script('News عربي International')).toBeNull(); // mostly Latin
    expect(filters.tagName('#ARABIC')).toBe('Arabic writing');
    expect(filters.tagName('FR')).toBe('France');
    expect(filters.tagName('ZZ')).toBe('ZZ');
  });
});

describe('Filters: hidden categories and countries', () => {
  it('categories(): your hidden ones and filtered countries go; "always shown" brings one back', () => {
    expect(filters.categories('live', LIVE_CATS)).toBe(LIVE_CATS); // nothing hidden: same list
    filters.setCategoryHidden('live', '5', true);
    filters.setHiddenTags(new Set(['FR', '#ARABIC']));
    expect(filters.categories('live', LIVE_CATS).map((c) => c.id)).toEqual(['1', '3']);
    filters.setAlwaysShown('live', '2', true);
    expect(filters.categories('live', LIVE_CATS).map((c) => c.id)).toEqual(['1', '2', '3']);
    filters.setCategoryHidden('live', '5', false);
    expect(filters.categories('live', LIVE_CATS).map((c) => c.id)).toEqual(['1', '2', '3', '5']);
  });

  it('items() leaves out what is in hidden categories; searchItems() only applies the country filters', async () => {
    filters.setHiddenTags(new Set(['FR']));
    filters.setCategoryHidden('movie', '11', true);
    expect((await filters.items('movie', MOVIES)).map((m) => m.id)).toEqual(['c']);
    expect((await filters.searchItems('movie', MOVIES)).map((m) => m.id)).toEqual(['b', 'c', 'd']);
  });

  it('results are cached per list until something changes (version)', async () => {
    filters.setHiddenTags(new Set(['FR']));
    const a = await filters.items('movie', MOVIES);
    expect(await filters.items('movie', MOVIES)).toBe(a);
    const v = filters.getVersion();
    filters.setCategoryHidden('movie', '12', true);
    expect(filters.getVersion()).toBe(v + 1);
    expect((await filters.items('movie', MOVIES)).map((m) => m.id)).toEqual(['b', 'd']);
  });

  it('per account (Prefs.ns): another account has its own choices; removing an account removes them', () => {
    filters.setHiddenTags(new Set(['FR']));
    store.saveAccount({ id: 'a2', server: 'http://t', user: 'x', pass: 'y', ok: true });
    store.setCurrent('a2');
    expect(filters.hiddenTags().size).toBe(0);
    filters.setCategoryHidden('live', '1', true);
    expect(localStorage.getItem('a2_hide_cat_live')).toBe('["1"]');
    store.setCurrent('');
    expect([...filters.hiddenTags()]).toEqual(['FR']);
    store.removeAccount('a2');
    expect(localStorage.getItem('a2_hide_cat_live')).toBeNull();
    store.removeAccount('');
    expect(localStorage.getItem('hide_tags')).toBeNull();
  });

  it('detectTags: every tag across the three sections, most categories first', async () => {
    const tags = await filters.detectTags();
    expect([...tags.entries()]).toEqual([['FR', 2], ['UK', 2], ['#ARABIC', 1], ['IN', 1]]);
  });
});

describe('Home: Recently Added respects the filters', () => {
  it('the newest 300, minus hidden categories and countries, then 24', async () => {
    filters.setHiddenTags(new Set(['FR']));
    filters.setCategoryHidden('movie', '12', true);
    expect((await rows.recentlyAdded('movie')).map((m) => m.id)).toEqual(['b', 'd']);
  });
});

describe('FilterSettings', () => {
  it('row labels', () => {
    expect(fs.countriesLabel()).toBe('Showing everything');
    expect(fs.hiddenLabel()).toBe('None');
    filters.setHiddenTags(new Set(['FR', 'AR']));
    expect(fs.countriesLabel()).toBe('2 hidden');
    expect(fs.hiddenLabel()).toBe("See everything that's hidden");
    filters.setCategoryHidden('live', '5', true);
    filters.setCategoryHidden('movie', '11', true);
    expect(fs.hiddenLabel()).toBe('2 hidden by you · more by filters');
    expect(fs.tagLabel('FR', 3)).toBe('FR  ·  France   (3 categories)');
    expect(fs.tagLabel('#ARABIC', 1)).toBe('Arabic writing   (1 category)');
    expect(fs.tagLabel('VIP', 1)).toBe('VIP   (1 category)');
  });

  it('Countries & languages: untick and Save hides that country everywhere', async () => {
    let label = null;
    const p = fs.countries((t) => { label = t; });
    await flush();
    expect(toast.current()).toBe('Looking through your categories…');
    expect(document.querySelector('.dialog-title').textContent).toBe('Countries & languages to show');
    const items = [...document.querySelectorAll('.dialog-check')];
    expect(items.map((b) => b.textContent)).toEqual(['FR  ·  France   (2 categories)', 'UK  ·  United Kingdom   (2 categories)',
      'Arabic writing   (1 category)', 'IN  ·  India   (1 category)']);
    expect(items.every((b) => b.classList.contains('on'))).toBe(true);
    items[0].click();
    expect(items[0].classList.contains('on')).toBe(false);
    document.querySelector('.dialog-button[data-value="positive"]').click();
    await p;
    expect([...filters.hiddenTags()]).toEqual(['FR']);
    expect(label).toBe('1 hidden');
  });

  it('"Unselect all" unticks everything without closing, then reads "Select all"', async () => {
    fs.countries();
    await flush();
    const all = document.querySelector('.dialog-button[data-value="neutral"]');
    expect(all.textContent).toBe('Unselect all');
    all.click();
    expect(isOpen()).toBe(true);
    expect([...document.querySelectorAll('.dialog-check.on')].length).toBe(0);
    expect(all.textContent).toBe('Select all');
    document.querySelector('.dialog-check').click();
    expect(all.textContent).toBe('Unselect all');
    document.querySelector('.dialog-button[data-value="negative"]').click(); // Cancel: nothing saved
    await flush();
    expect(filters.hiddenTags().size).toBe(0);
  });

  it('no tags at all: a long toast, no dialog', async () => {
    seedLibrary({ live: [], movie: [], series: [], cats: { live: [CAT('1', 'Radio')], movie: [], series: [] } });
    const { _reset } = await import('../js/repo.js');
    _reset(true);
    await fs.countries();
    expect(isOpen()).toBe(false);
    expect(toast.current()).toBe("Your provider's categories aren't labelled by country or language");
  });

  it('Hidden categories: yours first, then the filters\'; unticking brings one back', async () => {
    filters.setHiddenTags(new Set(['FR']));
    filters.setCategoryHidden('movie', '11', true);
    let label = null;
    const p = fs.hidden((t) => { label = t; });
    await flush();
    expect(document.querySelector('.dialog-title').textContent).toBe('Hidden categories — untick to show');
    const items = [...document.querySelectorAll('.dialog-check')];
    expect(items.map((b) => b.textContent)).toEqual([
      'Movies  ·  Action   (hidden by you)',
      'Live TV  ·  FR: Sport   (hidden by the France filter)',
      'Movies  ·  FR | Films   (hidden by the France filter)',
    ]);
    items[0].click(); items[1].click();
    document.querySelector('.dialog-button[data-value="positive"]').click();
    await p;
    expect(filters.hiddenCategories('movie').has('11')).toBe(false);
    expect(filters.alwaysShown('live').has('2')).toBe(true);
    expect(filters.categories('live', LIVE_CATS).map((c) => c.id)).toContain('2');
    expect(label).toBe("See everything that's hidden");
  });

  it('nothing hidden: a toast says how to hide one', async () => {
    await fs.hidden();
    expect(isOpen()).toBe(false);
    expect(toast.current()).toBe('Nothing hidden. Hold OK (or press ☰) on a category to hide it.');
  });

  it('Settings lists both rows under "Hide What You Don\'t Watch"', async () => {
    const { settingsView } = await import('../js/views/settings.js');
    const v = settingsView();
    v.mount(document.getElementById('root'));
    const heads = [...document.querySelectorAll('.settings-col .section-heading')].map((h) => h.textContent);
    expect(heads.indexOf("HIDE WHAT YOU DON'T WATCH")).toBe(heads.indexOf('APPEARANCE') + 1);
    const val = (k) => document.querySelector(`.srow[data-key="${k}"] .srow-value`).textContent;
    expect(document.querySelector('.srow[data-key="countries"] .srow-label').textContent).toBe('Countries & Languages');
    expect(document.querySelector('.srow[data-key="hidden"] .srow-label').textContent).toBe('Hidden Categories');
    expect(val('countries')).toBe('Showing everything');
    expect(val('hidden')).toBe('None');
    v.unmount();
  });
});

describe('api is never asked (the saved library answers)', () => {
  it('no provider requests', () => {
    expect(api.categories).not.toHaveBeenCalled();
    expect(api.streams).not.toHaveBeenCalled();
  });
});
