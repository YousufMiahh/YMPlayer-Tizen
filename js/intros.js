// Intros.java: where the intro and the end credits are in an episode, from TheIntroDB
// (theintrodb.org), a free community database looked up by the series' TMDB id, season and
// episode. Many popular shows are covered; when one isn't, there's simply no Skip Intro button.
import { getJson } from './tmdb.js';

export const URL = 'https://api.theintrodb.org/v4/media';

/** Times in ms, -1 where unknown. */
const none = () => ({ introStart: -1, introEnd: -1, creditsStart: -1 });
export const NONE = Object.freeze(none());
export const hasIntro = (s) => !!s && s.introEnd > 0 && s.introEnd > s.introStart;

const CACHE = new Map();
/** Tests. */
export function _reset() { CACHE.clear(); }

const ms = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? -1 : Math.trunc(Number(v)));

/** First segment as [start, end] (start null = from the beginning, end null = to the end → -1). */
function first(seg) {
  let o = null;
  if (Array.isArray(seg)) o = seg.length ? seg[0] : null;
  else if (seg && typeof seg === 'object') o = seg;
  if (!o || typeof o !== 'object') return null;
  const start = ms(o.start_ms); const end = ms(o.end_ms);
  if (start <= 0 && end <= 0) return null; // {0,0}: confirmed there isn't one
  return [start, end];
}

/** Intros.get's parsing, on its own for tests. */
export function parse(body) {
  let o = body && typeof body === 'object' ? body : {};
  if (!('intro' in o) && o.data && typeof o.data === 'object') o = o.data;
  const s = none();
  const intro = first(o.intro);
  if (intro) { s.introStart = intro[0] < 0 ? 0 : intro[0]; s.introEnd = intro[1]; }
  const credits = first(o.credits);
  if (credits && credits[0] > 0) s.creditsStart = credits[0];
  return s;
}

export async function get(tmdbId, season, episode) {
  if (tmdbId == null || !(season >= 0) || !(episode > 0)) return NONE;
  const k = `${tmdbId}:${season}:${episode}`;
  if (CACHE.has(k)) return CACHE.get(k);
  let s;
  try {
    s = parse(await getJson(`${URL}?tmdb_id=${encodeURIComponent(tmdbId)}&season=${season}&episode=${episode}`));
  } catch {
    return NONE; // not in the database, or offline: no button (asked again next time)
  }
  CACHE.set(k, s);
  return s;
}
