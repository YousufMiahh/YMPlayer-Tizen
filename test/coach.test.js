// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as coach from '../js/ui/coach.js';

const key = (keyCode) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'keyCode', { value: keyCode });
  window.dispatchEvent(e);
  return e;
};
const text = (sel) => document.querySelector(sel)?.textContent;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"><button id="t">target</button></div>';
  document.getElementById('t').getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 160, width: 200, height: 60 });
  vi.useFakeTimers();
});
afterEach(() => { coach._reset(); vi.useRealTimers(); document.body.innerHTML = ''; });

const steps = () => [
  { target: document.getElementById('t'), title: 'One', body: 'First' },
  { target: null, title: 'Two', body: 'Second' },
];

describe('Coach.offer', () => {
  it('asks once with the Android text; "Show me" turns the tutorial on and starts the tour', async () => {
    const start = vi.fn();
    coach.offer(start);
    expect(text('.dialog-title')).toBe('Welcome to YM Player');
    expect(text('.dialog-message')).toBe(coach.OFFER_TEXT);
    expect(coach.OFFER_TEXT).toContain('skip it at any time with Back.');
    document.querySelector('[data-value="positive"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledTimes(1);
    expect(coach.wants('home')).toBe(true);
    coach.offer(start); // asked already: no dialog, just the tour
    expect(document.querySelector('.dialog')).toBeNull();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('"No thanks" leaves the tutorial off', async () => {
    const start = vi.fn();
    coach.offer(start);
    document.querySelector('[data-value="negative"]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(start).not.toHaveBeenCalled();
    expect(coach.wants('home')).toBe(false);
  });
});

describe('Coach.show', () => {
  it('nothing while the tutorial is off', () => {
    coach.show('home', steps());
    vi.advanceTimersByTime(2000);
    expect(document.querySelector('.coach')).toBeNull();
  });

  it('after 900 ms: TIP n OF m, OK for the next tip, "OK  Done" on the last, once per screen', () => {
    coach.restart();
    coach.show('home', steps());
    vi.advanceTimersByTime(899);
    expect(coach.showing()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(coach.showing()).toBe(true);
    expect(text('.coach-counter')).toBe('TIP 1 OF 2');
    expect(text('.coach-title')).toBe('One');
    expect(text('.coach-hint')).toBe('OK  Next      Back  Skip tour');
    const e = key(13);
    expect(e.defaultPrevented).toBe(true);
    expect(text('.coach-counter')).toBe('TIP 2 OF 2');
    expect(text('.coach-hint')).toBe('OK  Done');
    key(13);
    expect(coach.showing()).toBe(false);
    coach.show('home', steps());
    vi.advanceTimersByTime(1000);
    expect(coach.showing()).toBe(false); // seen
  });

  it('Back skips the tour; steps whose target is not on screen are left out', () => {
    coach.restart();
    const hidden = document.createElement('div');
    coach.show('live', [{ target: hidden, title: 'Gone', body: '' }, { target: null, title: 'Only', body: '' }]);
    vi.advanceTimersByTime(900);
    expect(text('.coach-counter')).toBe('TIP 1 OF 1');
    key(10009);
    expect(coach.showing()).toBe(false);
  });
});
