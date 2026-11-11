// Ambient screensaver: slowly cycles Xtream artwork the app already has. No TMDB, no external fetch.
import * as store from '../store.js';
import * as api from '../api.js';
import { router } from '../router.js';

const DEFAULT_INTERVAL_MS = 8000;

/** De-duplicated poster/backdrop URLs from the user's favourites and VOD history (never live logos). */
export function collectArtwork() {
  const items = [
    ...store.history(false), ...store.favs('movie'), ...store.favs('series'),
  ];
  const urls = [];
  for (const i of items) {
    for (const u of [i.icon, i.parentIcon]) if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

// Nothing cached yet: borrow artwork from the provider's own VOD lists (Xtream only).
async function fallbackArtwork() {
  const urls = [];
  for (const type of ['movie', 'series']) {
    try {
      const list = await api.streams(type, null);
      for (const i of list) if (i.icon && !urls.includes(i.icon) && urls.length < 30) urls.push(i.icon);
    } catch { /* ignore: ambient just shows a blank screen */ }
  }
  return urls;
}

export function ambientView() {
  let timer = null; let el = null; let alive = false;
  return {
    async mount(root, params) {
      alive = true;
      el = document.createElement('div');
      el.className = 'ambient';
      const img = document.createElement('img');
      img.alt = '';
      el.appendChild(img);
      root.appendChild(el);
      let urls = collectArtwork();
      if (urls.length === 0) urls = await fallbackArtwork();
      if (!alive || urls.length === 0) return;
      let i = 0;
      const show = () => {
        img.classList.remove('ambient-in');
        img.setAttribute('src', urls[i % urls.length]);
        void img.offsetWidth; // restart the Ken-Burns/fade animation
        img.classList.add('ambient-in');
        i++;
      };
      show();
      if (urls.length > 1) timer = setInterval(show, (params && params.intervalMs) || DEFAULT_INTERVAL_MS);
    },
    unmount() {
      alive = false;
      clearInterval(timer); timer = null; el = null;
    },
    // Any key leaves the screensaver.
    onKey() { router.back(); return true; },
  };
}
