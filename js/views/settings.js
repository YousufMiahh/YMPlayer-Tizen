// Settings (SettingsActivity.java): a tvOS-style grouped list, 900u wide and centred under the
// top bar, in one ScrollView with the bar. Each row is the whole pill: label on the left, value
// on the right; OK runs the row (most values cycle in place). Info rows are not focusable.
//
//   ACCOUNTS                  {account} ✓ In use / Switch · Subscription · Add Account ·
//                             Edit This Account · Remove This Account (confirm)
//   APPEARANCE                Theme (Dark / Light, restarts Home) · Live TV Preview
//   HIDE WHAT YOU DON'T WATCH Countries & Languages · Rename Categories · Hidden Categories
//   CUSTOMISE HOME SCREEN     the ten Home rows, On / Off
//   SUBTITLES                 Size · Colour · Background · Background Opacity · sample frame
//   PLAYBACK                  Live Stream Format · Fix Frozen Video Automatically · User Agent
//   LIBRARY                   Refresh Automatically · Refresh Now · Clear Watch History · Show Tutorial
//   ABOUT                     Version · What's New, then "Developed by Yousuf Miah"
//
// Android rows left out on purpose: Video Player, Last Error Report and Remembered Player Choices
// (one engine, AVPlay), and Check for Updates (no APK updates on a TV). The player's Audio Sync
// can't work on AVPlay either.
import * as store from '../store.js';
import * as nav from '../nav.js';
import * as repo from '../repo.js';
import * as api from '../api.js';
import * as coach from '../ui/coach.js';
import * as filterSettings from '../filter-settings.js';
import { mountAccounts, restartHome } from '../accounts-ui.js';
import { mountSection, tabFocused } from '../ui/topbar.js';
import { applyTheme, u } from '../ui/theme.js';
import * as backdrop from '../ui/backdrop.js';
import { showDialog, isOpen as dialogOpen } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { sectionHeading, settingsRow } from '../ui/widgets.js';
import { bringIntoView, scrollBy } from '../ui/scroll.js';
import { appVersion } from '../version.js';
import * as whatsNew from '../whats-new.js';
import {
  SUB_COLOR_NAMES, SUB_COLORS, SUB_SIZE_NAMES, SUB_OPACITY_NAMES, SUB_OPACITY_ALPHA,
} from '../ui/subtitles.js';

export const PREVIEW = ['Off', 'On (muted)', 'On with sound'];
export const REFRESH_HOURS = [12, 24, 6, 0, -1];
export const SAMPLE_TEXT = 'This is how your subtitles will look.';
export const SAMPLE_SIZES = [19, 23, 28, 34];
export const UA_MESSAGE = 'Some providers only allow certain apps. Try IPTVSmartersPlayer or VLC/3.0.20 if streams fail.';
export const CREDIT = 'Developed by Yousuf Miah';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const onOff = (b) => (b ? 'On' : 'Off');

/** SettingsActivity.refreshLabel. */
export function refreshLabel(h) {
  if (h < 0) return 'Only when I ask';
  if (h === 0) return 'Every time the app opens';
  if (h === 24) return 'Once a day';
  return `Every ${h} hours`;
}

/** SettingsActivity.lastUpdated(). */
export function lastUpdated(t = store.lastRefresh(), now = new Date()) {
  if (!t) return 'Not yet';
  const d = new Date(t);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `Updated today at ${hm}`;
  return `Updated ${d.getDate()} ${MONTHS[d.getMonth()]}, ${hm}`;
}

const liveLabel = () => (store.liveFormat() === 'ts' ? 'MPEG-TS' : 'HLS');

/** SettingsActivity.refreshNow. */
export function refreshNow(v) {
  if (repo.isRefreshing()) return Promise.resolve();
  v.textContent = 'Updating…';
  return repo.refreshAll().then(
    () => { v.textContent = lastUpdated(); },
    (e) => { v.textContent = `Failed — ${api.errorMessage(e)}`; },
  );
}

/** SettingsActivity.loadStatus: the Subscription row's text. */
export async function subscriptionText() {
  try {
    return api.describeAccount(await api.login()).replace('Status: ', '');
  } catch (e) {
    return `Offline — ${api.errorMessage(e)}`;
  }
}

/** SettingsActivity.editUserAgent: Save / Default / Cancel. Resolves the saved agent, or null. */
export async function editUserAgent() {
  const d = showDialog({
    title: 'User Agent', message: UA_MESSAGE, input: { value: store.userAgent() },
    neutral: 'Default', negative: 'Cancel', positive: 'Save',
  });
  const v = await d.result;
  if (v === 'positive') store.setUserAgent(d.value().trim());
  else if (v === 'neutral') store.setUserAgent(store.DEFAULT_UA);
  else return null;
  return store.userAgent();
}

/** The sample frame's text style for the current subtitle settings (SettingsActivity.updateSample). */
export function sampleStyle() {
  const bg = store.subtitleBackground();
  return {
    fontSize: `${u(SAMPLE_SIZES[store.subtitleSize()] ?? SAMPLE_SIZES[1])}px`,
    color: SUB_COLORS[store.subtitleColor()],
    background: bg ? `rgba(0, 0, 0, ${(SUB_OPACITY_ALPHA[store.subtitleOpacity()] / 255).toFixed(3)})` : 'transparent',
    textShadow: bg ? 'none' : `0 ${u(1)}px ${u(4)}px rgba(0, 0, 0, 0.9)`,
  };
}

/** Cycle to the next of `list` after `cur` (the first when cur isn't in it). */
const next = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

export function settingsView() {
  let root; let st; let screen; let list; let accountsUi; let sample; const off = [];
  const listen = (el, ev, fn) => { el.addEventListener(ev, fn); off.push(() => el.removeEventListener(ev, fn)); };
  const actions = new Map(); // row element -> (valueEl) => void

  function section(name) { list.appendChild(sectionHeading(name)); }

  /** SettingsActivity.row: an action makes it a focusable pill; without one it is an info row. */
  function row(key, label, value, action = null) {
    const r = settingsRow(label, value, !!action);
    r.dataset.key = key;
    if (action) actions.set(r, action);
    list.appendChild(r);
    return r.querySelector('.srow-value');
  }

  function updateSample() {
    if (!sample) return;
    Object.assign(sample.style, sampleStyle());
  }

  function addSample() {
    const frame = document.createElement('div');
    frame.className = 'srow-sample';
    sample = document.createElement('span');
    sample.textContent = SAMPLE_TEXT;
    frame.appendChild(sample);
    list.appendChild(frame);
    updateSample();
  }

  function build() {
    const accounts = document.createElement('div');
    accounts.className = 'settings-accounts';
    section('Accounts');
    list.appendChild(accounts);
    accountsUi = mountAccounts(accounts, (label, value, action, key) => {
      const r = settingsRow(label, value, !!action);
      r.dataset.key = key;
      if (action) actions.set(r, action);
      return r;
    });
    const status = accountsUi.statusValue;
    if (status) subscriptionText().then((t) => { if (status.isConnected) status.textContent = t; });

    section('Appearance');
    row('theme', 'Theme', store.dark() ? 'Dark' : 'Light', () => {
      store.setDark(!store.dark());
      applyTheme(store.dark()); backdrop.retheme();
      restartHome();
    });
    row('preview', 'Live TV Preview', PREVIEW[store.previewMode()] ?? PREVIEW[2], (v) => {
      store.setPreviewMode((store.previewMode() + 1) % PREVIEW.length);
      v.textContent = PREVIEW[store.previewMode()];
    });

    section(filterSettings.SECTION);
    row('countries', filterSettings.COUNTRIES, filterSettings.countriesLabel(), (v, r) => {
      filterSettings.countries((t) => { if (v.isConnected) { v.textContent = t; r.focus({ preventScroll: true }); } });
    });
    row('rename', filterSettings.RENAME, filterSettings.RENAME_VALUE, (v, r) => {
      filterSettings.rename().then(() => { if (r.isConnected) r.focus({ preventScroll: true }); });
    });
    row('hidden', filterSettings.HIDDEN, filterSettings.hiddenLabel(), (v, r) => {
      filterSettings.hidden((t) => { if (v.isConnected) { v.textContent = t; r.focus({ preventScroll: true }); } });
    });

    section('Customise Home Screen');
    for (const k of store.HOME_KEYS) {
      row(`home_${k}`, store.HOME_NAMES[k], onOff(store.homeShows(k)), (v) => {
        store.setHomeShows(k, !store.homeShows(k));
        v.textContent = onOff(store.homeShows(k));
      });
    }

    section('Subtitles');
    row('sub_size', 'Size', SUB_SIZE_NAMES[store.subtitleSize()], (v) => {
      store.setSubtitleSize((store.subtitleSize() + 1) % SUB_SIZE_NAMES.length);
      v.textContent = SUB_SIZE_NAMES[store.subtitleSize()];
      updateSample();
    });
    row('sub_color', 'Colour', SUB_COLOR_NAMES[store.subtitleColor()], (v) => {
      store.setSubtitleColor((store.subtitleColor() + 1) % SUB_COLORS.length);
      v.textContent = SUB_COLOR_NAMES[store.subtitleColor()];
      updateSample();
    });
    row('sub_bg', 'Background', onOff(store.subtitleBackground()), (v) => {
      store.setSubtitleBackground(!store.subtitleBackground());
      v.textContent = onOff(store.subtitleBackground());
      updateSample();
    });
    row('sub_opacity', 'Background Opacity', SUB_OPACITY_NAMES[store.subtitleOpacity()], (v) => {
      store.setSubtitleOpacity((store.subtitleOpacity() + 1) % SUB_OPACITY_ALPHA.length);
      v.textContent = SUB_OPACITY_NAMES[store.subtitleOpacity()];
      if (!store.subtitleBackground()) toast('Turn Background on to see this');
      updateSample();
    });
    addSample();

    section('Playback');
    row('live_format', 'Live Stream Format', liveLabel(), (v) => {
      store.setLiveFormat(store.liveFormat() === 'ts' ? 'm3u8' : 'ts');
      v.textContent = liveLabel();
    });
    row('auto_recover', 'Fix Frozen Video Automatically', onOff(store.autoRecover()), (v) => {
      store.setAutoRecover(!store.autoRecover());
      v.textContent = onOff(store.autoRecover());
    });
    row('user_agent', 'User Agent', store.userAgent(), (v) => {
      editUserAgent().then((ua) => { if (ua !== null && v.isConnected) v.textContent = ua; });
    });

    section('Library');
    row('refresh', 'Refresh Automatically', refreshLabel(store.refreshHours()), (v) => {
      store.setRefreshHours(next(REFRESH_HOURS, store.refreshHours()));
      v.textContent = refreshLabel(store.refreshHours());
    });
    row('refresh_now', 'Refresh Now', lastUpdated(), (v) => { refreshNow(v); });
    row('clear_history', 'Clear Watch History', '', () => {
      store.clearHistory();
      toast('Watch history cleared');
    });
    row('tutorial', 'Show Tutorial', 'Quick tour of the basics', () => {
      coach.restart();
      restartHome();
    });

    section('About');
    row('version', 'Version', `YM Player ${appVersion()}`);
    row('whats_new', "What's New", 'What changed in this version', () => { whatsNew.show(); });
    const credit = document.createElement('p');
    credit.className = 'settings-credit';
    credit.textContent = CREDIT;
    list.appendChild(credit);
  }

  const firstRow = () => list.querySelector('.srow:not(.info)');

  function reveal(el) {
    if (screen && el) bringIntoView(el, screen, true, true);
  }

  return {
    mount(rootEl, params) {
      root = rootEl;
      st = params && typeof params === 'object' ? params : {};
      const sec = mountSection(root, 'settings', { onDown: () => { const f = firstRow(); if (f) { f.focus({ preventScroll: true }); reveal(f); } } });
      screen = sec.el;
      screen.dataset.ownScroll = '';
      const outer = document.createElement('div');
      outer.className = 'settings';
      list = document.createElement('div');
      list.className = 'settings-col';
      outer.appendChild(list);
      sec.page.appendChild(outer);
      build();

      listen(list, 'click', (e) => {
        const r = e.target.closest && e.target.closest('.srow');
        const a = r && actions.get(r);
        if (a) a(r.querySelector('.srow-value'), r);
      });
      // A dialog opened from a row: the row keeps its focused look beneath it, as the Android
      // view stays focused under the dialog window.
      listen(list, 'focusout', (e) => {
        if (dialogOpen() && e.target.classList && e.target.classList.contains('srow')) e.target.classList.add('keep-focus');
      });
      listen(list, 'focusin', () => { for (const k of list.querySelectorAll('.keep-focus')) k.classList.remove('keep-focus'); });
      listen(root, 'activate', (e) => { const r = e.target.closest && e.target.closest('.srow'); if (r && actions.has(r)) r.click(); });
      listen(screen, 'focusin', (e) => reveal(e.target));
      nav.register(root);

      if (tabFocused()) return;
      const back = st.focusKey && [...list.querySelectorAll('.srow:not(.info)')].find((r) => r.dataset.key === st.focusKey);
      if (back) {
        screen.scrollTop = st.scrollTop || 0;
        back.focus({ preventScroll: true });
        reveal(back);
      } else {
        const f = firstRow();
        if (f) f.focus({ preventScroll: true });
      }
    },
    onKey(e) {
      // ScrollView.arrowScroll: ▼ on the last row with nothing further to focus scrolls on (up to
      // half the screen), which is how Version and the credit come into view.
      if (e.keyCode !== 40 || !screen) return false;
      const rows = [...list.querySelectorAll('.srow:not(.info)')];
      if (!rows.length || document.activeElement !== rows[rows.length - 1]) return false;
      const left = screen.scrollHeight - screen.clientHeight - screen.scrollTop;
      if (left > 0) scrollBy(screen, 'scrollTop', Math.min(left, screen.clientHeight / 2));
      e.preventDefault();
      return true;
    },
    unmount() {
      if (st && screen) {
        const f = document.activeElement;
        st.focusKey = f && f.classList && f.classList.contains('srow') && list.contains(f) ? f.dataset.key : null;
        st.scrollTop = screen.scrollTop;
      }
      off.forEach((fn) => fn()); off.length = 0;
      if (accountsUi) accountsUi.dispose();
      actions.clear();
      root = screen = list = sample = accountsUi = null;
    },
  };
}
