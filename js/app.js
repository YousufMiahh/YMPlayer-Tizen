// YM Player entry point: view registry, router wiring, TV-remote key routing.
import { router } from './router.js';
import * as nav from './nav.js';

// Registry of views. Later tasks add entries here: name -> () => view.
export const views = {
  splash: () => {
    let h;
    return {
      mount(root) {
        h = document.createElement('h1');
        h.textContent = 'YM Player';
        root.appendChild(h);
      },
      unmount() { h = null; },
    };
  },
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
