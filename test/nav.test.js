// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { register, focusFirst, moveFocus, onKey, registerTizenKeys } from '../js/nav.js';

function box(el, x, y, w = 100, h = 50) {
  el.getBoundingClientRect = () => ({
    left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y,
  });
  return el;
}
function btn(id, x, y, w, h) {
  const b = document.createElement('button');
  b.id = id;
  document.body.appendChild(b);
  return box(b, x, y, w, h);
}
const key = (keyCode) => ({ keyCode, preventDefault: vi.fn() });

let c;
beforeEach(() => {
  document.body.innerHTML = '<div id="c"></div>';
  c = document.getElementById('c');
});
afterEach(() => { delete globalThis.tizen; });

function grid() {
  // a b c
  // d e f
  const ids = { a: [0, 0], b: [200, 0], c: [400, 0], d: [0, 100], e: [200, 100], f: [400, 100] };
  for (const [id, [x, y]] of Object.entries(ids)) {
    const el = box(document.createElement('button'), x, y);
    el.id = id;
    c.appendChild(el);
  }
  register(c);
  focusFirst(c);
}

describe('nav', () => {
  it('focusFirst focuses the first visible focusable', () => {
    grid();
    expect(document.activeElement.id).toBe('a');
  });

  it('right and down move to the nearest neighbour', () => {
    grid();
    moveFocus('right');
    expect(document.activeElement.id).toBe('b');
    moveFocus('down');
    expect(document.activeElement.id).toBe('e');
    moveFocus('left');
    expect(document.activeElement.id).toBe('d');
    moveFocus('up');
    expect(document.activeElement.id).toBe('a');
  });

  it('prefers the aligned candidate over a closer diagonal one', () => {
    const cur = box(document.createElement('button'), 0, 0); cur.id = 'cur';
    const diag = box(document.createElement('button'), 110, 200, 100, 50); diag.id = 'diag';
    const aligned = box(document.createElement('button'), 300, 0, 100, 50); aligned.id = 'aligned';
    c.append(cur, diag, aligned);
    register(c); cur.focus();
    moveFocus('right');
    expect(document.activeElement.id).toBe('aligned');
  });

  it('stops at the edge (no wrap)', () => {
    grid();
    expect(moveFocus('left')).toBe(false);
    expect(document.activeElement.id).toBe('a');
    expect(moveFocus('up')).toBe(false);
    moveFocus('right'); moveFocus('right');
    expect(moveFocus('right')).toBe(false);
    expect(document.activeElement.id).toBe('c');
  });

  it('ignores zero-size, disabled and hidden elements', () => {
    const a = box(document.createElement('button'), 0, 0); a.id = 'a';
    const zero = box(document.createElement('button'), 150, 0, 0, 0); zero.id = 'zero';
    const dis = box(document.createElement('button'), 160, 0); dis.id = 'dis'; dis.disabled = true;
    const hid = box(document.createElement('button'), 170, 0); hid.id = 'hid'; hid.hidden = true;
    const far = box(document.createElement('button'), 400, 0); far.id = 'far';
    c.append(a, zero, dis, hid, far);
    register(c); a.focus();
    moveFocus('right');
    expect(document.activeElement.id).toBe('far');
  });

  it('OK fires activate on the focused element', () => {
    grid();
    const fn = vi.fn();
    document.getElementById('a').addEventListener('activate', fn);
    const ev = key(13);
    expect(onKey(ev)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('Back (10009 and Escape) fires back', () => {
    grid();
    const fn = vi.fn();
    document.addEventListener('back', fn);
    expect(onKey(key(10009))).toBe(true);
    expect(onKey(key(27))).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    document.removeEventListener('back', fn);
  });

  it('arrow keys via onKey move focus; unknown keys are unhandled', () => {
    grid();
    expect(onKey(key(39))).toBe(true);
    expect(document.activeElement.id).toBe('b');
    expect(onKey(key(40))).toBe(true);
    expect(document.activeElement.id).toBe('e');
    expect(onKey(key(65))).toBe(false);
  });

  it('registerTizenKeys no-ops without tizen and registers keys with it', () => {
    expect(() => registerTizenKeys()).not.toThrow();
    const reg = vi.fn();
    globalThis.tizen = { tvinputdevice: { registerKey: reg } };
    registerTizenKeys();
    expect(reg).toHaveBeenCalledWith('MediaPlayPause');
  });
});
