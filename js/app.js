// YM Player entry point: view registry, router wiring, TV-remote key routing.
import { router } from './router.js';
import * as nav from './nav.js';
import * as store from './store.js';
import { applyTheme } from './ui/theme.js';
import * as backdrop from './ui/backdrop.js';
import { isSection, prepareBack } from './ui/topbar.js';
import { splashView } from './views/splash.js';
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

// Registry of views: name -> () => view.
export const views = {
  splash: splashView(),
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

/** Back with nothing beneath (Home, or the first Login): close the app like Android's finish(). */
export function exitApp() {
  const t = globalThis.tizen;
  try {
    if (t && t.application && typeof t.application.getCurrentApplication === 'function') {
      t.application.getCurrentApplication().exit();
    }
  } catch (err) {
    console.error('exit failed', err);
  }
}

// Returns a dispose function that removes the global listeners.
export function boot(rootEl) {
  applyTheme(store.dark());
  if (globalThis.document && document.body) backdrop.install(document.body);
  router.init(rootEl, { onExit: exitApp });
  for (const [name, factory] of Object.entries(views)) router.register(name, factory);

  // Active view gets the key first; nav only sees it if the view declines.
  const onKeydown = (e) => {
    if (router.onKey(e)) return;
    nav.onKey(e);
  };
  const onBack = () => {
    const cur = router.current();
    if (cur && cur.view && typeof cur.view.onBack === 'function' && cur.view.onBack() === true) return;
    // Back from a section returns to Home with the tab slide (TopBar.back).
    if (cur && isSection(cur.name) && cur.name !== 'home') prepareBack();
    router.back();
  };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('back', onBack);

  router.go('splash');

  return () => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('back', onBack);
    router.reset();
  };
}
