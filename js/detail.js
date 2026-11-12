// The data side of the movie and series pages (MovieActivity.java, SeriesActivity.java):
// get_vod_info / get_series_info parsing, the meta and credits lines, the button labels.
// Pure functions over js/store.js, so the views stay thin and this is tested on its own.
import * as store from './store.js';
import { EPISODE } from './item.js';
import { fmt, joinNonEmpty } from './home-rows.js';
import { youtubeId } from './trailer.js';

/** MovieActivity.str: trimmed text, or def when missing, blank or "null". */
export function str(o, k, def = null) {
  if (!o || o[k] === undefined || o[k] === null) return def;
  if (typeof o[k] === 'object') return def;
  const s = String(o[k]).trim();
  return s === '' || s === 'null' ? def : s;
}

/** XtreamApi.rating: "★ 7.5" (one decimal), or null for nothing / 0 / not a number. */
export function rating(r) {
  if (r === null || r === undefined) return null;
  const s = String(r).trim();
  if (s === '' || s === '0' || s === 'null') return null;
  const d = Number(s);
  if (!Number.isFinite(d) || d <= 0) return null;
  return `★ ${(Math.round(d * 10 + 1e-9) / 10).toFixed(1)}`;
}

/** MovieActivity.shortDuration: "01:45:00" -> "1 hr 45 min", "00:52:00" -> "52 min". */
export function shortDuration(hms) {
  const p = String(hms).split(':');
  const int = /^[+-]?\d+$/;
  if (p.length < 2 || !int.test(p[0]) || !int.test(p[1])) return hms; // Integer.parseInt throws
  const h = Number.parseInt(p[0], 10); const m = Number.parseInt(p[1], 10);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

const year4 = (y) => (y != null && y.length >= 4 ? y.slice(0, 4) : y);

// ------------------------------------------------------------ movie page

/**
 * MovieActivity.loadInfo, from one get_vod_info answer: what changes on the page.
 * Every field is null when Android would leave that part as it was.
 */
export function movieInfo(r, item) {
  const info = r && typeof r.info === 'object' && r.info && !Array.isArray(r.info) ? r.info : null;
  if (!info) return null;
  const plot = str(info, 'plot', str(info, 'description', null));
  const year = year4(str(info, 'releasedate', str(info, 'release_date', null)));
  let dur = str(info, 'duration', null);
  if (dur !== null && dur.startsWith('0') && dur.length === 8) dur = shortDuration(dur);
  const meta = joinNonEmpty(year, dur, str(info, 'genre', null), rating(str(info, 'rating', null)));
  const director = str(info, 'director', null);
  const cast = str(info, 'cast', str(info, 'actors', null));
  const credits = joinNonEmpty(director === null ? null : `Director: ${director}`, cast === null ? null : `Cast: ${cast}`);
  let backdrop = null;
  if (Array.isArray(info.backdrop_path) && info.backdrop_path.length) {
    const b = info.backdrop_path[0];
    backdrop = b === null || b === undefined ? null : String(b);
  }
  if (!backdrop) backdrop = str(info, 'movie_image', item && item.icon ? item.icon : null);
  const trailer = youtubeId(str(info, 'youtube_trailer', str(info, 'trailer', null)));
  const data = r.movie_data && typeof r.movie_data === 'object' ? r.movie_data : null;
  const ext = data ? str(data, 'container_extension', null) : null;
  return { plot, meta, credits: credits || '', backdrop, trailer, ext };
}

/** MovieActivity.buildButtons: [{action, label}] in order. */
export function movieButtons(item, trailer) {
  const pos = store.position(item);
  const out = [{ action: 'play', label: pos > 0 ? `▶  Resume  ${fmt(pos)}` : '▶  Play' }];
  if (pos > 0) out.push({ action: 'over', label: '↺  Start Over' });
  if (trailer) out.push({ action: 'trailer', label: '▶  Trailer' });
  out.push({ action: 'fav', label: favLabel(item) });
  return out;
}

/** The Favourite button on both pages. */
export const favLabel = (item) => (store.isFav(item) ? '♥  In Favourites' : '♡  Favourite');

// ------------------------------------------------------------ series page

/** SeriesActivity.parse (the info half): plot, meta, backdrop, cover, trailer. */
export function seriesInfo(r, series) {
  const info = r && typeof r.info === 'object' && r.info && !Array.isArray(r.info) ? r.info : null;
  if (!info) return { meta: series.info || '', plot: null, backdrop: null, cover: null, trailer: null };
  const plot = str(info, 'plot', null);
  const year = year4(str(info, 'releaseDate', str(info, 'releasedate', null)));
  const meta = joinNonEmpty(year, str(info, 'genre', null), rating(str(info, 'rating', null))) || '';
  const bd = Array.isArray(info.backdrop_path) && info.backdrop_path.length ? info.backdrop_path[0] : null;
  const cover = str(info, 'cover', null);
  let backdrop = null;
  if (bd !== null && bd !== undefined && String(bd) !== '') backdrop = String(bd);
  else if (!series.icon) backdrop = cover;
  const trailer = youtubeId(str(info, 'youtube_trailer', str(info, 'trailer', null)));
  return { meta, plot, backdrop, cover, trailer };
}

const toInt = (v, def) => {
  if (v === null || v === undefined) return def;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : def;
};

/**
 * SeriesActivity.parse (the episodes half) + addEpisodes: [{season, episodes}] by season number
 * (TreeMap order, so Specials (0) first), episodes in the provider's order. `episodes` may be an
 * object keyed by season or an array (index + 1); an episode's own `season` field wins.
 */
export function parseSeasons(r, series) {
  const map = new Map();
  const add = (arr, fallbackSeason) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((e, i) => {
      if (!e || typeof e !== 'object' || Array.isArray(e)) return;
      const season = 'season' in e ? toInt(e.season, fallbackSeason) : fallbackSeason;
      const id = e.id === undefined || e.id === null ? '' : String(e.id);
      if (id === '') return;
      const ep = {
        type: EPISODE, id,
        num: e.episode_num === undefined || e.episode_num === null ? String(i + 1) : String(e.episode_num),
        name: str(e, 'title', series.name),
        ext: e.container_extension === undefined || e.container_extension === null ? 'mp4' : String(e.container_extension),
        parentId: String(series.id), parentName: series.name,
      };
      if (series.icon) ep.parentIcon = series.icon;
      const ei = e.info && typeof e.info === 'object' && !Array.isArray(e.info) ? e.info : null;
      if (ei) {
        let d = str(ei, 'duration', null);
        if (d !== null && d.length === 8) d = shortDuration(d);
        if (d !== null) ep.duration = d;
        const p = str(ei, 'plot', null);
        if (p !== null) ep.plot = p;
        const img = str(ei, 'movie_image', null);
        if (img !== null) ep.icon = img;
      }
      if (!map.has(season)) map.set(season, []);
      map.get(season).push(ep);
    });
  };
  const eps = r ? r.episodes : null;
  if (Array.isArray(eps)) {
    eps.forEach((x, i) => {
      if (Array.isArray(x)) add(x, i + 1);
      else if (x && typeof x === 'object') add([x], 0);
    });
  } else if (eps && typeof eps === 'object') {
    for (const k of Object.keys(eps)) add(eps[k], toInt(k, 0));
  }
  return [...map.keys()].sort((a, b) => a - b).map((season) => ({ season, episodes: map.get(season) }));
}

/** The season pill text. */
export const seasonLabel = (n) => (n === 0 ? 'Specials' : `Season ${n}`);

/** SeriesActivity.lastWatched: the newest episode of this series in the watch history. */
export function lastWatched(series) {
  return store.history(false).find((h) => h.type === EPISODE && String(h.parentId) === String(series.id)) || null;
}

export function findEpisode(seasons, id) {
  for (const s of seasons) for (const e of s.episodes) if (e.id === String(id)) return e;
  return null;
}

/** SeriesActivity.shortName: "S2 · E5". */
export function shortName(seasons, ep) {
  const s = seasons.find((x) => x.episodes.includes(ep));
  return s ? `S${s.season} · E${ep.num}` : `E${ep.num}`;
}

/** SeriesActivity.buildButtons' first label: "▶  Play", or "▶  Resume S1 · E3" / "▶  Play S1 · E4". */
export function seriesPlayLabel(seasons, last) {
  if (!last) return '▶  Play';
  const match = findEpisode(seasons, last.id);
  return `▶  ${store.position(last) > 0 ? 'Resume ' : 'Play '}${match ? shortName(seasons, match) : ''}`.trim();
}

/** What Play plays: the last-watched episode, else the first episode of the first season. */
export function playTargetEpisode(seasons, last) {
  let t = last ? findEpisode(seasons, last.id) : null;
  if (!t && seasons.length) t = seasons[0].episodes[0];
  return t || null;
}

/** The season the page opens on: the last-watched episode's, else the first. */
export function startSeason(seasons, last) {
  if (!seasons.length) return null;
  const ep = last ? findEpisode(seasons, last.id) : null;
  const s = ep ? seasons.find((x) => x.episodes.includes(ep)) : null;
  return (s || seasons[0]).season;
}

/** SeriesActivity.buildEpisodes: one card's title, subtitle and progress. */
export function episodeCard(ep, series) {
  const pos = store.position(ep); const dur = store.duration(ep);
  return {
    image: ep.icon || series.icon || null,
    title: `${ep.num}.  ${ep.name}`,
    sub: pos > 0 && dur > 0 ? `${fmt(Math.max(0, dur - pos))} left` : (ep.duration || ''),
    progress: dur > 0 ? pos / dur : 0,
  };
}
