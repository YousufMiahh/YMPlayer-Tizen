// Minimal stack router. One view is mounted in the root at a time.
// Back at depth 1 emits an `exit` CustomEvent on the root (and calls onExit).
import { isView } from './view.js';

export function createRouter() {
  const factories = new Map();
  const stack = []; // { name, params, view }
  let root = null;
  let onExit = null;

  function mountEntry(entry) {
    entry.view = factories.get(entry.name)();
    if (!isView(entry.view)) throw new Error(`View "${entry.name}" does not implement mount/unmount`);
    entry.view.mount(root, entry.params);
  }

  function unmountTop() {
    const top = stack[stack.length - 1];
    if (!top || !top.view) return;
    try { top.view.unmount(); } finally {
      top.view = null;
      root.replaceChildren();
    }
  }

  return {
    init(rootEl, opts = {}) {
      this.reset();
      root = rootEl;
      onExit = opts.onExit || null;
    },
    // Unmount the active view and empty the stack (used on re-init / dispose).
    reset() {
      if (root) unmountTop();
      stack.length = 0;
    },
    register(name, viewFactory) {
      factories.set(name, viewFactory);
    },
    go(name, params) {
      if (!root) throw new Error('router.init(root) not called');
      if (!factories.has(name)) throw new Error(`Unknown view "${name}"`);
      unmountTop();
      const entry = { name, params, view: null };
      stack.push(entry);
      mountEntry(entry);
    },
    back() {
      if (stack.length <= 1) {
        if (onExit) onExit();
        if (root) root.dispatchEvent(new CustomEvent('exit', { bubbles: true }));
        return false;
      }
      unmountTop();
      stack.pop();
      mountEntry(stack[stack.length - 1]);
      return true;
    },
    stackDepth: () => stack.length,
    current() {
      const top = stack[stack.length - 1];
      return top ? { name: top.name, params: top.params, view: top.view } : null;
    },
    // Offer a key to the active view; true means it consumed the key.
    onKey(e) {
      const top = stack[stack.length - 1];
      return !!(top && top.view && typeof top.view.onKey === 'function' && top.view.onKey(e) === true);
    },
  };
}

export const router = createRouter();
