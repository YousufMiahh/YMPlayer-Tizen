// @vitest-environment jsdom
// Home, Netflix-style: a film / series card widens, then plays a muted preview inside it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/api.js', () => ({
  seriesInfo: vi.fn(async () => ({ episodes: { 1: [{ id: '501', episode_num: 1, title: 'Pilot' }, { id: '502', episode_num: 2, title: 'Two' }] } })),
  playUrl: vi.fn((it) => `http://x/${it.type}/${it.id}`),
}));

import * as store from '../js/store.js';
import { createHomePeek, WIDEN_AFTER_MS, PLAY_AFTER_MS, FILM_START_MS, EPISODE_START_MS } from '../js/home-peek.js';

let av; let items;
function makeCard(it, shape = 'poster') {
  const b = document.createElement('button');
  b.className = `card ${shape}`;
  b.innerHTML = '<span class="art"><img src="x.jpg"></span><span class="title"></span>';
  items.set(b, it);
  document.body.appendChild(b);
  return b;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<object id="av" hidden></object>';
  items = new Map();
  av = {
    open: vi.fn(), setListener: vi.fn(), setDisplayRect: vi.fn(), setStreamingProperty: vi.fn(),
    prepareAsync: vi.fn((ok) => ok()), play: vi.fn(), stop: vi.fn(), close: vi.fn(),
    seekTo: vi.fn((ms, ok) => ok()),
  };
  globalThis.webapis = { avplay: av };
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); delete globalThis.webapis; });

const peekOf = () => createHomePeek({ itemOf: (c) => items.get(c) || null });

describe('Home card previews', () => {
  it('a film card widens straight away, then plays muted from 5 minutes in; moving off puts it back', async () => {
    const p = peekOf();
    const c = makeCard({ type: 'movie', id: '1', name: 'Heat' });
    c.focus(); p.focus(c);
    expect(WIDEN_AFTER_MS).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(c.classList.contains('peek')).toBe(true);
    expect(c.querySelector('.peek-logo')).not.toBeNull(); // backdrop + logo layer (filled from TMDB when there is one)
    await vi.advanceTimersByTimeAsync(PLAY_AFTER_MS);
    expect(av.open).toHaveBeenCalledWith('http://x/movie/1');
    expect(av.seekTo).toHaveBeenCalledWith(FILM_START_MS, expect.any(Function), expect.any(Function));
    expect(av.play).toHaveBeenCalled();
    expect(p.playing).toBe(true);
    const other = makeCard({ type: 'movie', id: '2', name: 'Ronin' });
    other.focus(); p.focus(other);
    expect(c.classList.contains('peek')).toBe(false);
    expect(c.querySelector('.peek-logo')).toBeNull();
    expect(p.playing).toBe(false);
    expect(document.documentElement.classList.contains('preview-on')).toBe(false);
    expect(av.close).not.toHaveBeenCalled(); // hidden at once; closed when you rest, not mid-move
    await vi.advanceTimersByTimeAsync(PLAY_AFTER_MS);
    expect(av.close).toHaveBeenCalled(); // before the next card's preview opens
    expect(av.close.mock.invocationCallOrder[0]).toBeLessThan(av.open.mock.invocationCallOrder[1]);
  });

  it('something you were watching plays from where you were; a series from its first episode', async () => {
    const p = peekOf();
    const m = { type: 'movie', id: '1', name: 'Heat' };
    store.setPosition(m, 754000);
    const c = makeCard(m);
    c.focus(); p.focus(c);
    await vi.advanceTimersByTimeAsync(WIDEN_AFTER_MS + PLAY_AFTER_MS + 10);
    expect(av.seekTo).toHaveBeenLastCalledWith(754000, expect.any(Function), expect.any(Function));
    const s = makeCard({ type: 'series', id: '7', name: 'Dark' });
    s.focus(); p.focus(s);
    await vi.advanceTimersByTimeAsync(WIDEN_AFTER_MS + PLAY_AFTER_MS + 10);
    expect(av.open).toHaveBeenLastCalledWith('http://x/episode/501');
    expect(av.seekTo).toHaveBeenLastCalledWith(EPISODE_START_MS, expect.any(Function), expect.any(Function));
  });

  it('channels are left alone, and Settings → Film & Series Previews turns it off', async () => {
    const p = peekOf();
    const ch = makeCard({ type: 'live', id: '9', name: 'BBC One' }, 'channel');
    ch.focus(); p.focus(ch);
    await vi.advanceTimersByTimeAsync(5000);
    expect(ch.classList.contains('peek')).toBe(false);
    store.setHomePreviews(0);
    const c = makeCard({ type: 'movie', id: '1', name: 'Heat' });
    c.focus(); p.focus(c);
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.classList.contains('peek')).toBe(false);
    expect(av.open).not.toHaveBeenCalled();
  });
});
