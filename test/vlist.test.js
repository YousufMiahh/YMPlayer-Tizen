// @vitest-environment jsdom
// The windowed list / grid: only the rows on screen are in the DOM, selection and D-pad moves
// follow ListView / GridView, scrolling is ListView's minimal arrow scroll.
import { describe, it, expect, beforeEach } from 'vitest';
import { createVList } from '../js/ui/vlist.js';
import { holeMask } from '../js/live-preview.js';

let scroller;
const cell = (i) => { const b = document.createElement('button'); b.textContent = `Row ${i}`; return b; };
const inDom = (l) => [...l.body.children].map((c) => Number(c.dataset.index)).sort((a, b) => a - b);

beforeEach(() => {
  document.body.innerHTML = '<div id="s"></div>';
  scroller = document.getElementById('s');
});

describe('virtual list', () => {
  it('10 000 rows: only the visible window (plus overscan) is in the page', () => {
    const l = createVList({ scroller, pitch: 100, render: cell, viewportHeight: 1000, overscan: 2 });
    l.setCount(10000);
    expect(inDom(l)).toEqual(Array.from({ length: 13 }, (_, i) => i)); // rows 0..9 visible + 2 below (+ partial)
    expect(l.body.style.height).toBe('1000000px');
  });

  it('selecting far down renders that row at its place and scrolls just enough to show it', () => {
    let seen = null;
    const l = createVList({ scroller, pitch: 100, render: cell, viewportHeight: 1000, overscan: 1, onSelect: (i) => { seen = i; } });
    l.setCount(5000);
    l.select(4321, { focus: true });
    expect(seen).toBe(4321);
    const el = l.elementAt(4321);
    expect(el.style.top).toBe('432100px');
    expect(document.activeElement).toBe(el);
    expect(l.scrollY).toBe(432200 - 1000); // its bottom on the last line of the screen
    expect(l.body.style.transform).toBe(`translateY(${-(432200 - 1000)}px)`);
    expect(inDom(l).length).toBeLessThan(20);
    expect(inDom(l)).toContain(4321);
    expect(l.elementAt(0)).toBeNull();
  });

  it('moving down a row at a time scrolls by one row once the bottom is reached; up only when needed', () => {
    const l = createVList({ scroller, pitch: 100, render: cell, viewportHeight: 450 });
    l.setCount(50);
    l.focus();
    for (let i = 0; i < 4; i++) l.move('down');
    expect(l.selected).toBe(4);
    expect(l.scrollY).toBe(50);
    l.move('down');
    expect(l.scrollY).toBe(150);
    l.move('up'); l.move('up');
    expect(l.scrollY).toBe(150);
    l.move('up');
    expect(l.selected).toBe(2);
    expect(l.scrollY).toBe(150); // row 2 (200..300) is still fully on screen
    l.move('up');
    expect(l.scrollY).toBe(100);
  });

  it('edges report false so the screen decides where focus goes', () => {
    const l = createVList({ scroller, pitch: 100, render: cell, viewportHeight: 500 });
    l.setCount(3);
    l.focus();
    expect(l.move('up')).toBe(false);
    expect(l.move('left')).toBe(false);
    expect(l.move('right')).toBe(false);
    l.move('down'); l.move('down');
    expect(l.move('down')).toBe(false);
    expect(l.selected).toBe(2);
  });

  it('grid: AUTO_FIT columns with the spare width shared between the gaps', () => {
    const l = createVList({ scroller, pitch: 300, cellHeight: 290, colWidth: 250, render: cell, viewportHeight: 900, viewportWidth: 1315 });
    l.setCount(23);
    expect(l.columns).toBe(5);
    const sp = (1315 - 5 * 250) / 6;
    expect(l.elementAt(0).style.left).toBe(`${sp}px`);
    expect(l.elementAt(1).style.left).toBe(`${sp + 250 + sp}px`);
    expect(l.elementAt(5).style.top).toBe('300px');
    l.focus();
    expect(l.move('left')).toBe(false); // first column
    l.move('right'); l.move('right'); l.move('right'); l.move('right');
    expect(l.move('right')).toBe(false); // last column
    l.move('down'); l.move('down'); l.move('down');
    expect(l.selected).toBe(19);
    l.move('down'); // the last row is short: lands on its last cell
    expect(l.selected).toBe(22);
    expect(l.move('down')).toBe(false);
  });

  it('setCount(n, keep) keeps the selection (clamped) and focus; refresh() updates cells in place', () => {
    let calls = 0;
    const render = (i, el) => { calls++; if (el) { el.textContent = `Row ${i}*`; return el; } return cell(i); };
    const l = createVList({ scroller, pitch: 100, render, viewportHeight: 500 });
    l.setCount(10);
    l.select(7, { focus: true });
    const el = l.elementAt(7);
    l.refresh();
    expect(l.elementAt(7)).toBe(el);
    expect(el.textContent).toBe('Row 7*');
    expect(document.activeElement).toBe(el);
    l.setCount(5, true);
    expect(l.selected).toBe(4);
    expect(document.activeElement).toBe(l.elementAt(4));
    l.setCount(8);
    expect(l.selected).toBe(0);
    expect(l.scrollY).toBe(0);
    expect(calls).toBeGreaterThan(0);
  });

  it('setSelectionFromTop: select with a pixel offset keeps the row where it was on screen', () => {
    const l = createVList({ scroller, pitch: 100, render: cell, viewportHeight: 500 });
    l.setCount(100);
    l.select(40, { scroll: 'top' });
    expect(l.offsetOf(40)).toBe(0);
    l.select(42, { scroll: 'minimal' });
    const off = l.offsetOf(42);
    l.select(90); l.select(42, { scroll: off });
    expect(l.offsetOf(42)).toBe(off);
    expect(l.isVisible(42)).toBe(true);
    expect(l.isVisible(90)).toBe(false);
  });
});

describe('preview hole', () => {
  it('an SVG mask with a rounded-rect hole where the video shows', () => {
    const m = holeMask(1920, 1080, { x: 100, y: 50, w: 400, h: 200 }, 20);
    expect(m.startsWith('url("data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(m.slice(m.indexOf(',') + 1, -2));
    expect(svg).toContain('width="1920" height="1080"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('M0 0H1920V1080H0Z');
    expect(svg).toContain('M120 50H480A20 20 0 0 1 500 70V230');
  });
});
