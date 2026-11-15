// Port of FilterSettings.java: Settings → "Hide What You Don't Watch" → Countries & Languages and
// Hidden Categories, both multi-choice AlertDialogs.
import * as filters from './filters.js';
import * as repo from './repo.js';
import * as store from './store.js';
import { LIVE, MOVIE, SERIES } from './item.js';
import { showDialog } from './ui/dialog.js';
import { toast, LONG } from './ui/toast.js';

export const SECTION = "Hide What You Don't Watch";
export const COUNTRIES = 'Countries & Languages';
export const HIDDEN = 'Hidden Categories';
export const RENAME = 'Rename Categories';
export const RENAME_VALUE = 'Give categories your own names';

export function countriesLabel() {
  const n = filters.hiddenTags().size;
  return n === 0 ? 'Showing everything' : `${n} hidden`;
}

export function hiddenLabel() {
  let n = 0;
  for (const t of [LIVE, MOVIE, SERIES]) n += filters.hiddenCategories(t).size;
  const f = filters.hiddenTags().size > 0;
  if (n === 0) return f ? "See everything that's hidden" : 'None';
  return `${n} hidden by you${f ? ' · more by filters' : ''}`;
}

/** The ticked list's label for one tag: "FR  ·  France   (3 categories)" / "Arabic writing   (1 category)". */
export function tagLabel(tag, n) {
  const name = filters.tagName(tag);
  return `${tag.startsWith('#') || name === tag ? name : `${tag}  ·  ${name}`}   (${n}${n === 1 ? ' category)' : ' categories)'}`;
}

/** Tick the countries and languages to keep; unticked ones disappear everywhere. */
export async function countries(onSaved) {
  toast('Looking through your categories…');
  const tags = await filters.detectTags();
  if (!tags.size) {
    toast("Your provider's categories aren't labelled by country or language", LONG);
    return null;
  }
  const keys = [...tags.keys()];
  const hidden = filters.hiddenTags();
  const labels = keys.map((k) => tagLabel(k, tags.get(k)));
  const shown = keys.map((k) => !hidden.has(k));
  const allLabel = (c) => (c.some(Boolean) ? 'Unselect all' : 'Select all');
  const d = showDialog({
    title: 'Countries & languages to show',
    multi: { labels, checked: shown },
    positive: 'Save', neutral: allLabel(shown), negative: 'Cancel',
    onItemToggle: () => d.setButton('neutral', allLabel(d.checked())),
    onNeutral: (h) => { // untick everything (then tick just the ones you want), or tick everything again
      const any = h.checked().some(Boolean);
      keys.forEach((_, i) => h.setChecked(i, !any));
      h.setButton('neutral', allLabel(h.checked()));
    },
  });
  const v = await d.result;
  if (v !== 'positive') return null;
  const now = d.checked();
  const keep = filters.hiddenTags();
  keys.forEach((k, i) => { if (now[i]) keep.delete(k); else keep.add(k); });
  filters.setHiddenTags(keep);
  if (onSaved) onSaved(countriesLabel());
  return keep;
}

/** Everything that's hidden, by you or a filter; untick to bring a category back. */
export async function hidden(onSaved) {
  const mine = []; const filtered = [];
  const types = [LIVE, MOVIE, SERIES]; const names = ['Live TV', 'Movies', 'Series'];
  const tags = filters.hiddenTags();
  for (let i = 0; i < 3; i++) {
    const byYou = filters.hiddenCategories(types[i]); const shows = filters.alwaysShown(types[i]);
    let cats;
    try { cats = await repo.categories(types[i]); } catch { continue; }
    for (const c of cats) {
      const you = byYou.has(c.id);
      const t = filters.tag(c.name);
      const filter = t !== null && tags.has(t);
      if (!you && !filter) continue;
      const why = you ? 'hidden by you' : `hidden by the ${filters.tagName(t)} filter`;
      const row = { type: types[i], id: c.id, label: `${names[i]}  ·  ${c.name}   (${why})`, you, filter, nowHidden: you || !shows.has(c.id) };
      (you ? mine : filtered).push(row);
    }
  }
  const rows = [...mine, ...filtered]; // yours first, then the ones the filters hid
  if (!rows.length) {
    toast('Nothing hidden. Hold OK (or press ☰) on a category to hide it.', LONG);
    return null;
  }
  const d = showDialog({
    title: 'Hidden categories — untick to show',
    multi: { labels: rows.map((r) => r.label), checked: rows.map((r) => r.nowHidden) },
    positive: 'Save', negative: 'Cancel',
  });
  const v = await d.result;
  if (v !== 'positive') return null;
  const now = d.checked();
  rows.forEach((r, i) => {
    if (now[i] === r.nowHidden) return; // unchanged
    if (!now[i]) { // bring it back
      if (r.you) filters.setCategoryHidden(r.type, r.id, false);
      if (r.filter) filters.setAlwaysShown(r.type, r.id, true);
    } else if (r.filter) filters.setAlwaysShown(r.type, r.id, false); // hide it again
    else filters.setCategoryHidden(r.type, r.id, true);
  });
  if (onSaved) onSaved(hiddenLabel());
  return rows;
}

// ------------------------------------------------------------ your own category names

/**
 * FilterSettings.askName: type a new name for one category (blank, or the provider's own name,
 * restores the original). `cat` is the category as the provider names it.
 * Resolves true when the name changed.
 */
export async function askName(type, cat) {
  const mine = store.catName(type, cat.id);
  const d = showDialog({
    title: `Rename “${cat.name}”`, input: { value: mine === null ? cat.name : mine },
    positive: 'Save', neutral: 'Original Name', negative: 'Cancel',
  });
  const v = await d.result;
  if (v === 'positive') {
    const n = d.value().trim();
    const original = n === '' || n === cat.name;
    store.setCatName(type, cat.id, original ? null : n);
    filters.changed();
    toast(original ? 'Original name restored' : `Renamed to ${n}`);
    return true;
  }
  if (v === 'neutral') {
    store.setCatName(type, cat.id, null);
    filters.changed();
    return true;
  }
  return false;
}

/** The category as the provider names it (lists may show your own name for it). */
export async function rawCategory(type, c) {
  try {
    const hit = (await repo.categories(type)).find((r) => r.id === c.id);
    if (hit) return hit;
  } catch { /* no list: rename what we were given */ }
  return c;
}

/** Settings → Rename Categories: pick a section, pick a category, type a new name. */
export async function rename() {
  const types = [LIVE, MOVIE, SERIES];
  const w = await showDialog({ title: 'Rename categories in…', items: ['Live TV', 'Movies', 'Series'] }).result;
  if (typeof w !== 'number') return false;
  const type = types[w];
  let cats = null;
  try { cats = await repo.categories(type); } catch { cats = null; }
  if (!cats || !cats.length) { toast("Couldn't load the categories"); return false; }
  const labels = cats.map((c) => { const mine = store.catName(type, c.id); return mine === null ? c.name : `✎  ${mine}   (${c.name})`; });
  const i = await showDialog({ title: 'Pick a category to rename', items: labels }).result;
  if (typeof i !== 'number') return false;
  return askName(type, cats[i]);
}
