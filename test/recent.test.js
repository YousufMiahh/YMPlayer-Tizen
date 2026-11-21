import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../js/store.js';
import { menuItems } from '../js/item-menu.js';

beforeEach(() => localStorage.clear());

describe('Recent Channels: one at a time', () => {
  it('a recent channel offers Favourite and Remove from Recent Channels, nothing for films', () => {
    const ch = { type: 'live', id: '5', name: 'BBC One' };
    store.addHistory(ch);
    store.addHistory({ type: 'live', id: '6', name: 'ITV1' });
    const labels = menuItems(ch).map((x) => x.label);
    expect(labels).toEqual(['♡  Add to Favourites', '✕  Remove from Recent Channels']);
    menuItems(ch)[1].run();
    expect(store.history(true).map((h) => h.id)).toEqual(['6']);
    expect(store.inHistory(ch)).toBe(false);
    expect(menuItems(ch).map((x) => x.label)).toEqual(['♡  Add to Favourites']);
  });
});
