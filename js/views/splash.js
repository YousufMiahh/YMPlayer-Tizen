// Port of SplashActivity.java: logo, "YM Player", "Developed by Yousuf Miah" with staged animations.
// Leaves after the later of 1400 ms and the library warm-up, but never later than 6000 ms, and
// replaces itself (it is not on the back stack). Back is ignored while it shows.
import * as store from '../store.js';
import { router } from '../router.js';
import * as backdrop from '../ui/backdrop.js';

export const SHOW_MS = 1400;
export const MAX_WAIT_MS = 6000;

/**
 * Android goes Splash -> Login, and Login forwards to Home when signed in, or to Setup when the
 * library hasn't been saved yet. Tizen has no saved library tier yet (audit A 5.1), so a signed-in
 * user goes straight to Home.
 */
export function destination() {
  return store.hasAccount() ? 'home' : 'login';
}

/** @param opts.warmUp  () => Promise — loads the saved library while the logo shows (none yet). */
export function splashView(opts = {}) {
  return function create() {
    let t1 = null; let t2 = null; let left = false; let shownLongEnough = false; let libraryReady = false;

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
        el.innerHTML = '<div class="splash-col"><img class="splash-logo" src="assets/logo.png" alt="">'
          + '<div class="splash-name">YM Player</div><div class="splash-by">Developed by Yousuf Miah</div></div>';
        root.appendChild(el);
        void el.offsetWidth;
        el.classList.add('go');

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
      unmount() { left = true; clearTimeout(t1); clearTimeout(t2); },
    };
  };
}
