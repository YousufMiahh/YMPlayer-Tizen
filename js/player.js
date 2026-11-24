// The one video engine on Tizen: Samsung AVPlay (plays .ts, HLS and VOD files). It plays the
// part of Android's Engine interface (Engine.java) that the player screen relies on; the retry
// ladder, freeze watchdog and overlays live in the screen (js/views/player.js), as in
// PlayerActivity.
//
// Events (on/off): ready | playing (bool) | buffering (bool) | ended | error ({ what }) |
// timeupdate (ms) | subtitle ({ text, duration }).
import * as store from './store.js';
import * as api from './api.js';
import { LIVE } from './item.js';
import { shim } from './avplay-shim.js';

export const AUDIO = 'AUDIO';
export const TEXT = 'TEXT';

export const UNAVAILABLE = 'Video player unavailable on this TV';

/**
 * Real `webapis.avplay` on a TV; the shim only where there is no Tizen at all (tests / desktop
 * browsers). On a TV without AVPlay (webapis.js did not load) there is no engine: null, never the
 * shim, which would "play" nothing behind a black screen.
 */
export function getAvplay() {
  const av = globalThis.webapis && globalThis.webapis.avplay;
  if (av) return av;
  return globalThis.tizen ? null : shim;
}

/** False on a TV whose AVPlay is missing: nothing can be played. */
export const available = () => getAvplay() !== null;

const listeners = new Map();
export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
}
export function off(event, cb) { listeners.get(event)?.delete(cb); }
function emit(event, data) {
  for (const cb of [...(listeners.get(event) ?? [])]) cb(data);
}

// Current playback session. `token` invalidates callbacks from a torn-down session.
let s = null;
let tokenSeq = 0;

function teardown(av) {
  try { av.stop(); } catch { /* already idle */ }
  try { av.close(); } catch { /* already closed */ }
}

const state = (av) => { try { return av.getState(); } catch { return 'NONE'; } };
const prepared = (av) => ['READY', 'PLAYING', 'PAUSED'].includes(state(av));

function start(av, session, startMs) {
  const url = api.playUrl(session.item, session.format);
  const token = ++tokenSeq;
  session.token = token;
  session.ready = false;
  session.buffering = false;
  const live = (fn) => (...a) => { if (s === session && session.token === token) fn(...a); };

  av.open(url);
  av.setListener({
    oncurrentplaytime: live((ms) => { session.pos = ms; emit('timeupdate', ms); }),
    onstreamcompleted: live(() => onCompleted(av, session)),
    onerror: live((type) => onFailure(session, type)),
    onbufferingstart: live(() => { session.buffering = true; emit('buffering', true); }),
    onbufferingprogress: () => {},
    onbufferingcomplete: live(() => { session.buffering = false; emit('buffering', false); }),
    onsubtitlechange: live((duration, text) => {
      if (session.subsOff) return;
      emit('subtitle', { text: String(text ?? ''), duration: Number(duration) || 0 });
    }),
    onevent: () => {},
    ondrmevent: () => {},
  });
  // Android draws the picture fitted inside the screen (PlayerView default / VLC best fit),
  // unless this channel / film / series has its own picture shape.
  applyPicture(av, session);
  // The webview drops fetch-layer User-Agent; AVPlay's own streaming property carries it.
  try { av.setStreamingProperty('USER_AGENT', store.userAgent()); } catch { /* property unsupported */ }
  session.buffering = true;
  emit('buffering', true);
  av.prepareAsync(live(() => {
    if (startMs > 0 && session.item.type !== LIVE) {
      try { av.seekTo(startMs); } catch { /* seek refused: plays from the start */ }
    }
    applyPreferredTracks(av, session);
    if (session.picture === PIC_FILL) applyPicture(av, session); // Fill needs the video's own shape, known now
    try { av.play(); } catch (e) { onFailure(session, e && (e.message || e.name)); return; }
    session.ready = true;
    session.buffering = false;
    emit('buffering', false);
    emit('ready');
    emit('playing', true);
  }), live((err) => onFailure(session, err && (err.message || err.name || err))));
}

function onFailure(session, what) {
  session.ready = false;
  session.buffering = false;
  emit('buffering', false);
  emit('error', { what: String(what || 'PLAYER_ERROR_UNKNOWN') });
}

/**
 * The stream ended. A film or episode that ends well before its end didn't finish: the
 * connection dropped (PlayerActivity.onEnded). That is reported as { early: true, position } and
 * the resume point is left alone, so the screen can reconnect where it stopped.
 */
function onCompleted(av, session) {
  if (session.item.type !== LIVE) {
    let len = 0;
    try { len = Number(av.getDuration()) || 0; } catch { /* not prepared */ }
    let at = session.pos;
    try { const t = Number(av.getCurrentTime()); if (Number.isFinite(t) && t > 0) at = t; } catch { /* use the last tick */ }
    if (len > 0 && at > 0 && at < len * 0.9 && at < len - CREDITS_MS) {
      store.setDuration(session.item, len);
      session.pos = at;
      emit('ended', { early: true, position: at });
      return;
    }
    // Finished: drop the resume point so it doesn't restart at the credits. The duration comes
    // from the player only (a stream that ends before any time tick must not store its start
    // point, or a 0, as its length).
    let d = 0;
    try { d = av.getDuration(); } catch { /* not prepared */ }
    if (d > 0) store.setDuration(session.item, d);
    // Watched, which also clears the resume point. (A stream that ends before it ever played
    // wasn't watched: only its resume point goes.)
    if (at > 0 || len <= 0) store.setWatched(session.item, true); else store.setPosition(session.item, 0);
    session.pos = 0;
    session.finished = true;
  }
  emit('ended', { early: false, position: 0 });
}

// ---------------------------------------------------------------- picture shape

export const PIC_FIT = 0;
export const PIC_FILL = 1;
export const PIC_STRETCH = 2;
export const PIC_16_9 = 3;
export const PIC_4_3 = 4;
const SCREEN_W = 1920; const SCREEN_H = 1080;

/** The playing video's own width / height, or 0 when the TV doesn't say. */
function videoAspect(av) {
  try {
    const v = (av.getCurrentStreamInfo() || []).find((t) => t.type === 'VIDEO');
    const info = v ? parse(v.extra_info) : {};
    const w = Number(info.Width); const h = Number(info.Height);
    return w > 0 && h > 0 ? w / h : 0;
  } catch { return 0; }
}

/**
 * Where the picture goes for a shape: [x, y, w, h, method].
 * Fit letter-boxes; Stretch fills the screen; 16:9 and 4:3 are a box of that shape with the
 * picture stretched into it; Fill zooms until the screen is covered (the edges are cropped),
 * which needs the video's own shape (aspect), else it falls back to Fit until that is known.
 */
export function pictureRect(mode, aspect = 0) {
  const LETTER = 'PLAYER_DISPLAY_MODE_LETTER_BOX'; const FULL = 'PLAYER_DISPLAY_MODE_FULL_SCREEN';
  if (mode === PIC_STRETCH || mode === PIC_16_9) return [0, 0, SCREEN_W, SCREEN_H, FULL];
  if (mode === PIC_4_3) { const w = Math.round(SCREEN_H * 4 / 3); return [Math.round((SCREEN_W - w) / 2), 0, w, SCREEN_H, FULL]; }
  if (mode === PIC_FILL && aspect > 0) {
    const screen = SCREEN_W / SCREEN_H;
    if (Math.abs(aspect - screen) < 0.01) return [0, 0, SCREEN_W, SCREEN_H, FULL];
    if (aspect > screen) { const w = Math.round(SCREEN_H * aspect); return [Math.round((SCREEN_W - w) / 2), 0, w, SCREEN_H, FULL]; }
    const h = Math.round(SCREEN_W / aspect);
    return [0, Math.round((SCREEN_H - h) / 2), SCREEN_W, h, FULL];
  }
  return [0, 0, SCREEN_W, SCREEN_H, LETTER];
}

function applyPicture(av, session) {
  const mode = session.picture || PIC_FIT;
  const [x, y, w, h, method] = pictureRect(mode, mode === PIC_FILL ? videoAspect(av) : 0);
  try {
    av.setDisplayRect(x, y, w, h);
  } catch { // a box bigger than the screen was refused: fill the screen the plain way
    try { av.setDisplayRect(0, 0, SCREEN_W, SCREEN_H); } catch { /* not now */ }
  }
  try { av.setDisplayMethod(method); } catch { /* older firmware */ }
}

/** Engine.setPicture: this session's picture shape, now and whenever the stream is reopened. */
export function setPicture(mode) {
  if (!s) return;
  s.picture = mode;
  applyPicture(getAvplay(), s);
}

/**
 * Open and start `item` (ExoEngine.load). Live uses `format` (default: the Settings format); VOD
 * starts at startMs. Any previous session is saved and released first.
 */
export function open(item, { startMs = 0, format, picture = PIC_FIT } = {}) {
  const av = getAvplay();
  if (s) stop();
  if (!av) { // say so on screen (the player's error state) rather than fail silently
    console.error('webapis.avplay is missing: was $WEBAPIS/webapis/webapis.js loaded?');
    emit('buffering', false);
    emit('error', { what: UNAVAILABLE, fatal: true });
    return;
  }
  const live = item.type === LIVE;
  s = {
    item, pos: live ? 0 : startMs, format: live ? (format || store.liveFormat()) : 'ts',
    picture, token: 0, ready: false, buffering: false, subsOff: store.subtitleLanguage() === 'off', seeking: false, pendingSeek: null,
  };
  start(av, s, live ? 0 : startMs);
}

/** Engine.retry: the same stream again (VOD from where it was). */
export function retry() {
  if (!s) return;
  const av = getAvplay();
  const at = s.item.type === LIVE ? 0 : position();
  teardown(av);
  start(av, s, at);
}

export const current = () => (s ? s.item : null);
export const format = () => (s ? s.format : null);
export const isReady = () => !!s && s.ready && prepared(getAvplay());
export const isPlaying = () => !!s && s.ready && state(getAvplay()) === 'PLAYING';
export const isBuffering = () => !!s && s.buffering;

export function play() {
  if (!s) return;
  const av = getAvplay();
  if (state(av) !== 'READY' && state(av) !== 'PAUSED') return;
  av.play();
  emit('playing', true);
}
export function pause() {
  if (!s) return;
  const av = getAvplay();
  if (state(av) !== 'PLAYING') return;
  av.pause();
  emit('playing', false);
}

/** Milliseconds into the stream. */
export function position() {
  if (!s) return 0;
  const av = getAvplay();
  if (!prepared(av)) return s.pos;
  try {
    const t = Number(av.getCurrentTime());
    return Number.isFinite(t) && t >= 0 ? t : s.pos;
  } catch { return s.pos; }
}

/** Milliseconds, or 0 if unknown / live. */
export function duration() {
  if (!s || s.item.type === LIVE) return 0;
  try { const d = Number(getAvplay().getDuration()); return d > 0 ? d : 0; } catch { return 0; }
}

/** seekTo, one at a time: AVPlay refuses a seek while one is running, so the last asked wins. */
export function seek(ms) {
  if (!s) return;
  const target = Math.max(0, Math.floor(ms));
  if (s.seeking) { s.pendingSeek = target; return; }
  const av = getAvplay();
  if (!prepared(av)) return;
  const session = s;
  session.seeking = true;
  session.pos = target;
  const done = () => {
    if (s !== session) return;
    session.seeking = false;
    if (session.pendingSeek != null) { const n = session.pendingSeek; session.pendingSeek = null; seek(n); }
  };
  try { av.seekTo(target, done, done); } catch { done(); }
}

// ---------------------------------------------------------------- tracks (ExoEngine.tracks/select)

const parse = (x) => { try { return typeof x === 'string' ? JSON.parse(x) : (x || {}); } catch { return {}; } };

let names = null;
/** Locale.getDisplayLanguage(Locale.UK) for an ISO 639 code ("eng" → "English"). */
export function languageName(code) {
  if (!code) return '';
  try {
    names = names || new Intl.DisplayNames(['en-GB'], { type: 'language' });
    const n = names.of(code);
    return n && n !== code && n !== 'root' ? n : code;
  } catch { return code; }
}

/** ExoEngine.trackName for an AVPlay track. */
export function trackLabel(type, info, n) {
  const lang = type === TEXT ? info.track_lang : info.language;
  let name;
  if (info.label && String(info.label).trim()) name = String(info.label).trim();
  else if (lang && lang !== 'und') name = languageName(lang);
  else name = `${type === AUDIO ? 'Audio' : 'Subtitles'} ${n}`;
  const extra = [];
  if (type === AUDIO) {
    const f = String(info.fourCC || '').toLowerCase();
    if (f.includes('eac3') || f.includes('ec-3') || f.includes('ec3')) extra.push('Dolby Digital+');
    else if (f.includes('ac3') || f.includes('ac-3')) extra.push('Dolby Digital');
    else if (f.includes('dts')) extra.push('DTS');
    else if (f.includes('aac') || f.includes('mp4a')) extra.push('AAC');
    const ch = Number(info.channels);
    if (ch === 8) extra.push('7.1'); else if (ch === 6) extra.push('5.1'); else if (ch === 2) extra.push('Stereo'); else if (ch === 1) extra.push('Mono');
  }
  return [name, ...extra].join('  ·  ');
}

function allTracks(av) {
  try { return av.getTotalTrackInfo() || []; } catch { return []; }
}
function selectedIndex(av, type) {
  try {
    const cur = (av.getCurrentStreamInfo() || []).find((t) => t.type === type);
    return cur ? Number(cur.index) : null;
  } catch { return null; }
}

/** Engine.tracks: [{ type, label, language, selected, index }]. */
export function tracks(type) {
  if (!s) return [];
  const av = getAvplay();
  if (!prepared(av)) return [];
  const sel = selectedIndex(av, type);
  const textOff = type === TEXT && subtitlesAreOff();
  let n = 0;
  return allTracks(av).filter((t) => t.type === type).map((t) => {
    const info = parse(t.extra_info);
    const language = (type === TEXT ? info.track_lang : info.language) || '';
    return { type, label: trackLabel(type, info, ++n), language, selected: !textOff && Number(t.index) === sel, index: Number(t.index) };
  });
}

/** Engine.select. Picking a subtitle track turns subtitles back on. */
export function select(track) {
  if (!s) return;
  const av = getAvplay();
  if (track.type === TEXT) {
    s.subsOff = false;
    try { av.setSilentSubtitle(false); } catch { /* unsupported */ }
  }
  try { av.setSelectTrack(track.type, track.index); } catch { /* not in this state */ }
  emit('tracks');
}

/** Engine.subtitlesOff. */
export function subtitlesOff() {
  if (!s) return;
  s.subsOff = true;
  try { getAvplay().setSilentSubtitle(true); } catch { /* unsupported */ }
  emit('subtitle', { text: '', duration: 0 });
  emit('tracks');
}

export function subtitlesAreOff() {
  if (!s) return true;
  if (s.subsOff) return true;
  const av = getAvplay();
  return !prepared(av) || selectedIndex(av, TEXT) == null;
}

/** Same language, whichever ISO code form each side uses ("en" / "eng" / "English"). */
export function sameLanguage(a, b) {
  if (!a || !b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const na = languageName(a); const nb = languageName(b);
  return !!na && na.toLowerCase() === nb.toLowerCase();
}

/** ExoEngine constructor: preferred subtitle / audio language, "off" honoured. */
function applyPreferredTracks(av, session) {
  const sl = store.subtitleLanguage();
  const al = store.audioLanguage();
  const list = allTracks(av).map((t) => ({ ...t, info: parse(t.extra_info) }));
  if (sl === 'off') {
    try { av.setSilentSubtitle(true); } catch { /* unsupported */ }
    session.subsOff = true;
  } else if (sl) {
    const t = list.find((x) => x.type === TEXT && sameLanguage(x.info.track_lang, sl));
    if (t) { try { av.setSelectTrack(TEXT, Number(t.index)); } catch { /* not now */ } }
  }
  if (al) {
    const t = list.find((x) => x.type === AUDIO && sameLanguage(x.info.language, al));
    if (t && selectedIndex(av, AUDIO) !== Number(t.index)) { try { av.setSelectTrack(AUDIO, Number(t.index)); } catch { /* not now */ } }
  }
}

// ---------------------------------------------------------------- stop

/** Less than this left: the credits, so it counts as finished (and the next episode is up next). */
export const CREDITS_MS = 3 * 60000;
/** Finished (into the credits): under 3 minutes left (or 97% of the way through something short). */
export const finishedAt = (p, d) => d > 0 && (p > d - CREDITS_MS || p >= d * 0.97);

/** Stop and release. Persists resume position + duration for VOD/episodes (never live). */
export function stop() {
  if (!s) return;
  const av = getAvplay();
  const session = s;
  const p = position();
  s = null;
  if (session.item.type !== LIVE && !session.finished) {
    let dur = 0;
    try { dur = prepared(av) ? Number(av.getDuration()) || 0 : 0; } catch { /* not prepared */ }
    // PlayerActivity.savePosition: within the last minute, or 90% of the way through (into the
    // credits), counts as watched (off Continue Watching, ✓ on its card); otherwise only a point
    // past 10 s is kept. A 0 never erases a resume point.
    if (dur > 0) store.setDuration(session.item, dur);
    if (finishedAt(p, dur)) store.setWatched(session.item, true); // also clears the resume point
    else if (p > 10000) store.setPosition(session.item, p);
  }
  teardown(av);
}
