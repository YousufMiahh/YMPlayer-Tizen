// Minimal stack router. One view is mounted in the root at a time.
// Back at depth 1 emits an `exit` CustomEvent on the root (and calls onExit; the app exits there).
import { isView } from './view.js';

export function createRouter() {
  const factories = new Map();
  const stack = []; // { name, params, view }
  let root = null;
  let onExit = null;

  function createView(name) {
    const view = factories.get(name)();
    if (!isView(view)) throw new Error(`View "${name}" does not implement mount/unmount`);
    return view;
  }

  function mountEntry(entry) {
    const view = createView(entry.name);
    try {
      view.mount(root, entry.params);
    } catch (err) {
      try { view.unmount(); } catch { /* best-effort cleanup of a half-mounted view */ }
      root.replaceChildren();
      throw err;
    }
    entry.view = view;
  }

  // A throwing unmount must never block navigation: log it, always clear the view and root.
  function unmountTop() {
    const top = stack[stack.length - 1];
    if (!top || !top.view) return;
    const view = top.view;
    top.view = null;
    try { view.unmount(); } catch (err) { console.error(`View "${top.name}" unmount failed`, err); }
    root.replaceChildren();
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
      const entry = { name, params, view: null };
      const prev = stack[stack.length - 1];
      unmountTop();
      try {
        mountEntry(entry);
      } catch (err) {
        // New view failed: stack is unchanged; best-effort restore of the previous view.
        if (prev) { try { mountEntry(prev); } catch { /* leave root empty */ } }
        throw err;
      }
      stack.push(entry);
    },
    // Swap the top entry for a new view (the old one leaves the back stack, like finish()+start).
    replace(name, params) {
      if (!root) throw new Error('router.init(root) not called');
      if (!factories.has(name)) throw new Error(`Unknown view "${name}"`);
      const prev = stack[stack.length - 1];
      const entry = { name, params, view: null };
      unmountTop();
      try {
        mountEntry(entry);
      } catch (err) {
        if (prev) { try { mountEntry(prev); } catch { /* leave root empty */ } }
        throw err;
      }
      if (prev) stack.pop();
      stack.push(entry);
    },
    // Pop back to the nearest entry called `name` and remount it; if there is none, the whole
    // stack is replaced by a fresh `name` (Home is always at the bottom).
    backTo(name, params) {
      let i = stack.length - 1;
      while (i >= 0 && stack[i].name !== name) i--;
      if (i < 0) { this.resetTo(name, params); return; }
      if (i === stack.length - 1) return;
      unmountTop();
      stack.length = i + 1;
      mountEntry(stack[i]);
    },
    // Clear the stack and start again at `name` (e.g. after logging in).
    resetTo(name, params) {
      if (!root) throw new Error('router.init(root) not called');
      if (!factories.has(name)) throw new Error(`Unknown view "${name}"`);
      unmountTop();
      stack.length = 0;
      const entry = { name, params, view: null };
      mountEntry(entry);
      stack.push(entry);
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
