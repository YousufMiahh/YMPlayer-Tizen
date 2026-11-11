// Settings: playback, subtitles, Customise Home, theme, accounts. Every control writes straight to the store.
import * as store from '../store.js';
import * as nav from '../nav.js';
import { mountAccounts } from './setup.js';

const COLORS = ['White', 'Yellow', 'Green', 'Cyan', 'Blue', 'Red'];
const SIZES = ['Small', 'Medium', 'Large'];
const OPACITY = ['25%', '50%', '75%', '100%'];
const PREVIEW = ['Off', 'Muted', 'With sound'];
const REFRESH = [[-1, 'Manual'], [0, 'Every launch'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Every 24 hours']];
const onOff = (b) => (b ? 'On' : 'Off');

// Cycle controls: key -> { title, get, set, options (values), text(value) }.
const CYCLES = [
  ['Playback', [
    { key: 'live_format', title: 'Live stream format', get: store.liveFormat, set: store.setLiveFormat,
      options: ['ts', 'm3u8'], text: (v) => (v === 'ts' ? 'TS' : 'HLS') },
    { key: 'preview', title: 'Preview mode', get: store.previewMode, set: store.setPreviewMode,
      options: [0, 1, 2], text: (v) => PREVIEW[v] },
    { key: 'refresh', title: 'Auto-refresh library', get: store.refreshHours, set: store.setRefreshHours,
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
      const el = document.createElement('div');
      el.className = 'settings';
      el.innerHTML = '<h1>Settings</h1>';
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

      const home = section(el, 'Customise Home');
      for (const k of store.HOME_KEYS) {
        const r = row(store.HOME_NAMES[k]);
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.home = k; b.textContent = onOff(store.homeShows(k));
        r.appendChild(b); home.appendChild(r);
      }

      const theme = section(el, 'Theme');
      const tr = row('Dark theme');
      const tb = document.createElement('button');
      tb.type = 'button'; tb.dataset.setting = 'dark'; tb.textContent = onOff(store.dark());
      tr.appendChild(tb); theme.appendChild(tr);

      const acc = section(el, 'Accounts');
      const host = document.createElement('div');
      acc.appendChild(host);
      root.appendChild(el);
      accountsUi = mountAccounts(host, root);

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
      nav.focusFirst(root);
    },
    unmount() {
      if (root) {
        root.removeEventListener('activate', onActivate);
        const el = root.querySelector('.settings');
        if (el && el._cleanup) el._cleanup();
      }
      if (accountsUi) accountsUi.dispose();
      root = accountsUi = onActivate = onClick = onChange = null;
      cycles.clear();
    },
  };
}
