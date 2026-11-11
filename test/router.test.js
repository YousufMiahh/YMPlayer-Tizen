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

let root;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root');
});

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
    root.innerHTML = '';
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
    views.t1 = dummy('t1'); views.t2 = dummy('t2');
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

