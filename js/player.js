// Single-engine video player on Tizen AVPlay (plays both .ts and HLS). Replaces the Android
// ExoPlayer+VLC pair. Events: ready | playing | ended | error | timeupdate (ms position).
import * as store from './store.js';
import * as api from './api.js';
import { LIVE } from './item.js';
import { shim } from './avplay-shim.js';

/** Real `webapis.avplay` on a TV; the shim in tests / desktop browsers. */
export function getAvplay() {
  return globalThis.webapis?.avplay ?? shim;
}

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

const otherFormat = (f) => (f === 'm3u8' ? 'ts' : 'm3u8');

function teardown(av) {
  try { av.stop(); } catch { /* already idle */ }
  try { av.close(); } catch { /* already closed */ }
}

function start(av, session, format) {
  const url = api.playUrl(session.item, format);
  session.format = format;
  const token = ++tokenSeq;
  session.token = token;
  const live = (fn) => (...a) => { if (s === session && session.token === token) fn(...a); };

  av.open(url);
  av.setListener({
    oncurrentplaytime: live((ms) => { session.pos = ms; emit('timeupdate', ms); }),
    onstreamcompleted: live(() => onCompleted(av, session)),
    onerror: live((type) => onFailure(av, session, type)),
  });
  av.setDisplayRect(0, 0, 1920, 1080);
  // The webview drops fetch-layer User-Agent; AVPlay's own streaming property carries it.
  try { av.setStreamingProperty('USER_AGENT', store.userAgent()); } catch { /* property unsupported */ }
  av.prepareAsync(live(() => {
    if (session.startMs > 0 && session.item.type !== LIVE) av.seekTo(session.startMs);
    av.play();
    emit('ready');
    emit('playing');
  }), live((err) => onFailure(av, session, err)));
}

function onFailure(av, session, err) {
  const live = session.item.type === LIVE;
  if (live && store.autoRecover() && !session.retried) {
    session.retried = true;
    teardown(av);
    start(av, session, otherFormat(session.format));
    return;
  }
  emit('error', err);
}

function onCompleted(av, session) {
  if (session.item.type !== LIVE) {
    // Finished: drop the resume point so it doesn't restart at the credits.
    store.setDuration(session.item, session.pos || av.getDuration());
    store.setPosition(session.item, 0);
    session.pos = 0;
  }
  emit('ended');
}

/** Open and start `item`. Live starts with the configured format; VOD resumes at startMs. */
export function open(item, { startMs = 0 } = {}) {
  const av = getAvplay();
  if (s) teardown(av);
  s = { item, startMs, pos: 0, retried: false, format: null, token: 0 };
  start(av, s, item.type === LIVE ? store.liveFormat() : 'ts');
}

export function play() { getAvplay().play(); emit('playing'); }
export function pause() { getAvplay().pause(); }
export function seek(ms) { getAvplay().seekTo(Math.max(0, Math.floor(ms))); }
export function setRate(r) { getAvplay().setSpeed(r); }

/** Stop and release. Persists resume position + duration for VOD/episodes (never live). */
export function stop() {
  if (!s) return;
  const av = getAvplay();
  const session = s;
  s = null;
  if (session.item.type !== LIVE) {
    let dur = 0;
    try { dur = av.getDuration(); } catch { /* not prepared */ }
    store.setDuration(session.item, dur);
    store.setPosition(session.item, session.pos);
  }
  teardown(av);
}
