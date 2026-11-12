// Port of SetupActivity.java: "Getting everything ready". Downloads Live TV, Movies and Series
// once, right after a playlist is added (or on launch when nothing is saved yet). From then on
// every screen opens from the copy saved on the TV and updates happen quietly in the background.
import * as repo from '../repo.js';
import * as api from '../api.js';
import * as nav from '../nav.js';
import { router } from '../router.js';
import * as backdrop from '../ui/backdrop.js';
import { pillButton } from '../ui/widgets.js';
import { LIVE, MOVIE, SERIES } from '../item.js';

export const TYPES = [LIVE, MOVIE, SERIES];
export const NAMES = ['Live TV', 'Movies', 'Series'];
export const UNITS = ['channels', 'movies', 'series'];
export const TICK_MS = 300;
export const DONE_MS = 700;
export const GREEN = '#34C759';

const fmt = new Intl.NumberFormat('en-GB');
export const count = (n) => fmt.format(n);
const index = (type) => Math.max(0, TYPES.indexOf(type));

export function setupView() {
  let root = null; let el; let status; let actions; let ticker = null; let doneTimer = null;
  const rows = [];
  const running = [false, false, false];
  const done = [false, false, false];
  let failedTypes = [];

  function setCount(i, text, cls) {
    rows[i].count.textContent = text;
    rows[i].count.className = `setup-count ${cls}`;
  }

  function goHome() {
    if (!root) return;
    router.resetTo('home'); // FLAG_ACTIVITY_CLEAR_TASK
  }

  function tick() {
    for (let i = 0; i < 3; i++) {
      if (!running[i]) continue;
      const n = repo.progress(TYPES[i]);
      rows[i].count.textContent = n === 0 ? 'Waiting for your provider…' : `${count(n)} ${UNITS[i]} so far…`;
    }
  }

  function offerContinue() {
    actions.replaceChildren();
    const go = pillButton('Start Watching — Movies & Series will finish in the background', { action: 'continue' });
    actions.appendChild(go);
    go.focus();
  }

  function offerRetry() {
    actions.replaceChildren();
    const retryTypes = [...failedTypes];
    const retry = pillButton('Try Again', { action: 'retry' });
    retry.addEventListener('click', () => start(retryTypes));
    const skip = pillButton('Continue Anyway', { action: 'skip' });
    actions.append(retry, skip);
    retry.focus();
  }

  const listener = {
    started(type) {
      if (!root) return;
      const i = index(type);
      running[i] = true;
      rows[i].spin.hidden = false;
      rows[i].mark.textContent = '';
      setCount(i, 'Waiting for your provider…', 'c-text2');
    },
    finished(type, n, e) {
      if (!root) return;
      const i = index(type);
      running[i] = false;
      rows[i].spin.hidden = true;
      if (e) {
        rows[i].mark.textContent = '✕';
        rows[i].mark.style.color = 'var(--red)';
        rows[i].count.textContent = "Didn't load";
        failedTypes.push(type);
        status.textContent = `Couldn't download ${NAMES[i]}: ${api.errorMessage(e)}`;
        return;
      }
      done[i] = true;
      rows[i].mark.textContent = '✓';
      rows[i].mark.style.color = GREEN;
      rows[i].count.textContent = `${count(n)} ${UNITS[i]}`;
      if (type === LIVE && (running[1] || running[2] || !done[1] || !done[2])) offerContinue();
    },
    allDone(ok) {
      if (!root) return;
      if (ok) {
        actions.replaceChildren();
        status.textContent = 'All set';
        status.classList.add('c-text');
        doneTimer = setTimeout(goHome, DONE_MS);
      } else {
        offerRetry();
      }
    },
  };

  function start(types) {
    failedTypes = [];
    actions.replaceChildren();
    status.textContent = '';
    status.classList.remove('c-text');
    for (const t of types) {
      const i = index(t);
      rows[i].mark.textContent = '';
      setCount(i, 'Waiting', 'c-text3');
    }
    return repo.startSetup(types);
  }

  function row(i) {
    const r = document.createElement('div');
    r.className = 'setup-row';
    r.dataset.type = TYPES[i];
    r.innerHTML = '<span class="setup-icon"><span class="setup-spin" hidden></span><span class="setup-mark"></span></span>'
      + '<span class="setup-name"></span><span class="setup-count c-text3">Waiting</span>';
    r.querySelector('.setup-name').textContent = NAMES[i];
    rows[i] = {
      el: r, spin: r.querySelector('.setup-spin'), mark: r.querySelector('.setup-mark'), count: r.querySelector('.setup-count'),
    };
    return r;
  }

  let onClick; let onActivate;

  return {
    mount(rootEl, params = {}) {
      root = rootEl;
      backdrop.setSection('home'); // Ambient.install(this, Ambient.HOME)
      el = document.createElement('div');
      el.className = 'setup';
      el.innerHTML = '<div class="setup-col"><img class="setup-logo" src="assets/logo.png" alt="">'
        + '<div class="setup-title">Getting everything ready</div>'
        + '<div class="setup-sub">This only happens when you add a playlist. After this, everything opens instantly.</div>'
        + '<div class="setup-list"></div><div class="setup-status"></div><div class="setup-actions"></div></div>';
      const list = el.querySelector('.setup-list');
      for (let i = 0; i < 3; i++) list.appendChild(row(i));
      status = el.querySelector('.setup-status');
      actions = el.querySelector('.setup-actions');
      root.appendChild(el);

      onClick = (e) => {
        const b = e.target.closest && e.target.closest('[data-action]');
        if (b && (b.dataset.action === 'continue' || b.dataset.action === 'skip')) goHome();
      };
      onActivate = (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.click(); };
      el.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      nav.register(root);

      repo.setSetupListener(listener);
      ticker = setInterval(tick, TICK_MS);
      start(params.types || TYPES);
    },
    onBack() { return true; }, // keep going: the download is needed for the app to be fast
    unmount() {
      repo.setSetupListener(null); // downloads carry on in the background
      clearInterval(ticker); clearTimeout(doneTimer);
      if (el) el.removeEventListener('click', onClick);
      if (root) root.removeEventListener('activate', onActivate);
      root = el = status = actions = null;
    },
  };
}
