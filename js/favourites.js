// Single source of truth for favourite handling shared by Live, Movies, Series and Search.
import * as store from './store.js';
import { rowCell } from './ui/widgets.js';

/** Favourite categories first (stable), then the rest in their original order. */
export function orderCategories(type, cats) {
  const fav = (c) => store.isFavCategory(type, c.id);
  return [...cats.filter(fav), ...cats.filter((c) => !fav(c))];
}

/** Category rail rows (Adapters.RowCell) for a section; favourites pinned with a trailing ♥. */
export function railButtons(type, cats) {
  return orderCategories(type, cats).map((c) => {
    const fav = store.isFavCategory(type, c.id);
    const b = rowCell({ title: c.name, trail: fav ? '\u2665' : '' });
    b.dataset.cat = c.id;
    b.classList.add('cat');
    if (fav) b.classList.add('fav');
    return b;
  });
}

/** Toggle an item's favourite state and mirror it on its element. @returns true if now a favourite. */
export function toggleItem(item, el) {
  const on = store.toggleFav(item);
  if (el) el.classList.toggle('fav', on);
  return on;
}

/** Toggle a favourite category, rebuild the rail, and restore focus/selection. */
export function toggleCategory(type, id, railEl, cats, selectedId) {
  store.toggleFavCategory(type, id);
  railEl.replaceChildren(...railButtons(type, cats));
  const find = (cid) => railEl.querySelector(`[data-cat="${cid}"]`);
  find(id)?.focus();
  if (selectedId) find(selectedId)?.classList.add('selected');
}
