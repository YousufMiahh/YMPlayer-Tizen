// Full-screen player (PlayerActivity.java) for live channels, films and episodes, on AVPlay.
//
// Live TV: ▲/▼ and CH+/CH− change channel (the banner at once, the stream 350 ms after the last
// press), OK the Channels list, Hold OK favourite / subtitles & audio, ◀ ▶ INFO the banner.
// Films & episodes: OK play/pause, ◀ back 5 s, ▶ forward 10 s (presses add up), ▼ scrub, Hold OK
// subtitles, audio & picture, Skip Intro during an episode's opening titles (OK), and the Next
// Episode / Next in Queue card near the end (when the credits start, if the intro database knows).
//
// Params: { queue: Item[], index } (Open.play), or the older shapes { channels, index } (live)
// and { item, queue?, index? } (VOD).
import * as store from '../store.js';
import * as api from '../api.js';
import * as player from '../player.js';
import { router } from '../router.js';
import { LIVE, EPISODE, SERIES, key } from '../item.js';
import * as tmdb from '../tmdb.js';
import * as intros from '../intros.js';
import { followingEpisodes } from '../detail.js';
import { u, HOLD_OK, LONG_PRESS_MS } from '../ui/theme.js';
import { toast } from '../ui/toast.js';
import { createSheet } from '../ui/sheet.js';
import { createVList } from '../ui/vlist.js';
import { createGlider } from '../ui/glider.js';
import { rowCell } from '../ui/widgets.js';
import { createSeekBar } from '../ui/seekbar.js';
import { createNextUpCard } from '../ui/nextup.js';
import { createSubtitleOverlay, SUB_SIZE_NAMES } from '../ui/subtitles.js';
import * as coach from '../ui/coach.js';
import { fmt, joinNonEmpty, favToast } from '../home-rows.js';

export const BACK_MS = 5000;
export const FORWARD_MS = 10000;
export const VOD_HINT = `◀  5 sec      ▶  10 sec      OK  Play / Pause      ▲  More      ▼  Settings      ${HOLD_OK}  Subtitles, Audio & Picture`;
export const SETTINGS_HINT = 'OK  Subtitles, Audio & Picture      ▲  Scrub along the bar      Back  Hide';
export const SCRUB_HINT = '◀ ▶  Move (hold to go faster)      OK  Play from here      Back  Cancel';
export const LIVE_HINT = `▲▼  Change channel      OK  Channel list      ${HOLD_OK}  Favourite, subtitles, audio & picture`;
export const CHANNELS_HINT = `${HOLD_OK}  Add or remove favourite`;
export const OVERLAY_MS = 4000;
export const BANNER_MS = 6000;
export const BURST_MS = 1200;
export const STATUS_MS = 2500;
export const ZAP_MS = 350;
export const SCRUB_COMMIT_MS = 1000;
export const TICK_MS = 500;
export const WATCHDOG_MS = 1000;
export const RETRY_MS = 1500;
export const END_RETRIES = 3;       // a stream that ends early is reconnected this many times
export const GIVE_UP_MS = 2500;     // "The stream stopped": then back
export const SKIP_LABEL = 'OK   Skip Intro';
/** Netflix-style top row: Back, Play From Beginning, Next Episode, Episodes, Settings. */
export const TOP_BACK = 0; export const TOP_RESTART = 1; export const TOP_NEXT = 2; export const TOP_EPISODES = 3; export const TOP_SETTINGS = 4;
const TOP_NAMES = ['Back', 'Play From Beginning', 'Next Episode', 'Episodes', 'Settings'];
const TOP_ICONS = [
  '<path d="M20 12H5M11 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/>',
  '<path d="M6 5.5v13l9.5-6.5z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M18.5 5.5v13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  '<rect x="3" y="7" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7 4h12a2 2 0 0 1 2 2v9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
];
export const SKIP_RECAP_LABEL = 'OK   Skip Recap';
export const FADE_IN = 200;
export const FADE_OUT = 250;
export const COACH_LIVE = { title: 'Watching Live TV', body: `▲ ▼  Change channel\nOK  Channel list\n◀ ▶  Channel info\n${HOLD_OK}  Favourite, subtitles & audio\nBack  Leave` };
export const COACH_VOD = {
  title: 'Watching films & series',
  body: `OK  Pause / play\n◀  Back 5 seconds     ▶  Forward 10 seconds (press again to go further)\n▲  Back, Play From Beginning, Next Episode, Episodes\n▼  Settings; ▲ from there to scrub along the bar (◀ ▶, OK to jump there)\n${HOLD_OK}  Subtitles, audio, picture & favourite\nBack  Leave — your place is saved`,
};

export const KEY = {
  LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27,
  PLAY_PAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, REWIND: 412, FAST_FORWARD: 417,
  CH_UP: 427, CH_DOWN: 428, INFO: 457, MENU: 10133,
};

const CHANNEL_ROW_H = u(14 * 2 + 44);
const ROW_GAP = u(2);

/** Scrub step for this repeat count (PlayerActivity.moveScrub): max(10 s, d/120) at 1x/2x/4x/8x. */
export function scrubStep(d, repeat) {
  const base = Math.max(10000, Math.floor(d / 120));
  const speed = repeat < 3 ? 1 : repeat < 8 ? 2 : repeat < 16 ? 4 : 8;
  return Math.floor(base * speed);
}

/** The seek bubble text: "+10 sec", "−20 sec", "+1:30" from a minute. */
export function burstText(burst) {
  const s = Math.floor(Math.abs(burst) / 1000);
  return `${burst < 0 ? '−' : '+'}${s >= 60 ? fmt(Math.abs(burst)) : `${s} sec`}`;
}

/** The scrub time over the knob: "H:MM:SS   +M:SS" (the delta from 1 s). */
export function scrubText(scrubPos, pos) {
  const delta = scrubPos - pos;
  return fmt(scrubPos) + (Math.abs(delta) >= 1000 ? `   ${delta < 0 ? '−' : '+'}${fmt(Math.abs(delta))}` : '');
}

/** Normalise the router params to Open.play's (queue, index). */
export function queueOf(params = {}) {
  if (Array.isArray(params.queue) && params.queue.length) {
    let i = params.index ?? (params.item ? params.queue.findIndex((e) => String(e.id) === String(params.item.id)) : 0);
    if (i < 0 || i >= params.queue.length) i = 0;
    return { queue: params.queue, index: i };
  }
  if (Array.isArray(params.channels) && params.channels.length) {
    const i = params.index || 0;
    return { queue: params.channels, index: i >= 0 && i < params.channels.length ? i : 0 };
  }
  if (params.item) return { queue: [params.item], index: 0 };
  return { queue: [], index: 0 };
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function playerView() {
  let root; let host; let queue = []; let index = 0;
  let alive = false;
  // overlays
  let setBtn; let setLabel; let setOn = false; let setOk = false;
  let vod; let vodSub; let vodTitle; let bubble; let scrubRow; let scrubCard; let scrubTime; let vodBar; let timeLeft; let timeRight; let vodHint;
  let center; let banner; let liveLogo; let liveNum; let liveName; let liveNow; let liveTime; let liveBar; let liveNext;
  let spinner; let errorEl; let statusEl; let nextCard; let subs; let skipBtn;
  let topEl; let topRow; let topLabel; let topInfo; let topTitle; let topSub; let epSheet;
  let topShown = []; let topFocus = -1; let topOk = false; let nextName = 'Next Episode';
  let chSheet; let chList; let chGlider; let playingId = null; let trSheet; let trList;
  let favIds = new Set(); // the favourite channels, read once per paint of the Channels list
  // state
  let liveFormat = store.liveFormat();
  let retries = 0; let triedAltFormat = false; let firstStart = true;
  let seekTarget = -1; let burst = 0;
  let lastPos = -1; let stallTicks = 0; let recoveries = 0; let buffering = false;
  let scrubbing = false; let scrubPos = 0;
  let nextShown = false; let nextDismissed = false;
  let resumeMs = 0;       // where you were when the app went into the background
  let endRetries = 0;     // stream ended early: reconnect attempts for this item
  let segments = null; let skipShown = false; // the intro database's answer for this episode
  let picture = 0;        // this channel / film / series' picture shape
  let okDown = false; let okHeld = false; let okAt = 0; let okTimer = null;
  let panelOk = null; // OK pressed inside a panel: { at, held }
  let heldKey = null; let repeatCount = 0;
  const timers = {};
  let ticker = null; let watchdog = null; let cancelCoach = () => {}; let rebuildTimer = null;
  const handlers = [];

  const current = () => queue[index];
  const isLive = () => current() && current().type === LIVE;
  const shown = (e) => !!e && !e.hidden && !e.classList.contains('out');
  const errorVisible = () => !errorEl.hidden;
  const panelOpen = () => chSheet.isOpen() || trSheet.isOpen() || (epSheet && epSheet.isOpen());
  const later = (name, fn, ms) => { clearTimeout(timers[name]); timers[name] = setTimeout(() => { timers[name] = null; if (alive) fn(); }, ms); };
  const cancel = (name) => { clearTimeout(timers[name]); timers[name] = null; };

  // ------------------------------------------------------------ overlay construction

  /** PlayerActivity.fade: in over 200 ms, out over 250 ms (then GONE). */
  const fadeTimers = new Map();
  function fade(e, show) {
    if (!e) return;
    if (e === vod && topEl) { // the top row comes and goes with the bottom controls
      if (!show) leaveTop();
      fade(topEl, show);
    }
    clearTimeout(fadeTimers.get(e));
    if (show) {
      if (e.hidden) { e.classList.add('out'); e.hidden = false; void e.offsetWidth; }
      e.classList.remove('out');
    } else if (!e.hidden) {
      e.classList.add('out');
      fadeTimers.set(e, setTimeout(() => { e.hidden = true; }, FADE_OUT));
    }
  }

  function build() {
    root.innerHTML = '';
    const p = el('div', 'player');
    host = el('div', 'pl-host');
    host.tabIndex = -1;
    p.appendChild(host);
    subs = createSubtitleOverlay(p);

    spinner = el('div', 'pl-spinner'); spinner.hidden = true; p.appendChild(spinner);

    // VOD overlay (buildVodOverlay)
    vod = el('div', 'pl-vod pl-fade'); vod.hidden = true;
    vodSub = el('div', 'pl-vod-sub');
    vodTitle = el('div', 'pl-vod-title');
    bubble = el('div', 'pl-bubble'); bubble.style.visibility = 'hidden';
    scrubRow = el('div', 'pl-scrub-row'); scrubRow.hidden = true;
    scrubCard = el('div', 'pl-scrub-card');
    scrubTime = el('div', 'pl-scrub-time');
    scrubCard.appendChild(scrubTime); scrubRow.appendChild(scrubCard);
    vodBar = createSeekBar({ height: 28, barHeight: 7 });
    vodBar.el.classList.add('pl-vod-bar');
    const times = el('div', 'pl-times');
    timeLeft = el('div', 'pl-time-left'); timeRight = el('div', 'pl-time-right');
    times.append(timeLeft, timeRight);
    vodHint = el('div', 'pl-hint pl-vod-hint', VOD_HINT);
    // ▼ while playing: a settings button under the bar (Netflix-style)
    const controls = el('div', 'pl-controls');
    setBtn = el('div', 'pl-set-btn');
    setBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TOP_ICONS[TOP_SETTINGS]}</svg>`;
    setLabel = el('div', 'pl-set-label', 'SUBTITLES, AUDIO & PICTURE');
    controls.append(setBtn, setLabel);
    // The title shows at the top right while paused, not above the bar as well
    vodSub.hidden = true; vodTitle.hidden = true;
    vod.append(vodSub, vodTitle, bubble, scrubRow, vodBar.el, times, controls, vodHint);
    p.appendChild(vod);

    // Top row (Netflix): Back, Play From Beginning, Next Episode, Episodes, Settings; title at the right when paused
    topEl = el('div', 'pl-top pl-fade'); topEl.hidden = true;
    const topLeft = el('div', 'pl-top-left');
    topRow = el('div', 'pl-top-row');
    topLabel = el('div', 'pl-top-label');
    topLeft.append(topRow, topLabel);
    topInfo = el('div', 'pl-top-info'); topInfo.hidden = true;
    topTitle = el('div', 'pl-top-title'); topSub = el('div', 'pl-top-sub');
    topInfo.append(topTitle, topSub);
    topEl.append(topLeft, topInfo);
    p.appendChild(topEl);

    nextCard = createNextUpCard(p);
    nextCard.el.classList.add('pl-fade');
    nextCard.credits.addEventListener('click', () => watchCredits());
    nextCard.next.addEventListener('click', () => playNext());

    skipBtn = el('div', 'pl-skip pl-fade', SKIP_LABEL); skipBtn.hidden = true; p.appendChild(skipBtn);

    center = el('div', 'pl-center'); center.hidden = true;
    center.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><path class="pl-tri" d="M36.96 21.6 L98.4 60 L36.96 98.4 Z"/>'
      + '<rect class="pl-bar" x="29.28" y="21.6" width="17.28" height="76.8" rx="5.76"/><rect class="pl-bar" x="73.44" y="21.6" width="17.28" height="76.8" rx="5.76"/></svg>';
    p.appendChild(center);

    // Live banner (buildLiveBanner)
    banner = el('div', 'pl-banner pl-fade'); banner.hidden = true;
    const logoBox = el('div', 'pl-logo-box');
    liveLogo = el('img', 'pl-logo'); liveLogo.alt = ''; liveLogo.hidden = true;
    liveLogo.onerror = () => { liveLogo.hidden = true; };
    liveLogo.onload = () => { liveLogo.hidden = false; };
    logoBox.appendChild(liveLogo);
    const col = el('div', 'pl-banner-col');
    const nameRow = el('div', 'pl-name-row');
    liveNum = el('span', 'pl-live-num'); liveName = el('span', 'pl-live-name');
    nameRow.append(liveNum, liveName);
    liveNow = el('div', 'pl-live-now');
    const tr = el('div', 'pl-time-row');
    liveTime = el('span', 'pl-live-time');
    liveBar = createSeekBar({ height: 5 });
    liveBar.el.classList.add('pl-live-bar');
    tr.append(liveTime, liveBar.el);
    liveNext = el('div', 'pl-live-next');
    col.append(nameRow, liveNow, tr, liveNext, el('div', 'pl-hint pl-live-hint', LIVE_HINT));
    banner.append(logoBox, col);
    p.appendChild(banner);

    errorEl = el('div', 'pl-error'); errorEl.hidden = true; p.appendChild(errorEl);
    statusEl = el('div', 'pl-status'); statusEl.hidden = true; p.appendChild(statusEl);
    root.appendChild(p);

    // Channels (buildChannelPanel)
    chSheet = createSheet({ side: 'left', width: 560, title: 'Channels', hint: CHANNELS_HINT, parent: p, onBack: back });
    chSheet.el.classList.add('pl-channels');
    chList = createVList({
      scroller: chSheet.body, pitch: CHANNEL_ROW_H + ROW_GAP, cellHeight: CHANNEL_ROW_H,
      render: channelCell, onSelect: () => chGlider && chGlider.update(),
      viewportHeight: 1080 - u(80 + 44 + 60),
    });
    chGlider = createGlider(chList.body, { rows: '.row-cell' });
    // Subtitles & Audio (buildTrackPanel)
    trSheet = createSheet({ side: 'right', width: 520, parent: p, onBack: back });
    trSheet.el.classList.add('pl-tracks');
    trList = trSheet.body;
    epSheet = createSheet({ side: 'right', width: 640, title: 'Episodes', parent: p, onBack: back });
    epSheet.el.classList.add('pl-episodes');
  }

  function channelCell(i, cell) {
    const it = queue[i];
    let trail = favIds.has(String(it.id)) ? '♥' : '';
    const playing = playingId != null && String(playingId) === String(it.id);
    if (playing) trail = '▶';
    if (cell && cell.dataset.id === String(it.id)) {
      cell.classList.toggle('active', playing);
      let t = cell.querySelector('.rc-trail');
      if (trail && !t) { t = el('span', 'rc-trail'); cell.appendChild(t); }
      if (t) { t.textContent = trail; t.hidden = !trail; }
      return cell;
    }
    const b = rowCell({ num: it.num == null || it.num === '' ? String(i + 1) : String(it.num), logo: it.icon || '', title: it.name || '', trail, active: playing });
    b.classList.add('channel');
    b.dataset.id = String(it.id);
    b.tabIndex = -1;
    const img = b.querySelector('img');
    if (img) img.onerror = () => img.remove();
    return b;
  }

  // ------------------------------------------------------------ playback

  function play(resume) {
    if (!alive) return;
    if (scrubbing) cancelScrub();
    hideNextCard();
    nextDismissed = false;
    if (!resume) endRetries = 0;
    showSkip(false);
    const it = current();
    picture = store.picture(it); // each channel / film / series has its own
    let start = 0;
    const back = resumeMs;
    resumeMs = 0;
    if (!isLive() && resume) {
      const pos = back > 10000 ? back : store.position(it);
      if (pos > 10000) {
        start = pos;
        if (firstStart) toast(`Resuming from ${fmt(pos)}`);
      }
    }
    load(start);
    store.addHistory(it);
    loadSegments();
    extendSeries();
    if (isLive()) {
      fade(vod, false);
      showBanner();
    } else {
      fade(banner, false);
      vodTitle.textContent = it.name || '';
      const ep = it.type === EPISODE;
      vodSub.textContent = ep ? joinNonEmpty(it.parentName, `Episode ${it.num}`) : '';
      vodSub.hidden = !ep;
      topTitle.textContent = ep ? (it.parentName || it.name || '') : (it.name || '');
      topSub.textContent = ep ? `${it.season >= 0 ? `S${it.season}: ` : ''}E${it.num} “${it.name || ''}”` : '';
      topSub.hidden = !ep;
      topInfo.hidden = true;
      refreshTop();
      showOverlay(true);
    }
  }

  function load(startMs) {
    errorEl.hidden = true;
    cancel('retry');
    lastPos = -1;
    stallTicks = 0;
    subs.clear();
    player.open(current(), { startMs, format: liveFormat, picture });
  }

  function resetLiveState() {
    retries = 0;
    triedAltFormat = false;
    recoveries = 0;
    liveFormat = store.liveFormat();
  }

  function onReady() {
    retries = 0;
    errorEl.hidden = true;
  }

  function onEnded({ early = false, position = 0 } = {}) {
    if (isLive()) { play(false); return; } // the server dropped the stream: reconnect
    // Ended well before the end: the connection dropped, it didn't finish. Pick up where it stopped.
    if (early) {
      if (endRetries++ < END_RETRIES) {
        status('Reconnecting…');
        load(position);
      } else {
        store.setPosition(current(), position);
        status('The stream stopped — your place is saved');
        later('giveUp', finish, GIVE_UP_MS);
      }
      return;
    }
    if (upNext()) playNext(true); // next episode, or the next thing in your Queue
    else {
      finishedCurrent();
      finish();
    }
  }

  function finish() {
    alive = false;
    router.back();
  }

  function onError({ what, fatal } = {}) {
    if (fatal) { // no video engine on this TV: retrying or another format cannot help
      cancel('retry');
      errorEl.textContent = `${what}\n\nBack  Exit`;
      errorEl.hidden = false;
      spinner.hidden = true;
      return;
    }
    if (retries < 2) {
      retries++;
      status('Reconnecting…');
      later('retry', () => player.retry(), RETRY_MS);
      return;
    }
    if (isLive() && !triedAltFormat) { // try .m3u8 instead of .ts (or the other way round)
      triedAltFormat = true;
      retries = 0;
      liveFormat = liveFormat === 'ts' ? 'm3u8' : 'ts';
      load(0);
      return;
    }
    // (Android tries the other engine for films here; AVPlay is the only engine.)
    errorEl.textContent = `Can't play this ${isLive() ? 'channel' : 'video'}\n${what || 'PLAYER_ERROR_UNKNOWN'}`
      + `\n\nOK  Try again      Back  Exit${isLive() ? '      ▲▼  Other channel' : ''}`;
    errorEl.hidden = false;
    spinner.hidden = true;
  }

  function onPlayingChanged(playing) {
    center.classList.toggle('paused', !playing);
    if (isLive()) return;
    if (topInfo) topInfo.hidden = !(!playing && player.isReady()); // the title shows at the top right while paused
    if (!playing && player.isReady()) {
      center.hidden = false;
      showOverlay(false);
    } else {
      center.hidden = true;
      if (playing && shown(vod)) later('hideOverlay', () => { if (topFocus < 0) fade(vod, false); }, OVERLAY_MS);
    }
  }

  function onBuffering(on) {
    buffering = on;
    spinner.hidden = !on;
  }

  /** Frozen-picture detector: playing, but the clock hasn't moved for 3 s (no frame counter on AVPlay). */
  function checkStall() {
    if (!store.autoRecover() || !player.isPlaying() || buffering) {
      stallTicks = 0;
      return;
    }
    const p = player.position();
    if (p !== lastPos) {
      lastPos = p;
      stallTicks = 0;
      return;
    }
    if (++stallTicks < 3) return;
    stallTicks = 0;
    if (recoveries >= 4) return; // give up quietly rather than loop forever
    recoveries++;
    status('Re-syncing video…');
    if (isLive()) load(0);
    else player.seek(player.position());
  }

  // ------------------------------------------------------------ overlays

  function showOverlay(autoHide) {
    updateProgress(true);
    fade(vod, true);
    cancel('hideOverlay');
    if (autoHide && player.isPlaying()) later('hideOverlay', () => { if (topFocus < 0) { setSettings(false); fade(vod, false); } }, OVERLAY_MS);
  }

  function updateProgress(force = false) {
    if (!force && !shown(vod)) return;
    const d = player.duration();
    const p = seekTarget >= 0 ? seekTarget : player.position();
    if (d <= 0) {
      vodBar.set(0, 0);
      timeLeft.textContent = fmt(p);
      timeRight.textContent = '';
      return;
    }
    vodBar.set(p / d, 0); // AVPlay has no buffered position (as with VLC on Android)
    timeLeft.textContent = fmt(p);
    timeRight.textContent = `−${fmt(Math.max(0, d - p))}`;
  }

  function showBanner() {
    const it = current();
    const at = index;
    liveNum.textContent = it.num == null ? '' : String(it.num);
    liveName.textContent = (it.name || '') + (store.isFav(it) ? '  ♥' : '');
    liveNow.textContent = '';
    liveTime.textContent = '';
    liveNext.textContent = '';
    liveBar.el.style.visibility = 'hidden';
    if (it.icon) { if (liveLogo.getAttribute('src') !== it.icon) { liveLogo.hidden = true; liveLogo.src = it.icon; } } else { liveLogo.hidden = true; liveLogo.removeAttribute('src'); }
    fade(banner, true);
    later('hideBanner', () => fade(banner, false), BANNER_MS);
    Promise.resolve(api.epg(it.id)).catch(() => []).then((r) => {
      if (!alive || at !== index) return;
      if (!r || !r.length) { liveNow.textContent = 'No guide information'; return; }
      const now = r[0];
      liveNow.textContent = now.title || '';
      liveTime.textContent = now.timeRange();
      if (now.start > 0) {
        liveBar.set(now.progress(), 0);
        liveBar.el.style.visibility = '';
      }
      if (r.length > 1) {
        const n = r[1];
        const t = n.timeRange();
        liveNext.textContent = `Next   ${t.length >= 5 ? `${t.slice(0, 5)}   ` : ''}${n.title || ''}`;
      }
    });
  }

  function status(s) {
    statusEl.textContent = s;
    statusEl.hidden = false;
    later('hideStatus', () => { statusEl.hidden = true; }, STATUS_MS);
  }

  function hidePanels() {
    chSheet.close();
    trSheet.close();
    epSheet.close();
    clearTimeout(rebuildTimer);
    host.focus({ preventScroll: true });
  }

  function openChannels() {
    fade(banner, false);
    playingId = current().id;
    favIds = store.favIds(LIVE);
    chList.setCount(queue.length);
    chSheet.open();
    chList.relayout();
    chList.select(index, { scroll: 'top', focus: true, silent: true });
    chGlider.refresh();
  }

  function clickChannel(pos) {
    hidePanels();
    if (pos !== index) {
      index = pos;
      cancel('zap');
      resetLiveState();
      play(false);
    }
  }

  function favChannel(pos) {
    if (pos < 0 || pos >= queue.length) return;
    const it = queue[pos];
    toast(favToast(store.toggleFav(it), it));
    favIds = store.favIds(LIVE);
    chList.refresh();
    chGlider.refresh();
  }

  // ------------------------------------------------------------ top row & episodes

  /** Which buttons this film / episode gets: Next only when there is something next. */
  function refreshTop() {
    if (!topRow || isLive()) return;
    const cur = current();
    const nx = upNext();
    const ep = cur.type === EPISODE;
    topShown = [TOP_BACK, TOP_RESTART];
    if (nx) topShown.push(TOP_NEXT);
    if (ep) topShown.push(TOP_EPISODES);
    // Settings is under the bar now (▼), as on Netflix
    nextName = nx && ep && nx.type === EPISODE && cur.parentId != null && String(cur.parentId) === String(nx.parentId) ? 'Next Episode' : 'Next in Queue';
    topRow.innerHTML = '';
    for (const w of topShown) {
      const b = el('div', 'pl-top-btn');
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TOP_ICONS[w]}</svg>`;
      topRow.appendChild(b);
    }
    if (topFocus >= topShown.length) topFocus = topShown.length - 1;
    paintTop();
  }

  function paintTop() {
    [...topRow.children].forEach((b, i) => b.classList.toggle('on', i === topFocus));
    const w = topShown[topFocus];
    topLabel.textContent = topFocus < 0 ? '' : (w === TOP_NEXT ? nextName : TOP_NAMES[w]).toUpperCase();
  }

  /** ▲ from the progress bar: onto Play From Beginning (Netflix's default). */
  function focusTop() { topFocus = Math.min(1, topShown.length - 1); paintTop(); }
  function leaveTop() { if (topFocus < 0) return; topFocus = -1; topOk = false; paintTop(); }
  function moveTop(d) { topFocus = Math.max(0, Math.min(topShown.length - 1, topFocus + d)); paintTop(); }

  function activateTop() {
    const w = topShown[topFocus];
    leaveTop();
    if (w === TOP_BACK) router.back();
    else if (w === TOP_RESTART) { player.seek(0); player.play(); status('Playing from the beginning'); showOverlay(true); }
    else if (w === TOP_NEXT) { if (upNext()) playNext(); }
    else if (w === TOP_EPISODES) openEpisodes();
    else if (w === TOP_SETTINGS) openTracks();
  }

  /** The settings button under the bar: white with its name beside it while chosen. */
  function setSettings(on) {
    if (!setBtn || on === setOn) return;
    setOn = on;
    if (!on) setOk = false;
    setBtn.classList.toggle('on', on);
    setLabel.classList.toggle('on', on);
    if (!scrubbing) vodHint.textContent = on ? SETTINGS_HINT : VOD_HINT;
  }

  /** ▼ while playing: the controls come up with the settings button chosen. */
  function focusSettings() {
    leaveTop();
    setSettings(true);
    showOverlay(true);
  }

  /** The series' episodes, every season, opened on the one playing; OK plays one. */
  function openEpisodes() {
    const cur = current();
    if (cur.type !== EPISODE) return;
    fade(vod, false);
    epSheet.body.innerHTML = '';
    epSheet.body.appendChild(el('div', 'tp-note', 'Loading episodes…'));
    epSheet.open();
    Promise.resolve().then(() => api.seriesInfo(cur.parentId)).then((r) => followingEpisodes(r, cur)).catch(() => null).then((got) => {
      if (!alive || !epSheet.isOpen() || current() !== cur) return;
      const all = got && got.length ? got : queue.slice();
      epSheet.body.innerHTML = '';
      let season = null; let focusMe = null;
      all.forEach((ep, i) => {
        if (ep.season !== season) {
          season = ep.season;
          epSheet.body.appendChild(el('div', 'tp-header', season === 0 ? 'SPECIALS' : season == null || season < 0 ? 'EPISODES' : `SEASON ${season}`));
        }
        const playing = key(ep) === key(cur);
        const r = el('button', 'tp-opt ep-opt');
        r.type = 'button';
        r.tabIndex = -1;
        const pos = store.position(ep); const dur = store.duration(ep);
        const sub = playing ? 'Now playing' : store.isWatched(ep) ? '✓ Watched' : pos > 0 && dur > 0 ? `${fmt(Math.max(0, dur - pos))} left` : (ep.duration || '');
        r.append(el('span', 'tp-label', `${ep.num != null ? `${ep.num}.  ` : ''}${ep.name || ''}`), el('span', 'ep-sub', sub));
        if (playing) r.classList.add('playing');
        r.addEventListener('click', () => {
          hidePanels();
          if (key(all[i]) === key(current())) return;
          savePosition();
          queue = all.slice();
          index = i;
          retries = 0;
          play(true); // carries on where you left that episode, like Netflix
        });
        epSheet.body.appendChild(r);
        if (playing) focusMe = r;
      });
      const f = focusMe || epSheet.body.querySelector('.tp-opt');
      if (f) { f.focus(); if (typeof f.scrollIntoView === 'function') f.scrollIntoView({ block: 'center' }); }
    });
  }

  // ------------------------------------------------------------ subtitles & audio

  function openTracks() {
    fade(vod, false);
    fade(banner, false);
    buildTrackRows(true);
    trSheet.open();
    const f = trList.querySelector('.tp-opt.want-focus') || trList.querySelector('.tp-opt');
    if (f) { f.classList.remove('want-focus'); f.focus(); }
  }

  function header(s) {
    const t = el('div', `tp-header${trList.children.length === 0 ? ' first' : ''}`, s.toUpperCase());
    trList.appendChild(t);
  }
  function note(s) { trList.appendChild(el('div', 'tp-note', s)); }
  function option(label, selected, action) {
    const r = el('button', 'tp-opt');
    r.type = 'button';
    r.tabIndex = -1;
    r.append(el('span', 'tp-label', label), el('span', 'tp-check', selected ? '✓' : ''));
    r.addEventListener('click', () => {
      action();
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => { if (alive && trSheet.isOpen()) buildTrackRows(false); }, 250);
    });
    trList.appendChild(r);
    return r;
  }

  function buildTrackRows(focusSelected) {
    const kids = [...trList.children];
    const focusedIndex = kids.indexOf(document.activeElement);
    trList.replaceChildren();
    let firstSelected = null;
    const cur = current();
    // Episodes add their series to Favourites
    let favTarget = cur;
    if (cur.type === EPISODE) {
      favTarget = null;
      if (cur.parentId != null) {
        favTarget = { type: SERIES, id: String(cur.parentId), name: cur.parentName || '' };
        if (cur.parentIcon) favTarget.icon = cur.parentIcon;
      }
    }
    if (favTarget) {
      const fav = favTarget;
      const what = cur.type === EPISODE ? 'series ' : '';
      header('Favourites');
      option(store.isFav(fav) ? `♥  In Favourites — remove ${what.trim()}`.trimEnd() : `♡  Add ${what}to Favourites`, false, () => {
        toast(favToast(store.toggleFav(fav), fav));
        if (isLive()) showBanner();
      });
    }

    header('Subtitles');
    const off = player.subtitlesAreOff();
    const offRow = option('Off', off, () => {
      player.subtitlesOff();
      store.setSubtitleLanguage('off');
    });
    if (off) firstSelected = offRow;
    const text = player.tracks(player.TEXT);
    for (const t of text) {
      const o = option(t.label, t.selected, () => {
        player.select(t);
        store.setSubtitleLanguage(t.language || '');
      });
      if (t.selected) firstSelected = o;
    }
    if (!text.length) note('This stream has no subtitles');

    if (cur.type === EPISODE) {
      header('Skip Intro');
      note(segments ? segments.status || 'No times for this episode' : 'Looking up this episode…');
    }
    header('Audio');
    const audio = player.tracks(player.AUDIO);
    for (const t of audio) {
      const o = option(t.label, t.selected, () => {
        player.select(t);
        store.setAudioLanguage(t.language || '');
      });
      if (t.selected && !firstSelected) firstSelected = o;
    }
    if (!audio.length) note('No audio tracks found');

    // (Audio Sync and the Player choice are left out: AVPlay can't shift the sound and is the
    // only engine. See docs/parity/phase-6-report.md.)

    header(`Picture  ·  for ${cur.type === EPISODE ? 'this series' : isLive() ? 'this channel' : 'this film'}`);
    store.PICTURE.forEach((name, m) => {
      option(name, picture === m, () => choosePicture(m));
    });

    header('Subtitle Size');
    SUB_SIZE_NAMES.forEach((name, s) => {
      option(name, store.subtitleSize() === s, () => {
        store.setSubtitleSize(s);
        subs.applyStyle();
      });
    });

    const now = [...trList.children];
    if (focusedIndex >= 0 && focusedIndex < now.length && now[focusedIndex].classList.contains('tp-opt')) {
      now[focusedIndex].focus();
    } else if (focusSelected && firstSelected) {
      firstSelected.classList.add('want-focus');
      if (trSheet.isOpen()) { firstSelected.classList.remove('want-focus'); firstSelected.focus(); }
    }
  }

  function moveTrackFocus(dir) {
    const opts = [...(epSheet.isOpen() ? epSheet.body : trList).querySelectorAll('.tp-opt')];
    const i = opts.indexOf(document.activeElement);
    const to = i < 0 ? 0 : i + dir;
    if (to >= 0 && to < opts.length) opts[to].focus();
  }

  // ------------------------------------------------------------ scrubbing

  function enterScrub() {
    const d = player.duration();
    if (d <= 0) { showOverlay(true); return; } // no length known: nothing to scrub along
    cancel('endBurst');
    endBurst();
    scrubbing = true;
    scrubPos = player.position();
    scrubRow.hidden = false;
    vodHint.textContent = SCRUB_HINT;
    showOverlay(false); // stays up while scrubbing
    updateScrub();
  }

  function moveScrub(dir, repeat) {
    const d = player.duration();
    if (d <= 0) return;
    scrubPos = Math.max(0, Math.min(d - 1000, scrubPos + dir * scrubStep(d, repeat)));
    updateScrub();
  }

  function updateScrub() {
    const d = player.duration();
    if (d <= 0) return;
    vodBar.setKnob(scrubPos / d);
    scrubTime.textContent = scrubText(scrubPos, player.position());
    placeScrubCard();
    // Like YouTube: once you stop moving, it plays from the new point after a short pause
    later('scrubCommit', commitScrub, SCRUB_COMMIT_MS);
  }

  function placeScrubCard() {
    const rowR = scrubRow.getBoundingClientRect();
    const barR = vodBar.el.getBoundingClientRect();
    const cw = scrubCard.offsetWidth;
    let x = (barR.left - rowR.left) + vodBar.knobX() - cw / 2;
    x = Math.max(0, Math.min(rowR.width - cw, x));
    scrubCard.style.transform = `translateX(${x || 0}px)`;
  }

  function commitScrub() {
    if (!scrubbing) return;
    const target = scrubPos;
    exitScrub();
    if (Math.abs(target - player.position()) >= 1000) player.seek(target);
    if (!player.isPlaying()) player.play();
    showOverlay(true);
  }

  function cancelScrub() {
    if (!scrubbing) return;
    exitScrub();
    showOverlay(true);
  }

  function exitScrub() {
    scrubbing = false;
    cancel('scrubCommit');
    scrubRow.hidden = true;
    vodBar.setKnob(-1);
    vodHint.textContent = VOD_HINT;
  }

  // ------------------------------------------------------------ picture shape

  function choosePicture(mode) {
    picture = mode;
    store.setPicture(current(), mode);
    player.setPicture(mode);
    status(`Picture: ${store.PICTURE_SHORT[mode]}`);
  }

  // ------------------------------------------------------------ next episode / next in queue

  /**
   * This film / episode is done: marked watched, and the next episode (if there is one) goes
   * into Continue Watching, ready at the start, the way Netflix does it.
   */
  function finishedCurrent() {
    const cur = current();
    store.setWatched(cur, true);
    if (cur.type !== EPISODE || cur.parentId == null || index >= queue.length - 1) return;
    const nx = queue[index + 1];
    if (nx.type === EPISODE && String(cur.parentId) === String(nx.parentId) && !store.isWatched(nx) && store.position(nx) === 0) {
      store.markUpNext(nx);
    }
  }

  /** PlayerActivity.savePosition, before the engine is stopped: a finished one is marked, with its next episode. */
  function savePosition() {
    if (!queue.length || isLive()) return;
    if (player.finishedAt(player.position(), player.duration())) finishedCurrent();
  }

  /**
   * An episode played on its own (from Continue Watching or the Queue), or the last of a season:
   * fetch the series so the next episode follows on, and can go into Continue Watching.
   */
  function extendSeries() {
    const cur = current();
    if (cur.type !== EPISODE || cur.parentId == null || index < queue.length - 1) return;
    Promise.resolve().then(() => api.seriesInfo(cur.parentId)).then((r) => followingEpisodes(r, cur)).catch(() => null).then((all) => {
      if (!all || !alive || current() !== cur) return;
      const at = all.findIndex((e) => String(e.id) === String(cur.id));
      if (at < 0) return;
      // An episode saved by an older version doesn't know its season or the series' TMDB id.
      if (cur.season === undefined && all[at].season !== undefined) {
        cur.season = all[at].season;
        if (!cur.tmdb && all[at].tmdb) cur.tmdb = all[at].tmdb;
        if (!segments) loadSegments();
      }
      if (at >= all.length - 1) return;
      const q = all.slice();
      q[at] = cur;
      queue = q;
      index = at;
      refreshTop(); // a Next Episode button now
    });
  }

  /** What plays after this: the next episode, or else the next thing in your Queue. */
  function upNext() {
    const cur = current();
    if (cur.type === EPISODE && index < queue.length - 1) return queue[index + 1];
    return store.queueNextAfter(cur);
  }

  /** When the card appears: when the credits start (if the intro database knows), else 30 s from the end. */
  function cardAt(d) {
    const credits = segments ? segments.creditsStart : -1;
    if (credits > 60000 && credits > d * 0.7 && credits < d - 5000) return credits;
    return d - 30000;
  }

  function checkNextCard() {
    if (isLive()) return;
    const d = player.duration(); const p = player.position();
    if (d < 5 * 60000) return;
    const at = cardAt(d); const left = d - p;
    if (p < at - 15000) nextDismissed = false; // went back: offer it again later
    if (nextShown) {
      if (p < at - 5000) hideNextCard();
      else nextCard.setPaused(!player.isPlaying());
      return;
    }
    if (p >= at && left > 2000 && !nextDismissed && !scrubbing && !panelOpen() && player.isPlaying()) {
      const nx = upNext();
      if (!nx) return;
      const cur = current();
      const sameSeries = cur.type === EPISODE && nx.type === EPISODE && cur.parentId != null && String(cur.parentId) === String(nx.parentId);
      nextCard.setLabel(sameSeries ? 'Next Episode' : 'Next in Queue');
      nextShown = true;
      showSkip(false);
      fade(vod, false);
      fade(nextCard.el, true);
      nextCard.next.focus();
      nextCard.start(() => playNext());
    }
  }

  function hideNextCard() {
    if (!nextCard) return;
    nextCard.stopTimer();
    if (nextShown) {
      nextShown = false;
      nextCard.el.hidden = true;
      nextCard.el.classList.add('out');
      host.focus({ preventScroll: true });
    }
  }

  function watchCredits() {
    nextDismissed = true;
    hideNextCard();
  }

  /**
   * Next episode (in its series' list), or the next item in your Queue (played on its own).
   * @param ended the stream ran to its end (the engine has nothing more to say about where it was)
   */
  function playNext(ended = false) {
    const nx = upNext();
    hideNextCard();
    if (!nx) return;
    const d = player.duration(); const p = player.position();
    if (ended || d <= 0 || player.finishedAt(p, d) || p >= cardAt(d) - 2000) finishedCurrent(); // at the end
    else if (p > 10000) store.setPosition(current(), p); // skipped ahead early: not watched, keep your place
    if (current().type === EPISODE && index < queue.length - 1 && queue[index + 1] === nx) {
      index++;
    } else {
      queue = [nx];
      index = 0;
    }
    retries = 0;
    play(false);
  }

  // ------------------------------------------------------------ skip intro

  /** Episodes: ask the intro database where this one's intro and credits are. */
  function loadSegments() {
    segments = null;
    const ep = current();
    if (ep.type !== EPISODE || !(ep.season >= 0) || !ep.parentName) return;
    const n = Number.parseInt(String(ep.num == null ? '' : ep.num).trim(), 10);
    if (!Number.isFinite(n)) return;
    tmdb.findId(tmdb.TV, ep.parentName, ep.tmdb)
      .then((id) => intros.get(id, ep.season, n, store.duration(ep)))
      .catch(() => null)
      // still on this episode? (by what it is: the list around it may have been reloaded meanwhile)
      .then((seg) => { if (alive && seg && current() && key(current()) === key(ep)) segments = seg; });
  }

  /** Which part the Skip button is for right now: 1 recap, 2 intro, 0 none. */
  let skipWhat = 0;

  /** The Skip button shows while the recap or the intro is playing. */
  function checkIntro() {
    if (isLive() || !(intros.hasIntro(segments) || intros.hasRecap(segments)) || scrubbing || nextShown || panelOpen() || !player.isReady()) {
      showSkip(false);
      return;
    }
    const p = player.position();
    let what = 0;
    if (intros.hasRecap(segments) && p >= segments.recapStart - 500 && p < segments.recapEnd - 1500) what = 1;
    else if (intros.hasIntro(segments) && p >= segments.introStart - 500 && p < segments.introEnd - 1500) what = 2;
    if (what && what !== skipWhat) { skipWhat = what; skipBtn.textContent = what === 1 ? SKIP_RECAP_LABEL : SKIP_LABEL; }
    showSkip(what !== 0);
  }

  function showSkip(on) {
    if (!skipBtn || on === skipShown) return;
    skipShown = on;
    fade(skipBtn, on);
  }

  function skipIntro() {
    if (!segments) return;
    const recap = skipWhat === 1 && intros.hasRecap(segments);
    const to = recap ? segments.recapEnd : segments.introEnd;
    if (!(to > 0)) return;
    player.seek(to);
    showSkip(false);
    status(recap ? 'Skipped the recap' : 'Skipped the intro');
  }

  // ------------------------------------------------------------ remote control

  function togglePause() {
    if (player.isPlaying()) {
      player.pause();
    } else {
      player.play();
      showOverlay(true);
    }
  }

  function endBurst() {
    burst = 0;
    seekTarget = -1;
    bubble.style.visibility = 'hidden';
  }

  function seekBy(delta) {
    const d = player.duration();
    const base = seekTarget >= 0 ? seekTarget : player.position();
    let target = Math.max(0, base + delta);
    if (d > 0) target = Math.min(target, d - 1000);
    seekTarget = target;
    burst += delta;
    player.seek(target);
    bubble.textContent = burstText(burst);
    bubble.style.visibility = 'visible';
    later('endBurst', endBurst, BURST_MS);
    showOverlay(true);
  }

  function zap(dir) {
    if (queue.length < 2) return;
    index = (index + dir + queue.length) % queue.length;
    resetLiveState();
    showBanner();
    later('zap', () => play(false), ZAP_MS); // lets you skip through several channels quickly
  }

  /** Layered Back (onBackPressed). @returns true if the player handled it. */
  function back() {
    if (coach.back()) return true;
    if (topFocus >= 0) { leaveTop(); showOverlay(true); return true; }
    if (scrubbing) { cancelScrub(); return true; }
    if (nextShown) { watchCredits(); return true; }
    if (panelOpen()) { hidePanels(); return true; }
    if (!isLive() && shown(vod) && player.isPlaying()) { fade(vod, false); return true; }
    return false;
  }

  function onKeyDown(e) {
    if (!alive || coach.showing()) return false;
    const k = e.keyCode;
    const repeat = e.repeat || heldKey === k;
    if (heldKey === k) repeatCount++; else { heldKey = k; repeatCount = 0; }
    const okKey = k === KEY.ENTER;
    const done = () => { e.preventDefault(); return true; };

    // ■ Stop leaves the player from wherever it is (a panel, scrubbing, the error text): the
    // place is saved as the screen closes (player.stop() in unmount), like Back at the top level.
    if (k === KEY.STOP) { if (!repeat) router.back(); return done(); }

    // Next episode card: ◀ ▶ between its two buttons, OK presses (on release)
    if (nextShown && !panelOpen() && !scrubbing) {
      if (k === KEY.LEFT || k === KEY.RIGHT) { (k === KEY.LEFT ? nextCard.credits : nextCard.next).focus(); return done(); }
      if (okKey) return done();
    }

    // The top row: ◀ ▶ move, OK chooses (on release), ▼ / Back leave it
    if (!isLive() && topFocus >= 0 && !panelOpen() && !scrubbing) {
      if (k === KEY.LEFT) moveTop(-1);
      else if (k === KEY.RIGHT) moveTop(1);
      else if (k === KEY.DOWN || k === KEY.BACK || k === KEY.ESC) { leaveTop(); showOverlay(true); }
      else if (okKey) { if (!repeat) topOk = true; }
      return done();
    }

    // The settings button under the bar: OK opens Subtitles, Audio & Picture, ▲ goes up onto the
    // bar (scrubbing), Back puts the controls away
    if (!isLive() && setOn && !panelOpen() && !scrubbing) {
      if (okKey) { if (!repeat) setOk = true; return done(); }
      if (k === KEY.UP) { if (!repeat) { setSettings(false); enterScrub(); } return done(); }
      if (k === KEY.BACK || k === KEY.ESC) { setSettings(false); cancel('hideOverlay'); fade(vod, false); return done(); }
      if (k === KEY.DOWN || k === KEY.LEFT || k === KEY.RIGHT) { showOverlay(true); return done(); }
      setSettings(false); // any other key: carry on as usual
    }

    // OK: tap on release, hold (450 ms) opens the menu
    if (okKey && !panelOpen() && !errorVisible()) {
      if (!repeat) {
        okDown = true; okHeld = false; okAt = Date.now();
        // Samsung remotes often send no key repeats: open the menu once the hold is long enough,
        // while OK is still down, not when it's let go
        clearTimeout(okTimer);
        okTimer = setTimeout(() => {
          okTimer = null;
          if (alive && okDown && !okHeld && !panelOpen() && !errorVisible() && (isLive() || !scrubbing)) { okHeld = true; openTracks(); }
        }, LONG_PRESS_MS);
      } else if (okDown && !okHeld && (isLive() || !scrubbing) && Date.now() - okAt >= LONG_PRESS_MS) {
        clearTimeout(okTimer); okTimer = null;
        okHeld = true;
        openTracks();
      }
      return done();
    }
    if (k === KEY.BACK || k === KEY.ESC) return false; // → onBack

    if (panelOpen()) {
      if (chSheet.isOpen()) {
        if (k === KEY.UP || k === KEY.DOWN) { chList.move(k === KEY.UP ? 'up' : 'down'); return done(); }
        if (okKey) {
          if (!repeat) {
            const p = { at: Date.now(), held: false };
            panelOk = p;
            clearTimeout(okTimer);
            okTimer = setTimeout(() => { // the favourite toggles while OK is still held
              okTimer = null;
              if (alive && panelOk === p && !p.held && chSheet.isOpen()) { p.held = true; favChannel(chList.selected); }
            }, LONG_PRESS_MS);
          } else if (panelOk && !panelOk.held && Date.now() - panelOk.at >= LONG_PRESS_MS) { clearTimeout(okTimer); okTimer = null; panelOk.held = true; favChannel(chList.selected); }
          return done();
        }
        if (k === KEY.MENU) { favChannel(chList.selected); return done(); }
        return done();
      }
      if (k === KEY.UP || k === KEY.DOWN) { moveTrackFocus(k === KEY.UP ? -1 : 1); return done(); }
      if (okKey) { if (!repeat) panelOk = { at: Date.now(), held: false }; return done(); }
      return done();
    }

    if (errorVisible() && okKey) {
      resetLiveState();
      play(false);
      return done();
    }

    if (isLive()) {
      switch (k) {
        case KEY.UP: case KEY.CH_UP: zap(-1); return done();
        case KEY.DOWN: case KEY.CH_DOWN: zap(1); return done();
        case KEY.ENTER: openChannels(); return done();
        case KEY.LEFT: case KEY.RIGHT: case KEY.INFO: showBanner(); return done();
        case KEY.MENU: openTracks(); return done();
        case KEY.PLAY_PAUSE: case KEY.PLAY: case KEY.PAUSE:
          if (player.isPlaying()) player.pause(); else player.play();
          return done();
        default: return false;
      }
    }

    if (scrubbing) {
      switch (k) {
        case KEY.LEFT: case KEY.REWIND: moveScrub(-1, repeatCount); return done();
        case KEY.RIGHT: case KEY.FAST_FORWARD: moveScrub(1, repeatCount); return done();
        case KEY.UP: cancelScrub(); return done();
        case KEY.DOWN: if (!repeat) { cancelScrub(); focusSettings(); } return done(); // down off the bar: settings
        case KEY.MENU: cancelScrub(); openTracks(); return done();
        case KEY.PLAY_PAUSE: commitScrub(); return done();
        default: return false;
      }
    }

    switch (k) {
      case KEY.PLAY_PAUSE: if (!repeat) togglePause(); return done();
      case KEY.PLAY: player.play(); showOverlay(true); return done();
      case KEY.PAUSE: player.pause(); return done();
      case KEY.LEFT: case KEY.REWIND: seekBy(-BACK_MS); return done();
      case KEY.RIGHT: case KEY.FAST_FORWARD: seekBy(FORWARD_MS); return done();
      case KEY.UP:
        if (shown(vod) && !repeat) { focusTop(); showOverlay(false); } else showOverlay(true); // ▲ again: onto the top row
        return done();
      case KEY.DOWN: if (!repeat) focusSettings(); return done();
      case KEY.MENU: openTracks(); return done();
      default: return false;
    }
  }

  function onKeyUp(e) {
    const k = e.keyCode;
    if (topOk && k === KEY.ENTER) { topOk = false; okDown = okHeld = false; e.preventDefault(); activateTop(); return; }
    if (setOk && k === KEY.ENTER) { setOk = false; okDown = okHeld = false; e.preventDefault(); setSettings(false); openTracks(); return; }
    if (heldKey === k) { heldKey = null; repeatCount = 0; }
    if (!alive || coach.showing() || k !== KEY.ENTER) return;
    if (nextShown && !panelOpen() && !scrubbing) {
      e.preventDefault();
      okDown = okHeld = false;
      if (document.activeElement === nextCard.credits) watchCredits(); else playNext();
      return;
    }
    clearTimeout(okTimer); okTimer = null;
    if (panelOpen()) {
      const p = panelOk;
      panelOk = null;
      okDown = okHeld = false;
      if (!p) return; // the OK that opened the panel
      e.preventDefault();
      if (chSheet.isOpen()) {
        if (p.held) return;
        if (Date.now() - p.at >= LONG_PRESS_MS) favChannel(chList.selected); // held without key repeats
        else clickChannel(chList.selected);
      } else if (document.activeElement && document.activeElement.classList.contains('tp-opt')) {
        document.activeElement.click();
      }
      return;
    }
    if (okDown && !okHeld && !errorVisible()) {
      e.preventDefault();
      const held = Date.now() - okAt >= LONG_PRESS_MS;
      if (isLive()) { if (held) openTracks(); else openChannels(); } else if (scrubbing) commitScrub(); else if (held) openTracks();
      else if (skipShown) skipIntro(); else togglePause();
    }
    okDown = okHeld = false;
  }

  // ------------------------------------------------------------ lifecycle

  function startTickers() {
    stopTickers();
    ticker = setInterval(() => { if (!alive) return; updateProgress(); checkNextCard(); checkIntro(); }, TICK_MS);
    watchdog = setInterval(() => { if (alive) checkStall(); }, WATCHDOG_MS);
  }
  function stopTickers() { clearInterval(ticker); clearInterval(watchdog); ticker = watchdog = null; }

  function screenSaver(on) {
    const ac = globalThis.webapis && globalThis.webapis.appcommon;
    if (!ac || typeof ac.setScreenSaver !== 'function') return;
    const st = ac.AppCommonScreenSaverState || {};
    try { ac.setScreenSaver(on ? st.SCREEN_SAVER_ON : st.SCREEN_SAVER_OFF); } catch { /* not allowed */ }
  }

  /** onStop / onStart: the app went to the background (Home key, another source) and came back. */
  function onVisibility() {
    if (!alive) return;
    if (document.hidden) {
      stopTickers();
      cancel('zap');
      if (scrubbing) cancelScrub();
      hideNextCard();
      if (!isLive()) resumeMs = player.position();
      savePosition();
      player.stop();
      subs.clear();
    } else {
      play(true);
      startTickers();
    }
  }

  const listen = (target, type, fn) => { target.addEventListener(type, fn); handlers.push([target, type, fn]); };
  const sub = (event, fn) => { player.on(event, fn); handlers.push([null, event, fn]); };

  return {
    mount(rootEl, params) {
      root = rootEl;
      ({ queue, index } = queueOf(params));
      if (!queue.length) { setTimeout(() => router.back(), 0); return; }
      alive = true;
      build();
      const av = document.getElementById('av');
      if (av) av.hidden = false;
      document.body.classList.add('video-on');
      document.documentElement.classList.add('video-on'); // the AVPlay plane is under the whole page
      screenSaver(false);
      sub('ready', onReady);
      sub('ended', onEnded);
      sub('error', onError);
      sub('playing', onPlayingChanged);
      sub('buffering', onBuffering);
      sub('subtitle', ({ text, duration }) => subs.show(text, duration));
      sub('tracks', () => { if (trSheet.isOpen()) buildTrackRows(false); });
      listen(document, 'keyup', onKeyUp);
      listen(document, 'visibilitychange', onVisibility);
      host.focus({ preventScroll: true });
      play(true);
      firstStart = false;
      const step = isLive() ? COACH_LIVE : COACH_VOD;
      cancelCoach = coach.show(isLive() ? 'player_live' : 'player_vod', [{ target: null, title: step.title, body: step.body }], () => alive);
      startTickers();
    },
    onKey: onKeyDown,
    onBack: () => back(),
    unmount() {
      alive = false;
      stopTickers();
      cancelCoach();
      coach.dismiss();
      for (const k of Object.keys(timers)) clearTimeout(timers[k]);
      for (const t of fadeTimers.values()) clearTimeout(t);
      clearTimeout(rebuildTimer);
      for (const [t, type, fn] of handlers) { if (t) t.removeEventListener(type, fn); else player.off(type, fn); }
      handlers.length = 0;
      if (nextCard) nextCard.stopTimer();
      if (queue.length && player.current()) savePosition(); // a finished episode puts its next one in Continue Watching
      player.stop();
      if (chGlider) chGlider.destroy();
      if (chList) chList.destroy();
      if (chSheet) chSheet.destroy();
      if (trSheet) trSheet.destroy();
      if (subs) subs.destroy();
      const av = document.getElementById('av');
      if (av) av.hidden = true;
      document.body.classList.remove('video-on');
      document.documentElement.classList.remove('video-on');
      // Always, however the player was left: a film that ends by itself has already cleared
      // `alive` (finish()), and the TV must not be left with its screen saver switched off.
      screenSaver(true);
      root = host = null;
    },
    // for tests
    _state: () => ({
      index, queue, scrubbing, scrubPos, seekTarget, burst, nextShown, nextDismissed, retries, triedAltFormat,
      skipShown, segments, picture, endRetries,
      recoveries, liveFormat, stallTicks, panel: chSheet && chSheet.isOpen() ? 'channels' : trSheet && trSheet.isOpen() ? 'tracks' : null,
    }),
  };
}

export const playerLiveView = playerView;
export const playerVodView = playerView;
