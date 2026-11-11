// Full-screen VOD player. Params: { item, startMs?, queue?, index? }. `queue` is the ordered episode
// list; when an episode ends the next one opens (crossing seasons), a movie / last episode goes back.
// With no startMs and a stored position, a Resume / Start over prompt is shown first.
// Always stop() before open().
import * as store from '../store.js';
import * as player from '../player.js';
import * as nav from '../nav.js';
import { router } from '../router.js';
import { formatTime } from './movie-detail.js';

const KEY = { LEFT: 37, RIGHT: 39, ENTER: 13 };
const BACK_MS = 10000;
const FWD_MS = 30000;
const OVERLAY_MS = 5000;

export function playerVodView() {
  let root; let item; let queue; let index; let pos = 0; let dur = 0; let paused = false;
  let controls; let errorEl; let prompt; let timer;
  let onError; let onPlaying; let onEnded; let onTime; let onClick; let onActivate;

  const avEl = () => document.getElementById('av');

  function hideControls() { clearTimeout(timer); if (controls) controls.hidden = true; }

  function paint() {
    if (!controls) return;
    controls.querySelector('.t').textContent = `${formatTime(pos)}${dur > 0 ? ` / ${formatTime(dur)}` : ''}`;
    controls.querySelector('.bar > i').style.width = dur > 0 ? `${Math.min(100, Math.round((pos / dur) * 100))}%` : '0%';
    controls.querySelector('.st').textContent = paused ? '❚❚' : '▶';
  }

  function showControls() {
    clearTimeout(timer);
    dur = store.duration(item) || dur; // begin() resets dur per item
    controls.querySelector('.title').textContent = item.parentName ? `${item.parentName} — ${item.name}` : item.name;
    controls.hidden = false;
    paint();
    timer = setTimeout(hideControls, OVERLAY_MS);
  }

  function begin(startMs) {
    prompt.hidden = true;
    errorEl.hidden = true;
    pos = startMs; paused = false;
    dur = store.duration(item) || 0; // each item starts from its own stored duration
    store.addHistory(item);
    player.stop(); // contract: release any previous session before opening the next
    player.open(item, { startMs });
  }

  function advance() {
    if (queue && index + 1 < queue.length) {
      index += 1;
      item = queue[index];
      begin(0);
      showControls();
    } else {
      router.back();
    }
  }

  function seekBy(delta) {
    pos = Math.max(0, pos + delta);
    player.seek(pos);
    showControls();
  }

  return {
    mount(rootEl, params) {
      root = rootEl;
      item = params.item; queue = params.queue; index = params.index ?? (queue ? queue.findIndex((e) => e.id === item.id) : 0);
      root.innerHTML = `<div class="live-player vod-player">
        <p class="live-error" hidden>Playback failed</p>
        <div class="vod-prompt" hidden><p></p>
          <button type="button" data-action="resume">Resume</button>
          <button type="button" data-action="restart">Start over</button></div>
        <div class="live-info vod-controls" hidden><div class="title"></div><div class="bar"><i></i></div>
          <div><span class="st"></span> <span class="t"></span></div></div></div>`;
      controls = root.querySelector('.vod-controls');
      errorEl = root.querySelector('.live-error');
      prompt = root.querySelector('.vod-prompt');
      const av = avEl();
      if (av) av.hidden = false;
      document.body.classList.add('video-on');
      onError = () => { errorEl.hidden = false; };
      onPlaying = () => { errorEl.hidden = true; };
      onEnded = () => advance();
      onTime = (ms) => { pos = ms; if (!controls.hidden) paint(); };
      player.on('error', onError);
      player.on('playing', onPlaying);
      player.on('ended', onEnded);
      player.on('timeupdate', onTime);

      onClick = (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        begin(b.dataset.action === 'resume' ? store.position(item) : 0);
        showControls();
      };
      onActivate = (e) => { e.target.closest('button')?.click(); };
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      nav.register(root);

      const saved = store.position(item);
      if (params.startMs === undefined && saved > 0) {
        prompt.querySelector('p').textContent = `Resume from ${formatTime(saved)}?`;
        prompt.hidden = false;
        prompt.querySelector('[data-action="resume"]').focus();
      } else {
        begin(params.startMs || 0);
      }
    },
    onKey(e) {
      if (!prompt.hidden) return false; // nav moves focus / activates the prompt buttons
      const k = e.keyCode;
      if (k === KEY.LEFT) { e.preventDefault(); seekBy(-BACK_MS); return true; }
      if (k === KEY.RIGHT) { e.preventDefault(); seekBy(FWD_MS); return true; }
      if (k === KEY.ENTER) {
        e.preventDefault();
        if (controls.hidden) showControls();
        else { paused = !paused; if (paused) player.pause(); else player.play(); showControls(); }
        return true;
      }
      return false;
    },
    unmount() {
      clearTimeout(timer);
      player.off('error', onError);
      player.off('playing', onPlaying);
      player.off('ended', onEnded);
      player.off('timeupdate', onTime);
      if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('activate', onActivate);
      }
      player.stop();
      const av = avEl();
      if (av) av.hidden = true;
      document.body.classList.remove('video-on');
      root = item = queue = controls = errorEl = prompt = null;
    },
  };
}
