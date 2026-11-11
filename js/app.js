// YM Player entry point: view registry, router wiring, TV-remote key routing.
import { router } from './router.js';
import * as nav from './nav.js';
import * as store from './store.js';
import { loginView } from './views/login.js';
import { setupView } from './views/setup.js';
import { liveView } from './views/live.js';
import { playerLiveView } from './views/player-live.js';
import { moviesView } from './views/movies.js';
import { seriesView } from './views/series.js';
import { movieDetailView } from './views/movie-detail.js';
import { seriesDetailView } from './views/series-detail.js';
import { homeView } from './views/home.js';
import { playerVodView } from './views/player-vod.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';
import { ambientView } from './views/ambient.js';
import { phonelinkView } from './views/phonelink.js';

const SPLASH_MS = 600;

// Registry of views. Later tasks add entries here: name -> () => view.
export const views = {
  splash: () => {
    let h; let timer;
    return {
      mount(root) {
        h = document.createElement('h1');
        h.textContent = 'YM Player';
        root.appendChild(h);
        // Brief logo, then route on account state (deferred: router.go must not run inside mount).
        timer = setTimeout(() => router.go(store.hasAccount() ? 'home' : 'login'), SPLASH_MS);
      },
      unmount() { clearTimeout(timer); h = null; },
    };
  },
  login: loginView,
  setup: setupView,
  live: liveView,
  'player-live': playerLiveView,
  movies: moviesView,
  series: seriesView,
  'movie-detail': movieDetailView,
  'series-detail': seriesDetailView,
  'player-vod': playerVodView,
  home: homeView,
  search: searchView,
  settings: settingsView,
  ambient: ambientView,
  phonelink: phonelinkView,
};

// Returns a dispose function that removes the global listeners.
export function boot(rootEl) {
  router.init(rootEl);
  for (const [name, factory] of Object.entries(views)) router.register(name, factory);

  // Active view gets the key first; nav only sees it if the view declines.
  const onKeydown = (e) => {
    if (router.onKey(e)) return;
    nav.onKey(e);
  };
  const onBack = () => { router.back(); };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('back', onBack);

  router.go('splash');

  return () => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('back', onBack);
    router.reset();
  };
}
