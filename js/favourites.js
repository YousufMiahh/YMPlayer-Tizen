// Favourite toggling shared by the screens that still mark items with a class (Search).
import * as store from './store.js';

/** Toggle an item's favourite state and mirror it on its element. @returns true if now a favourite. */
export function toggleItem(item, el) {
  const on = store.toggleFav(item);
  if (el) el.classList.toggle('fav', on);
  return on;
}
