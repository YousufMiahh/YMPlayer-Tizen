// Port of FilterSettings.java: Settings → "Hide What You Don't Watch" → Countries & Languages and
// Hidden Categories, both multi-choice AlertDialogs.
import * as filters from './filters.js';
import * as repo from './repo.js';
import { LIVE, MOVIE, SERIES } from './item.js';
import { showDialog } from './ui/dialog.js';
import { toast, LONG } from './ui/toast.js';

export const SECTION = "Hide What You Don't Watch";
export const COUNTRIES = 'Countries & Languages';
export const HIDDEN = 'Hidden Categories';

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
