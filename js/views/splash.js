// Port of SplashActivity.java: "YOUSUF MIAH" builds in, folds away into its Y and M, which land in
// the logo as its tile springs up (a flash, the play button, a sweep of light), then "YM Player"
// and "Developed by Yousuf Miah" (js/ui/name-intro.js).
// Leaves after the later of 1400 ms and the library warm-up, but never later than 6000 ms, and
// replaces itself (it is not on the back stack). Back is ignored while it shows.
import * as store from '../store.js';
import * as repo from '../repo.js';
import { router } from '../router.js';
import * as backdrop from '../ui/backdrop.js';
import { playIntro, TOTAL_MS } from '../ui/name-intro.js';

export const SHOW_MS = TOTAL_MS + 300; // the whole intro, then on
export const MAX_WAIT_MS = 6000;

/**
 * Android goes Splash -> Login, and Login forwards to Home when signed in, or to Setup when the
 * library hasn't been saved yet (LoginActivity.java:52-60). Tizen decides here in one step.
 */
export function destination() {
  if (!store.hasAccount()) return 'login';
  return repo.hasLibrary() ? 'home' : 'setup';
}

/** @param opts.warmUp  () => Promise — loads the saved library while the logo shows (repo.warmUp). */
export function splashView(opts = {}) {
  return function create() {
    let t1 = null; let t2 = null; let left = false; let stopIntro = null; let shownLongEnough = false; let libraryReady = false;

    function next() {
      if (left) return;
      left = true;
      clearTimeout(t1); clearTimeout(t2);
      router.replace(destination());
    }

    return {
      mount(root) {
        backdrop.setSection('home');
        const el = document.createElement('div');
        el.className = 'splash';
        el.innerHTML = '<div class="splash-col"><div class="splash-logo" role="img" aria-label="YM Player">'
          + '<span class="sl-tile"><span class="sl-shine"></span></span><span class="sl-ring"></span>'
          + '<span class="sl-word"><span class="sl-y">Y</span><span class="sl-m">M</span></span><span class="sl-play"></span></div>'
          + '<div class="splash-name">YM Player</div><div class="splash-by">Developed by Yousuf Miah</div></div>';
        root.appendChild(el);
        void el.offsetWidth;
        el.classList.add('go');
        stopIntro = playIntro(el);

        if (store.hasAccount() && opts.warmUp) {
          Promise.resolve().then(opts.warmUp).catch(() => {}).then(() => {
            libraryReady = true;
            if (shownLongEnough) next();
          });
        } else {
          libraryReady = true;
        }
        t1 = setTimeout(() => { shownLongEnough = true; if (libraryReady) next(); }, SHOW_MS);
        t2 = setTimeout(next, MAX_WAIT_MS); // never keep you waiting long
      },
      onBack() { return true; }, // let the splash finish rather than closing the app halfway
      unmount() { left = true; clearTimeout(t1); clearTimeout(t2); if (stopIntro) stopIntro(); },
    };
  };
}
