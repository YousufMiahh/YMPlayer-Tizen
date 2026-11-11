// Item contract: a plain object {type, id, name, icon, num, ext, categoryId, plot, info, added, parentId}.
// Only type and id are required. Episodes may also carry parentName/parentIcon/duration.

export const LIVE = 'live';
export const MOVIE = 'movie';
export const SERIES = 'series';
export const EPISODE = 'episode';
export const CATEGORY = 'cat';

const FIELDS = ['type', 'id', 'name', 'icon', 'num', 'ext', 'categoryId', 'plot', 'info',
  'added', 'parentId', 'parentName', 'parentIcon', 'duration'];

/** Unique key for an item: "{type}:{id}". */
export function key(item) {
  return `${item.type}:${item.id}`;
}

/** Plain object -> Item (keeps only known, defined fields). */
export function fromJson(obj) {
  const item = {};
  for (const f of FIELDS) {
    if (obj && obj[f] !== undefined && obj[f] !== null) item[f] = obj[f];
  }
  if (item.id !== undefined) item.id = String(item.id);
  return item;
}

/** Item -> plain persistable object. */
export function toJson(item) {
  return fromJson(item);
}
