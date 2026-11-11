// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRouter, router } from '../js/router.js';
import { boot, views } from '../js/app.js';

function dummy(label, extra = {}) {
  const calls = [];
  const factory = () => ({
    mount: vi.fn((root, params) => {
      calls.push(['mount', label]);
      root.innerHTML = `<p id="${label}">${label}</p>`;
      factory.params = params;
    }),
    unmount: vi.fn(() => { calls.push(['unmount', label]); }),
    ...extra,
  });
  factory.calls = calls;
  return factory;
}

// Mounts via appendChild so only the router's own cleanup can empty the root.
function appender(label) {
  return () => ({
    mount(r) { const p = document.createElement('p'); p.id = label; r.appendChild(p); },
    unmount() {},
  });
}

let root;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
});
afterEach(() => { router.reset(); });

describe('router', () => {
  it('go mounts the view with params and swaps root content', () => {
    const r = createRouter(); r.init(root);
    const a = dummy('a');
    r.register('a', a);
    r.go('a', { x: 1 });
    expect(root.querySelector('#a')).not.toBeNull();
    expect(a.params).toEqual({ x: 1 });
    expect(r.stackDepth()).toBe(1);
    expect(r.current().name).toBe('a');
  });

  it('go unmounts the previous view and clears its content', () => {
    const r = createRouter(); r.init(root);
    const a = dummy('a'), b = dummy('b');
    const order = [];
    r.register('a', () => { const v = a(); const u = v.unmount; v.unmount = vi.fn(() => { order.push('ua'); u(); }); return v; });
    r.register('b', () => { const v = b(); const m = v.mount; v.mount = vi.fn((...x) => { order.push('mb'); m(...x); }); return v; });
    r.go('a');
    r.go('b');
    expect(order).toEqual(['ua', 'mb']);
    expect(root.querySelector('#a')).toBeNull();
    expect(root.querySelector('#b')).not.toBeNull();
    expect(root.children.length).toBe(1);
    expect(r.stackDepth()).toBe(2);
  });

  it('back pops and remounts the view beneath with its original params', () => {
    const r = createRouter(); r.init(root);
    const a = dummy('a'), b = dummy('b');
    r.register('a', a); r.register('b', b);
    r.go('a', { id: 7 });
    r.go('b');
    expect(r.back()).toBe(true);
    expect(r.stackDepth()).toBe(1);
    expect(r.current().name).toBe('a');
    expect(a.params).toEqual({ id: 7 });
    expect(root.querySelector('#b')).toBeNull();
    expect(root.querySelector('#a')).not.toBeNull();
    expect(a.calls.filter((c) => c[0] === 'mount').length).toBe(2);
    expect(b.calls).toEqual([['mount', 'b'], ['unmount', 'b']]);
  });

  it('router (not the view) empties root on go, back and reset', () => {
    const r = createRouter(); r.init(root);
    r.register('a', appender('a')); r.register('b', appender('b'));
    r.go('a');
    r.go('b');
    expect([...root.children].map((c) => c.id)).toEqual(['b']);
    r.back();
    expect([...root.children].map((c) => c.id)).toEqual(['a']);
    r.reset();
    expect(root.children.length).toBe(0);
    expect(r.stackDepth()).toBe(0);
  });

  it('dispose empties the root', () => {
    views.t1 = appender('t1');
    const d = boot(root);
    router.go('t1');
    d();
    delete views.t1;
    expect(root.children.length).toBe(0);
  });

  it('unmount contract: a document listener added in mount stops firing after navigating away', () => {
    const r = createRouter(); r.init(root);
    const spy = vi.fn();
    r.register('a', () => ({
      mount() { document.addEventListener('ping', spy); },
      unmount() { document.removeEventListener('ping', spy); },
    }));
    r.register('b', dummy('b'));
    r.go('a');
    document.dispatchEvent(new Event('ping'));
    expect(spy).toHaveBeenCalledTimes(1);
    r.go('b');
    document.dispatchEvent(new Event('ping'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a throwing mount leaves the stack unchanged and restores the previous view', () => {
    const r = createRouter(); r.init(root);
    r.register('a', appender('a'));
    r.register('bad', () => ({ mount() { throw new Error('boom'); }, unmount() {} }));
    r.register('notview', () => ({}));
    r.go('a');
    expect(() => r.go('bad')).toThrow('boom');
    expect(r.stackDepth()).toBe(1);
    expect(r.current().name).toBe('a');
    expect([...root.children].map((c) => c.id)).toEqual(['a']);
    expect(() => r.go('notview')).toThrow(/mount\/unmount/);
    expect(r.stackDepth()).toBe(1);
    expect(r.current().view).not.toBeNull();
  });

  it('a throwing mount on the very first go leaves an empty stack', () => {
    const r = createRouter(); r.init(root);
    r.register('bad', () => ({ mount() { throw new Error('boom'); }, unmount() {} }));
    expect(() => r.go('bad')).toThrow('boom');
    expect(r.stackDepth()).toBe(0);
    expect(r.current()).toBeNull();
  });

  it('back remounts the beneath view even when the outgoing unmount throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = createRouter(); r.init(root);
    r.register('a', appender('a'));
    r.register('b', () => ({
      mount(rt) { rt.appendChild(document.createElement('i')); },
      unmount() { throw new Error('unmount boom'); },
    }));
    r.go('a'); r.go('b');
    expect(r.back()).toBe(true);
    expect(r.stackDepth()).toBe(1);
    expect(r.current().name).toBe('a');
    expect([...root.children].map((c) => c.id)).toEqual(['a']);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('go completes when the outgoing unmount throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = createRouter(); r.init(root);
    r.register('a', () => ({
      mount(rt) { rt.appendChild(document.createElement('i')); },
      unmount() { throw new Error('unmount boom'); },
    }));
    r.register('b', appender('b'));
    r.go('a'); r.go('b');
    expect(r.stackDepth()).toBe(2);
    expect(r.current().name).toBe('b');
    expect([...root.children].map((c) => c.id)).toEqual(['b']);
    err.mockRestore();
  });

  it('go with a throwing outgoing unmount and a throwing new mount restores the previous view', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = createRouter(); r.init(root);
    r.register('a', () => ({
      mount(rt) { const p = document.createElement('p'); p.id = 'a'; rt.appendChild(p); },
      unmount() { throw new Error('unmount boom'); },
    }));
    r.register('bad', () => ({ mount() { throw new Error('boom'); }, unmount() {} }));
    r.go('a');
    expect(() => r.go('bad')).toThrow('boom');
    expect(r.stackDepth()).toBe(1);
    expect(r.current().view).not.toBeNull();
    expect([...root.children].map((c) => c.id)).toEqual(['a']);
    err.mockRestore();
  });

  it('a mount that appends and then throws leaves the root cleared', () => {
    const r = createRouter(); r.init(root);
    r.register('bad', () => ({
      mount(rt) { rt.appendChild(document.createElement('p')); throw new Error('boom'); },
      unmount() {},
    }));
    expect(() => r.go('bad')).toThrow('boom');
    expect(root.children.length).toBe(0);
    expect(r.stackDepth()).toBe(0);
  });

  it('back at depth 1 emits exit and keeps the view mounted', () => {
    const onExit = vi.fn();
    const r = createRouter(); r.init(root, { onExit });
    const a = dummy('a');
    r.register('a', a);
    r.go('a');
    const exit = vi.fn();
    document.addEventListener('exit', exit);
    expect(r.back()).toBe(false);
    document.removeEventListener('exit', exit);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(r.stackDepth()).toBe(1);
    expect(a.calls).toEqual([['mount', 'a']]);
  });

  it('throws on unknown view', () => {
    const r = createRouter(); r.init(root);
    expect(() => r.go('nope')).toThrow(/Unknown view/);
  });

  it('router.onKey only reflects the active view consuming the key', () => {
    const r = createRouter(); r.init(root);
    r.register('a', dummy('a', { onKey: () => true }));
    r.register('b', dummy('b'));
    r.go('a');
    expect(r.onKey({})).toBe(true);
    r.go('b');
    expect(r.onKey({})).toBe(false);
  });
});

describe('app.boot', () => {
  let dispose;
  const keydown = (keyCode) => {
    const e = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    return e;
  };
  afterEach(() => {
    dispose && dispose();
    delete views.t1; delete views.t2;
  });

  it('a view onKey returning true stops nav from handling the key', () => {
    const onKey = vi.fn(() => true);
    views.t1 = dummy('t1', { onKey });
    dispose = boot(root);
    router.go('t1');
    const e = keydown(40);
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false); // nav would preventDefault on arrow keys
  });

  it('falls through to nav when the view declines', () => {
    views.t2 = dummy('t2', { onKey: vi.fn(() => false) });
    dispose = boot(root);
    router.go('t2');
    const e = keydown(40);
    expect(e.defaultPrevented).toBe(true); // nav handled the arrow key
  });

  it('a back event pops the stack via the router', () => {
    views.t1 = dummy('t1');
    dispose = boot(root);

    router.go('t1');
    expect(router.stackDepth()).toBe(2); // splash + t1
    document.dispatchEvent(new CustomEvent('back', { bubbles: true }));
    expect(router.stackDepth()).toBe(1);
    expect(router.current().name).toBe('splash');
  });

  it('Back key (10009) reaches the router through nav', () => {
    views.t1 = dummy('t1');
    dispose = boot(root);

    router.go('t1');
    keydown(10009);
    expect(router.current().name).toBe('splash');
  });

  it('dispose removes the global listeners', () => {
    const onKey = vi.fn(() => true);
    views.t1 = dummy('t1', { onKey });
    dispose = boot(root);
    router.go('t1');
    dispose(); dispose = null;
    keydown(40);
    expect(onKey).not.toHaveBeenCalled();
  });
});

