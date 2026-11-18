// Intros.java: where the recap, intro and end credits are in an episode, from TheIntroDB
// (theintrodb.org), a free community database looked up by the series' TMDB id, season and
// episode (and the episode's length, so it picks the right cut). When an episode isn't covered
// there's simply no Skip button for it.
import { getJson, imdbId } from './tmdb.js';

export const URL = 'https://api.theintrodb.org/v4/media';
export const SKIPDB = 'https://api.skipdb.tv/api/segments';
export const INTRODB = 'https://api.introdb.app/segments';

/** Times in ms, -1 where unknown; status says what happened (shown in the player's panel). */
const none = (status = '') => ({ introStart: -1, introEnd: -1, recapStart: -1, recapEnd: -1, creditsStart: -1, status });
export const NONE = Object.freeze(none());
export const hasIntro = (s) => !!s && s.introEnd > 0 && s.introEnd > s.introStart;
export const hasRecap = (s) => !!s && s.recapEnd > 0 && s.recapEnd > s.recapStart;

const CACHE = new Map();
/** Tests. */
export function _reset() { CACHE.clear(); }

const num = (o, a, b) => {
  const v = o[a] !== undefined ? o[a] : o[b];
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? -1 : Math.trunc(Number(v));
};

/**
 * The segment as [start, end] in ms: a missing start means from the beginning (0); a missing end,
 * to the end of the episode (-1). With several entries, the longest. Null if there isn't one.
 */
function longest(seg) {
  const list = Array.isArray(seg) ? seg : seg && typeof seg === 'object' ? [seg] : [];
  let best = null;
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    let start = num(o, 'start_ms', 'startMs'); let end = num(o, 'end_ms', 'endMs');
    if (start < 0 && end < 0) { // IntroDB gives seconds
      const sec = (a, b) => { const v = o[a] !== undefined ? o[a] : o[b]; return v === null || v === undefined || !Number.isFinite(Number(v)) ? -1 : Math.round(Number(v) * 1000); };
      start = sec('start_sec', 'start'); end = sec('end_sec', 'end');
    }
    if (start <= 0 && end <= 0) continue; // {0,0} / {null,null}: confirmed there isn't one
    if (start < 0) start = 0;
    if (!best || (end > 0 && best[1] > 0 && end - start > best[1] - best[0])) best = [start, end];
  }
  return best;
}

export const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Intros.get's parsing, on its own for tests. */
export function parse(body) {
  let o = body && typeof body === 'object' ? body : {};
  if (!('intro' in o) && o.data && typeof o.data === 'object') o = o.data;
  const s = none();
  const intro = longest(o.intro);
  if (intro) { s.introStart = intro[0]; s.introEnd = intro[1]; }
  const recap = longest(o.recap);
  if (recap) { s.recapStart = recap[0]; s.recapEnd = recap[1]; }
  const credits = longest(o.credits) || longest(o.outro); // SkipDB / IntroDB call them outro
  if (credits && credits[0] > 0) s.creditsStart = credits[0];
  return s;
}

/** The last lookup's result, for the player's panel. */
export let lastStatus = '';

/** Copies the intro and recap from `from` (and the credits if there were none). @returns true if it had any. */
function takeIntro(to, from) {
  if (!hasIntro(from) && !hasRecap(from)) {
    if (!(to.creditsStart > 0) && from.creditsStart > 0) to.creditsStart = from.creditsStart;
    return false;
  }
  Object.assign(to, { introStart: from.introStart, introEnd: from.introEnd, recapStart: from.recapStart, recapEnd: from.recapEnd });
  if (!(to.creditsStart > 0)) to.creditsStart = from.creditsStart;
  return true;
}

const segmentsOf = (o) => (o && typeof o.segments === 'object' && o.segments ? o.segments : o);

/**
 * TheIntroDB first (this cut, then the episode as a whole); with no intro or recap there, SkipDB
 * (skipdb.tv) and then IntroDB (introdb.app), which go by the IMDb id.
 */
export async function get(tmdbId, season, episode, durationMs = 0) {
  if (tmdbId == null) { lastStatus = "Couldn't find this show on TMDB"; return none(lastStatus); }
  if (!(season >= 0) || !(episode > 0)) { lastStatus = 'No season / episode number for this episode'; return none(lastStatus); }
  const k = `${tmdbId}:${season}:${episode}`;
  if (CACHE.has(k)) { lastStatus = CACHE.get(k).status; return CACHE.get(k); }
  const what = `TMDB ${tmdbId} S${season}E${episode}`;
  const base = `${URL}?tmdb_id=${encodeURIComponent(tmdbId)}&season=${season}&episode=${episode}`;
  let s = none(); let source = 'TheIntroDB'; let inTidb = true;
  try {
    s = parse(await getJson(`${base}${durationMs > 60000 ? `&duration_ms=${Math.floor(durationMs)}` : ''}`));
  } catch (e) {
    const m = String((e && e.message) || e);
    if (!/404/.test(m)) { lastStatus = `Couldn't reach TheIntroDB: ${m}`; return none(lastStatus); } // offline: asked again next time
    inTidb = false;
  }
  // Nothing for the intro or recap in this cut (the episode's length picks one): the intro is
  // usually at the same place in every cut, so take it from the episode as a whole
  if (inTidb && !hasIntro(s) && !hasRecap(s) && durationMs > 60000) {
    try { if (takeIntro(s, parse(await getJson(base)))) source = 'TheIntroDB, another cut'; } catch { /* keep this cut's */ }
  }
  // Still nothing: the other free databases, which go by the IMDb id
  if (!hasIntro(s) && !hasRecap(s)) {
    const imdb = await imdbId(tmdbId).catch(() => null);
    if (imdb) {
      const q = `?imdb_id=${imdb}&season=${season}&episode=${episode}`;
      try {
        if (takeIntro(s, parse(segmentsOf(await getJson(`${SKIPDB}${q}${durationMs > 60000 ? `&duration=${Math.floor(durationMs / 1000)}` : ''}`))))) source = 'SkipDB';
      } catch { /* not there */ }
      if (!hasIntro(s) && !hasRecap(s)) {
        try { if (takeIntro(s, parse(segmentsOf(await getJson(`${INTRODB}${q}`))))) source = 'IntroDB'; } catch { /* not there */ }
      }
    }
  }
  const parts = [];
  if (hasRecap(s)) parts.push(`recap ${clock(s.recapStart)}–${clock(s.recapEnd)}`);
  if (hasIntro(s)) parts.push(`intro ${clock(s.introStart)}–${clock(s.introEnd)}`);
  if (s.creditsStart > 0) parts.push(`credits ${clock(s.creditsStart)}`);
  if (hasIntro(s) || hasRecap(s)) parts.push(`(${source})`);
  else if (parts.length) parts.push('·  no intro or recap times in TheIntroDB, SkipDB or IntroDB yet');
  else parts.push(inTidb ? 'no times yet' : 'not in TheIntroDB, SkipDB or IntroDB');
  s.status = `${what}: ${parts.join('  ')}`;
  lastStatus = s.status;
  CACHE.set(k, s);
  return s;
}
