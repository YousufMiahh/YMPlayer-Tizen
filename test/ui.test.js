// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGlider, GLIDE_MS } from '../js/ui/glider.js';
import { showDialog } from '../js/ui/dialog.js';
import { toast, SHORT, LONG, current as toastText } from '../js/ui/toast.js';
import { createSheet } from '../js/ui/sheet.js';
import { pillButton, sectionHeading, initials, rowCell, shelfTitle } from '../js/ui/widgets.js';
import { LONG_PRESS_MS, HOLD_OK, u } from '../js/ui/theme.js';
import * as bd from '../js/ui/backdrop.js';

const key = (keyCode, extra = {}) => {
  const e = new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true, ...extra });
  (document.activeElement || document).dispatchEvent(e);
  return e;
};
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; });
afterEach(() => { vi.useRealTimers(); });

describe('theme constants', () => {
  it('match the Java', () => {
    expect(u(10)).toBeCloseTo(14);
    expect(LONG_PRESS_MS).toBe(450);
    expect(HOLD_OK).toBe('Hold OK');
  });
});

describe('glider', () => {
  function list(n) {
    const l = document.createElement('div');
    for (let i = 0; i < n; i++) {
      const r = rowCell({ title: `Row ${i}` });
      Object.defineProperty(r, 'offsetTop', { value: i * 60 });
      Object.defineProperty(r, 'offsetHeight', { value: 56 });
      Object.defineProperty(r, 'offsetWidth', { value: 400 });
      l.appendChild(r);
    }
    document.getElementById('root').appendChild(l);
    return l;
  }

  it('appears under the first focused row without gliding, then glides to the next', () => {
    const l = list(3);
    const g = createGlider(l);
    const rows = l.querySelectorAll('.row-cell');
    rows[0].focus();
    expect(g.state().shown).toBe(true);
    expect(g.pill.classList.contains('on')).toBe(true);
    expect(g.pill.style.transform).toBe('translateY(0px)');
    expect(g.pill.style.transition).not.toContain('transform');
    rows[2].focus();
    expect(g.pill.style.transform).toBe('translateY(120px)');
    expect(g.pill.style.transition).toContain(`transform ${GLIDE_MS}ms`);
    expect(g.pill.style.height).toBe('56px');
  });

  it('fades out when focus leaves the list and survives a re-render', () => {
    const l = list(2);
    const g = createGlider(l);
    const out = document.createElement('button');
    document.body.appendChild(out);
    l.querySelector('.row-cell').focus();
    out.focus();
    expect(g.state().shown).toBe(false);
    expect(g.pill.classList.contains('on')).toBe(false);
    l.replaceChildren(rowCell({ title: 'New' }));
    l.querySelector('.row-cell').focus();
    expect(l.contains(g.pill)).toBe(true);
    expect(g.state().shown).toBe(true);
    g.destroy();
    expect(l.contains(g.pill)).toBe(false);
  });
});

describe('dialog', () => {
  it('shows title, message and buttons in Android order and focuses as asked', () => {
    const d = showDialog({ title: 'Remove from Continue Watching?', message: 'Film', positive: 'Remove', negative: 'Cancel', focus: 'negative' });
    expect(d.el.querySelector('.dialog-title').textContent).toBe('Remove from Continue Watching?');
    expect(d.el.querySelector('.dialog-message').textContent).toBe('Film');
    expect([...d.el.querySelectorAll('.dialog-button')].map((b) => b.textContent)).toEqual(['Cancel', 'Remove']);
    expect(document.activeElement.textContent).toBe('Cancel');
    expect(document.getElementById('root').hasAttribute('inert')).toBe(true);
    d.close();
  });

  it('Right/Left move between buttons, OK resolves the choice and restores focus', async () => {
    const before = document.createElement('button');
    document.getElementById('root').appendChild(before);
    before.focus();
    const d = showDialog({ title: 'T', positive: 'Remove', negative: 'Cancel', focus: 'negative' });
    const leak = vi.fn();
    document.addEventListener('keydown', leak);
    key(39);
    expect(document.activeElement.textContent).toBe('Remove');
    key(39); // stays at the end
    expect(document.activeElement.textContent).toBe('Remove');
    key(13);
    expect(await d.result).toBe('positive');
    expect(document.activeElement).toBe(before);
    expect(leak).not.toHaveBeenCalled(); // the dialog owns the keys while open
    document.removeEventListener('keydown', leak);
    expect(document.querySelector('.dialog')).toBeNull();
    expect(document.getElementById('root').hasAttribute('inert')).toBe(false);
  });

  it('Back closes with null; item lists move with Up/Down and resolve the index', async () => {
    const a = showDialog({ title: 'X', positive: 'OK' });
    key(10009);
    expect(await a.result).toBe(null);
    const b = showDialog({ title: 'News', items: ['♡  Favourite', 'Hide'] });
    expect(document.activeElement.textContent).toBe('♡  Favourite');
    key(40);
    expect(document.activeElement.textContent).toBe('Hide');
    key(13);
    expect(await b.result).toBe(1);
  });

  it('a held OK (key repeat) does not pick anything', async () => {
    const d = showDialog({ title: 'X', positive: 'OK' });
    key(13, { repeat: true });
    expect(document.querySelector('.dialog')).not.toBeNull();
    d.close('x');
    expect(await d.result).toBe('x');
  });
});

describe('toast', () => {
  it('shows, is replaced by the next one, and hides after SHORT / LONG', () => {
    vi.useFakeTimers();
    toast('Added to Favourites — BBC One');
    expect(toastText()).toBe('Added to Favourites — BBC One');
    vi.advanceTimersByTime(SHORT - 10);
    toast('Hidden: News', LONG);
    expect(document.querySelectorAll('.toast').length).toBe(1);
    vi.advanceTimersByTime(SHORT);
    expect(toastText()).toBe('Hidden: News');
    vi.advanceTimersByTime(LONG);
    expect(toastText()).toBe(null);
    vi.advanceTimersByTime(500);
    expect(document.querySelector('.toast')).toBeNull();
  });
});

describe('sheet', () => {
  it('opens on a side, focuses its first control and closes on Back', () => {
    vi.useFakeTimers();
    const s = createSheet({ side: 'left', width: 560, title: 'Channels', hint: `${HOLD_OK}  Add or remove favourite` });
    expect(s.el.style.width).toBe(`${560 * 1.4}px`);
    s.body.appendChild(pillButton('BBC One'));
    s.open();
    expect(s.isOpen()).toBe(true);
    expect(document.activeElement.textContent).toBe('BBC One');
    key(10009);
    expect(s.isOpen()).toBe(false);
    vi.advanceTimersByTime(300);
    expect(s.el.hidden).toBe(true);
    s.destroy();
  });
});

describe('widgets', () => {
  it('pill button, heading, initials, row cell, shelf hint', () => {
    expect(pillButton('Play').className).toBe('pill-btn');
    expect(sectionHeading('Accounts').textContent).toBe('ACCOUNTS');
    expect(initials('bbc one hd')).toBe('BO');
    expect(initials('')).toBe('');
    const r = rowCell({ num: 101, logo: 'x.png', title: 'BBC', trail: '♥', active: true });
    expect(r.classList.contains('active')).toBe(true);
    expect(r.querySelector('.rc-num').textContent).toBe('101');
    expect(r.querySelector('.rc-trail').textContent).toBe('♥');
    expect(shelfTitle('Continue Watching', 'Hold OK to remove from list').textContent)
      .toBe('Continue Watching      Hold OK to remove from list');
  });
});

describe('backdrop (Ambient)', () => {
  beforeEach(() => { bd._reset(); bd.uninstall(); });

  it('tone() follows Ambient.tone for dark and light', () => {
    // HOME #2A2F7A: S .656 -> .82, V .46
    const [h, s, v] = bd.toHsv(bd.tone(0x2A2F7A, true));
    expect(Math.round(h)).toBe(bd.toHsv(0x2A2F7A)[0] | 0);
    expect(s).toBeCloseTo(0.82, 1);
    expect(v).toBeCloseTo(0.46, 1);
    // greys become slate blue (hue 228)
    expect(Math.round(bd.toHsv(bd.tone(0x808080, true))[0])).toBeCloseTo(228, -1);
    expect(bd.toHsv(bd.tone(0x2A2F7A, false))[2]).toBeCloseTo(0.97, 1);
  });

  it('stops are [tone, mix .45, mix .85, BG]', () => {
    const s = bd.stops(0xFF0000, 0x000000);
    expect(s).toEqual([0xFF0000, 0x8C0000, 0x260000, 0x000000]);
    expect(bd.gradient(0x112233)).toMatch(/^linear-gradient\(to bottom, #112233 0%,/);
  });

  it('dominant() weights vivid pixels and skips transparent / grey ones', () => {
    const px = (r, g, b, a = 255) => [r, g, b, a];
    const red = [...px(255, 0, 0), ...px(128, 128, 128), ...px(0, 0, 255, 10)];
    expect(bd.dominant(Uint8ClampedArray.from(red))).toBe(0xFF0000);
    const grey = [...px(100, 100, 100), ...px(200, 200, 200)];
    expect(bd.dominant(Uint8ClampedArray.from(grey))).toBe(0x969696);
    expect(bd.dominant(new Uint8ClampedArray(0))).toBe(bd.FALLBACK);
  });

  it('setSection paints the toned resting colour; tint fades to the artwork; failures change nothing', async () => {
    let now = 0;
    bd.setClock(() => now);
    const host = bd.install(document.body);
    bd.setSection('movies');
    expect(bd.current()).toBe(bd.tone(bd.SECTION_COLORS.movies));
    expect(host.querySelectorAll('.bd-layer').length).toBe(2);

    bd.setSampler(async (url) => {
      if (url === 'bad') throw new Error('404');
      return Uint8ClampedArray.from([0, 200, 0, 255]);
    });
    await bd.tint('good');
    const green = bd.tone(0x00C800);
    expect(host.lastChild.style.transition).toContain(`${bd.FADE_MS}ms`);
    now = bd.FADE_MS / 2;
    expect(bd.current()).not.toBe(green); // mid-fade
    now = bd.FADE_MS;
    expect(bd.current()).toBe(green);

    await bd.tint('bad');
    now = 5000;
    expect(bd.current()).toBe(green); // Android: no callback, colour stays

    bd.setSection('live'); // hand-off: fades from green to Live's colour
    now = 5000 + bd.FADE_MS;
    expect(bd.current()).toBe(bd.tone(bd.SECTION_COLORS.live));
    bd.setSampler(null); bd.setClock(null);
  });

  it('caches colours per URL', async () => {
    const sampler = vi.fn(async () => Uint8ClampedArray.from([200, 0, 0, 255]));
    bd.setSampler(sampler);
    await bd.colorOf('a'); await bd.colorOf('a');
    expect(sampler).toHaveBeenCalledTimes(1);
    bd.setSampler(null);
    await tick();
  });
});
