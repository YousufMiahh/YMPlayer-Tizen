// Settings: playback, subtitles, Customise Home, theme, accounts. Every control writes straight to the store.
import * as store from '../store.js';
import * as nav from '../nav.js';
import { mountAccounts } from '../accounts-ui.js';
import * as repo from '../repo.js';
import * as api from '../api.js';
import { router } from '../router.js';
import { mountSection, tabFocused } from '../ui/topbar.js';
import { applyTheme } from '../ui/theme.js';
import * as backdrop from '../ui/backdrop.js';
import * as filterSettings from '../filter-settings.js';

const COLORS = ['White', 'Yellow', 'Green', 'Cyan', 'Blue', 'Red'];
const SIZES = ['Small', 'Medium', 'Large'];
const OPACITY = ['25%', '50%', '75%', '100%'];
const PREVIEW = ['Off', 'Muted', 'With sound'];
// SettingsActivity LIBRARY: "Refresh Automatically" cycle order and texts.
const REFRESH = [[12, 'Every 12 hours'], [24, 'Once a day'], [6, 'Every 6 hours'], [0, 'Every time the app opens'], [-1, 'Only when I ask']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

/** SettingsActivity.lastUpdated(). */
export function lastUpdated(t = store.lastRefresh(), now = new Date()) {
  if (!t) return 'Not yet';
  const d = new Date(t);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `Updated today at ${hm}`;
  return `Updated ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hm}`;
}
const onOff = (b) => (b ? 'On' : 'Off');

// Cycle controls: key -> { title, get, set, options (values), text(value) }.
const CYCLES = [
  ['Playback', [
    { key: 'live_format', title: 'Live stream format', get: store.liveFormat, set: store.setLiveFormat,
      options: ['ts', 'm3u8'], text: (v) => (v === 'ts' ? 'TS' : 'HLS') },
    { key: 'preview', title: 'Preview mode', get: store.previewMode, set: store.setPreviewMode,
      options: [0, 1, 2], text: (v) => PREVIEW[v] },
    { key: 'refresh', title: 'Refresh Automatically', get: store.refreshHours, set: store.setRefreshHours,
      options: REFRESH.map((r) => r[0]), text: (v) => (REFRESH.find((r) => r[0] === v) || [0, `Every ${v} hours`])[1] },
  ]],
  ['Subtitles', [
    { key: 'sub_size', title: 'Size', get: store.subtitleSize, set: store.setSubtitleSize,
      options: [0, 1, 2], text: (v) => SIZES[v] ?? String(v) },
    { key: 'sub_color', title: 'Colour', get: store.subtitleColor, set: store.setSubtitleColor,
      options: COLORS.map((_, i) => i), text: (v) => COLORS[v] },
    { key: 'sub_bg', title: 'Background', get: store.subtitleBackground, set: store.setSubtitleBackground,
      options: [false, true], text: onOff },
    { key: 'sub_opacity', title: 'Background opacity', get: store.subtitleOpacity, set: store.setSubtitleOpacity,
      options: [0, 1, 2, 3], text: (v) => OPACITY[v] },
  ]],
];

const TEXTS = [
  ['Playback', { key: 'user_agent', title: 'User-agent', get: store.userAgent, set: store.setUserAgent }],
  ['Subtitles', { key: 'sub_lang', title: 'Subtitle language', get: store.subtitleLanguage, set: store.setSubtitleLanguage }],
  ['Subtitles', { key: 'audio_lang', title: 'Audio language', get: store.audioLanguage, set: store.setAudioLanguage }],
];

function row(title) {
  const r = document.createElement('div');
  r.className = 'setting';
  const l = document.createElement('span');
  l.textContent = title;
  r.appendChild(l);
  return r;
}

/** SettingsActivity.refreshNow. */
export function refreshNow(v) {
  if (repo.isRefreshing()) return Promise.resolve();
  v.textContent = 'Updating…';
  return repo.refreshAll().then(
    () => { v.textContent = lastUpdated(); },
    (e) => { v.textContent = `Failed — ${api.errorMessage(e)}`; },
  );
}

export function settingsView() {
  let root; let accountsUi; let onActivate; let onClick; let onChange;
  const cycles = new Map();

  function paint(btn, c) { btn.textContent = c.text(c.get()); }

  function section(el, name) {
    const s = document.createElement('section');
    s.innerHTML = `<h2>${name}</h2>`;
    el.appendChild(s);
    return s;
  }

  return {
    mount(rootEl) {
      root = rootEl;
      const outer = document.createElement('div');
      outer.className = 'settings';
      const el = document.createElement('div');
      el.className = 'settings-col';
      outer.appendChild(el);
      const sections = {};
      const sec = (n) => (sections[n] ||= section(el, n));

      for (const [name, defs] of CYCLES) {
        for (const c of defs) {
          const r = row(c.title);
          const b = document.createElement('button');
          b.type = 'button'; b.dataset.setting = c.key;
          cycles.set(c.key, c); paint(b, c);
          r.appendChild(b); sec(name).appendChild(r);
        }
      }
      for (const [name, t] of TEXTS) {
        const r = row(t.title);
        const i = document.createElement('input');
        i.type = 'text'; i.dataset.setting = t.key; i.value = t.get();
        r.appendChild(i); sec(name).appendChild(r);
      }

      // SettingsActivity: "Hide What You Don't Watch" comes straight after the playback rows.
      const hide = section(el, filterSettings.SECTION);
      for (const [k, title, label] of [['countries', filterSettings.COUNTRIES, filterSettings.countriesLabel],
        ['hidden', filterSettings.HIDDEN, filterSettings.hiddenLabel]]) {
        const r = row(title);
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.filter = k; b.textContent = label();
        r.appendChild(b); hide.appendChild(r);
      }
      if (sections.Playback) sections.Playback.after(hide);

      const home = section(el, 'Customise Home');
      for (const k of store.HOME_KEYS) {
        const r = row(store.HOME_NAMES[k]);
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.home = k; b.textContent = onOff(store.homeShows(k));
        r.appendChild(b); home.appendChild(r);
      }

      // Tizen extras that Android doesn't have; they used to sit on the Home menu.
      const extras = section(el, 'Extras');
      for (const [view, title] of [['ambient', 'Ambient']]) {
        const r = row(title);
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.open = view; b.textContent = 'Open';
        r.appendChild(b); extras.appendChild(r);
      }

      const theme = section(el, 'Theme');
      const tr = row('Dark theme');
      const tb = document.createElement('button');
      tb.type = 'button'; tb.dataset.setting = 'dark'; tb.textContent = onOff(store.dark());
      tr.appendChild(tb); theme.appendChild(tr);

      const lib = section(el, 'Library');
      const rn = row('Refresh Now');
      const rb = document.createElement('button');
      rb.type = 'button'; rb.dataset.setting = 'refresh_now'; rb.textContent = lastUpdated();
      rn.appendChild(rb); lib.appendChild(rn);

      // SettingsActivity lists ACCOUNTS first.
      const acc = document.createElement('section');
      acc.innerHTML = '<h2>Accounts</h2>';
      el.insertBefore(acc, el.firstChild);
      const { page } = mountSection(root, 'settings', { onDown: () => nav.focusFirst(outer) });
      page.appendChild(outer);
      accountsUi = mountAccounts(acc);

      onClick = (e) => {
        const b = e.target;
        if (!b.dataset) return;
        const c = cycles.get(b.dataset.setting);
        if (c) {
          const opts = c.options;
          const next = opts[(opts.indexOf(c.get()) + 1) % opts.length];
          c.set(next); paint(b, c);
        } else if (b.dataset.setting === 'dark') {
          store.setDark(!store.dark()); b.textContent = onOff(store.dark());
          applyTheme(store.dark()); backdrop.retheme();
        } else if (b.dataset.setting === 'refresh_now') {
          refreshNow(b);
        } else if (b.dataset.filter) {
          const done = (text) => { if (b.isConnected) { b.textContent = text; b.focus(); } };
          if (b.dataset.filter === 'countries') filterSettings.countries(done);
          else filterSettings.hidden(done);
        } else if (b.dataset.open) {
          router.go(b.dataset.open);
        } else if (b.dataset.home) {
          store.setHomeShows(b.dataset.home, !store.homeShows(b.dataset.home));
          b.textContent = onOff(store.homeShows(b.dataset.home));
        }
      };
      onChange = (e) => {
        const t = TEXTS.find(([, d]) => d.key === e.target.dataset.setting);
        if (t) t[1].set(e.target.value);
      };
      el.addEventListener('click', onClick);
      el.addEventListener('change', onChange);
      el._cleanup = () => { el.removeEventListener('click', onClick); el.removeEventListener('change', onChange); };
      onActivate = (e) => { if (e.target.tagName === 'BUTTON') e.target.click(); };
      root.addEventListener('activate', onActivate);
      nav.register(root);
      if (!tabFocused()) nav.focusFirst(outer);
    },
    unmount() {
      if (root) {
        root.removeEventListener('activate', onActivate);
        const el = root.querySelector('.settings-col');
        if (el && el._cleanup) el._cleanup();
      }
      if (accountsUi) accountsUi.dispose();
      root = accountsUi = onActivate = onClick = onChange = null;
      cycles.clear();
    },
  };
}
