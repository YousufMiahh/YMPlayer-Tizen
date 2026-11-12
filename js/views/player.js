// Full-screen player (PlayerActivity.java) for live channels, films and episodes, on AVPlay.
//
// Live TV: ▲/▼ and CH+/CH− change channel (the banner at once, the stream 350 ms after the last
// press), OK the Channels list, Hold OK favourite / subtitles & audio, ◀ ▶ INFO the banner.
// Films & episodes: OK play/pause, ◀ back 5 s, ▶ forward 10 s (presses add up), ▼ scrub, Hold OK
// subtitles & audio, the Next Episode card near the end of an episode.
//
// Params: { queue: Item[], index } (Open.play), or the older shapes { channels, index } (live)
// and { item, queue?, index? } (VOD).
import * as store from '../store.js';
import * as api from '../api.js';
import * as player from '../player.js';
import { router } from '../router.js';
import { LIVE, EPISODE, SERIES } from '../item.js';
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
export const VOD_HINT = `◀  5 sec      ▶  10 sec      OK  Play / Pause      ▼  Scrub      ${HOLD_OK}  Subtitles & Audio`;
export const SCRUB_HINT = '◀ ▶  Move (hold to go faster)      OK  Play from here      Back  Cancel';
export const LIVE_HINT = `▲▼  Change channel      OK  Channel list      ${HOLD_OK}  Favourite, subtitles & audio`;
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
export const FADE_IN = 200;
export const FADE_OUT = 250;
export const COACH_LIVE = { title: 'Watching Live TV', body: `▲ ▼  Change channel\nOK  Channel list\n◀ ▶  Channel info\n${HOLD_OK}  Favourite, subtitles & audio\nBack  Leave` };
export const COACH_VOD = {
  title: 'Watching films & series',
  body: `OK  Pause / play\n◀  Back 5 seconds     ▶  Forward 10 seconds (press again to go further)\n▼  Scrub: move the knob with ◀ ▶, OK to jump there\n${HOLD_OK}  Subtitles, audio & favourite\nBack  Leave — your place is saved`,
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
  let vod; let vodSub; let vodTitle; let bubble; let scrubRow; let scrubCard; let scrubTime; let vodBar; let timeLeft; let timeRight; let vodHint;
  let center; let banner; let liveLogo; let liveNum; let liveName; let liveNow; let liveTime; let liveBar; let liveNext;
  let spinner; let errorEl; let statusEl; let nextCard; let subs;
  let chSheet; let chList; let chGlider; let playingId = null; let trSheet; let trList;
  // state
  let liveFormat = store.liveFormat();
  let retries = 0; let triedAltFormat = false; let firstStart = true;
  let seekTarget = -1; let burst = 0;
  let lastPos = -1; let stallTicks = 0; let recoveries = 0; let buffering = false;
  let scrubbing = false; let scrubPos = 0;
  let nextShown = false; let nextDismissed = false;
  let okDown = false; let okHeld = false; let okAt = 0;
  let panelOk = null; // OK pressed inside a panel: { at, held }
  let heldKey = null; let repeatCount = 0;
  const timers = {};
  let ticker = null; let watchdog = null; let cancelCoach = () => {}; let rebuildTimer = null;
  const handlers = [];

  const current = () => queue[index];
  const isLive = () => current() && current().type === LIVE;
  const shown = (e) => !!e && !e.hidden && !e.classList.contains('out');
  const errorVisible = () => !errorEl.hidden;
  const panelOpen = () => chSheet.isOpen() || trSheet.isOpen();
  const later = (name, fn, ms) => { clearTimeout(timers[name]); timers[name] = setTimeout(() => { timers[name] = null; if (alive) fn(); }, ms); };
  const cancel = (name) => { clearTimeout(timers[name]); timers[name] = null; };

  // ------------------------------------------------------------ overlay construction

  /** PlayerActivity.fade: in over 200 ms, out over 250 ms (then GONE). */
  const fadeTimers = new Map();
  function fade(e, show) {
    if (!e) return;
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
    vod.append(vodSub, vodTitle, bubble, scrubRow, vodBar.el, times, vodHint);
    p.appendChild(vod);

    nextCard = createNextUpCard(p);
    nextCard.el.classList.add('pl-fade');
    nextCard.credits.addEventListener('click', () => watchCredits());
    nextCard.next.addEventListener('click', () => playNextEpisode());

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
  }

  function channelCell(i, cell) {
    const it = queue[i];
    let trail = store.isFav(it) ? '♥' : '';
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
    const it = current();
    let start = 0;
    if (!isLive() && resume) {
      const pos = store.position(it);
      if (pos > 10000) {
        start = pos;
        if (firstStart) toast(`Resuming from ${fmt(pos)}`);
      }
    }
    load(start);
    store.addHistory(it);
    if (isLive()) {
      fade(vod, false);
      showBanner();
    } else {
      fade(banner, false);
      vodTitle.textContent = it.name || '';
      const ep = it.type === EPISODE;
      vodSub.textContent = ep ? joinNonEmpty(it.parentName, `Episode ${it.num}`) : '';
      vodSub.hidden = !ep;
      showOverlay(true);
    }
  }

  function load(startMs) {
    errorEl.hidden = true;
    cancel('retry');
    lastPos = -1;
    stallTicks = 0;
    subs.clear();
    player.open(current(), { startMs, format: liveFormat });
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

  function onEnded() {
    if (isLive()) { play(false); return; } // the server dropped the stream: reconnect
    store.setPosition(current(), 0);
    if (current().type === EPISODE && index < queue.length - 1) {
      index++;
      retries = 0;
      play(false);
    } else {
      finish();
    }
  }

  function finish() {
    alive = false;
    router.back();
  }

  function onError({ what } = {}) {
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
    if (!playing && player.isReady()) {
      center.hidden = false;
      showOverlay(false);
    } else {
      center.hidden = true;
      if (playing && shown(vod)) later('hideOverlay', () => fade(vod, false), OVERLAY_MS);
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
    if (autoHide && player.isPlaying()) later('hideOverlay', () => fade(vod, false), OVERLAY_MS);
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
    clearTimeout(rebuildTimer);
    host.focus({ preventScroll: true });
  }

  function openChannels() {
    fade(banner, false);
    playingId = current().id;
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
    chList.refresh();
    chGlider.refresh();
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
    const opts = [...trList.querySelectorAll('.tp-opt')];
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

  // ------------------------------------------------------------ next episode

  function checkNextCard() {
    if (isLive() || current().type !== EPISODE || index >= queue.length - 1) return;
    const d = player.duration(); const p = player.position();
    if (d < 5 * 60000) return;
    const left = d - p;
    if (left > 45000) nextDismissed = false; // went back: offer it again later
    if (nextShown) {
      if (left > 35000) hideNextCard();
      else nextCard.setPaused(!player.isPlaying());
      return;
    }
    if (left <= 30000 && left > 2000 && !nextDismissed && !scrubbing && player.isPlaying()) {
      nextShown = true;
      fade(vod, false);
      fade(nextCard.el, true);
      nextCard.next.focus();
      nextCard.start(() => playNextEpisode());
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

  function playNextEpisode() {
    hideNextCard();
    if (index >= queue.length - 1) return;
    store.setPosition(current(), 0);
    index++;
    retries = 0;
    play(false);
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

    // Next episode card: ◀ ▶ between its two buttons, OK presses (on release)
    if (nextShown && !panelOpen() && !scrubbing) {
      if (k === KEY.LEFT || k === KEY.RIGHT) { (k === KEY.LEFT ? nextCard.credits : nextCard.next).focus(); return done(); }
      if (okKey) return done();
    }

    // OK: tap on release, hold (450 ms) opens the menu
    if (okKey && !panelOpen() && !errorVisible()) {
      if (!repeat) { okDown = true; okHeld = false; okAt = Date.now(); } else if (okDown && !okHeld && (isLive() || !scrubbing) && Date.now() - okAt >= LONG_PRESS_MS) {
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
          if (!repeat) panelOk = { at: Date.now(), held: false };
          else if (panelOk && !panelOk.held && Date.now() - panelOk.at >= LONG_PRESS_MS) { panelOk.held = true; favChannel(chList.selected); }
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
        case KEY.DOWN: return done();
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
      case KEY.UP: showOverlay(true); return done();
      case KEY.DOWN: if (!repeat) enterScrub(); return done();
      case KEY.MENU: openTracks(); return done();
      default: return false;
    }
  }

  function onKeyUp(e) {
    const k = e.keyCode;
    if (heldKey === k) { heldKey = null; repeatCount = 0; }
    if (!alive || coach.showing() || k !== KEY.ENTER) return;
    if (nextShown && !panelOpen() && !scrubbing) {
      e.preventDefault();
      okDown = okHeld = false;
      if (document.activeElement === nextCard.credits) watchCredits(); else playNextEpisode();
      return;
    }
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
      if (isLive()) { if (held) openTracks(); else openChannels(); } else if (scrubbing) commitScrub(); else if (held) openTracks(); else togglePause();
    }
    okDown = okHeld = false;
  }

  // ------------------------------------------------------------ lifecycle

  function startTickers() {
    stopTickers();
    ticker = setInterval(() => { if (!alive) return; updateProgress(); checkNextCard(); }, TICK_MS);
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
      const was = alive;
      alive = false;
      stopTickers();
      cancelCoach();
      for (const k of Object.keys(timers)) clearTimeout(timers[k]);
      for (const t of fadeTimers.values()) clearTimeout(t);
      clearTimeout(rebuildTimer);
      for (const [t, type, fn] of handlers) { if (t) t.removeEventListener(type, fn); else player.off(type, fn); }
      handlers.length = 0;
      if (nextCard) nextCard.stopTimer();
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
      if (was) screenSaver(true);
      root = host = null;
    },
    // for tests
    _state: () => ({
      index, queue, scrubbing, scrubPos, seekTarget, burst, nextShown, nextDismissed, retries, triedAltFormat,
      recoveries, liveFormat, stallTicks, panel: chSheet && chSheet.isOpen() ? 'channels' : trSheet && trSheet.isOpen() ? 'tracks' : null,
    }),
  };
}

export const playerLiveView = playerView;
export const playerVodView = playerView;
