// YM Player entry point: view registry, router wiring, TV-remote key routing.
import { router } from './router.js';
import * as nav from './nav.js';
import * as store from './store.js';
import * as repo from './repo.js';
import { restoreTvMute } from './live-preview.js';
import * as whatsNew from './whats-new.js';
import * as sync from './sync.js';
import { applyTheme } from './ui/theme.js';
import * as backdrop from './ui/backdrop.js';
import { isSection, prepareBack } from './ui/topbar.js';
import { splashView } from './views/splash.js';
import { loginView } from './views/login.js';
import { setupView } from './views/setup.js';
import { liveView } from './views/live.js';
import { playerView } from './views/player.js';
import { moviesView } from './views/movies.js';
import { seriesView } from './views/series.js';
import { movieDetailView } from './views/movie-detail.js';
import { seriesDetailView } from './views/series-detail.js';
import { trailerView } from './views/trailer.js';
import { homeView } from './views/home.js';
import { searchView } from './views/search.js';
import { settingsView } from './views/settings.js';

// Registry of views: name -> () => view.
export const views = {
  splash: splashView({ warmUp: repo.warmUp }),
  login: loginView,
  setup: setupView,
  live: liveView,
  'player-live': playerView,
  movies: moviesView,
  series: seriesView,
  'movie-detail': movieDetailView,
  'series-detail': seriesDetailView,
  trailer: trailerView,
  'player-vod': playerView,
  home: homeView,
  search: searchView,
  settings: settingsView,
};

/** Back with nothing beneath (Home, or the first Login): close the app like Android's finish(). */
export function exitApp() {
  const t = globalThis.tizen;
  restoreTvMute(); // a muted preview must not outlive the app
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
  whatsNew.init(); // a fresh install never gets the "What's New" pop-up
  sync.start(); // watch data shared with your other devices
  restoreTvMute(); // the app died last time with the TV muted for a preview: give the sound back
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
  // Hidden (Home key, another source) or closing: the TV gets its sound back whatever the screen
  // was doing. (The Live TV screen restarts its preview, and mutes again, when the app returns.)
  const onHidden = () => { if (document.hidden) restoreTvMute(); };
  const onLeave = () => { restoreTvMute(); };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('back', onBack);
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);

  router.go('splash');

  return () => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('back', onBack);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', onLeave);
    window.removeEventListener('beforeunload', onLeave);
    router.reset();
  };
}
