// Full-screen live player. Params: { channels: Item[], index }. Up/Down/CH+/CH- zap within the list
// (wrapping); OK / Left / Right toggles the Now/Next info overlay. Always stop() before open().
import * as api from '../api.js';
import * as store from '../store.js';
import * as player from '../player.js';

const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, CH_UP: 427, CH_DOWN: 428 };
const OVERLAY_MS = 5000;

export function playerLiveView() {
  let root; let channels; let index; let overlay; let errorEl; let timer; let infoSeq = 0; let onError; let onPlaying;

  const avEl = () => document.getElementById('av');
  const current = () => channels[index];

  function hideOverlay() { clearTimeout(timer); if (overlay) overlay.hidden = true; }

  async function showInfo() {
    const ch = current();
    const seq = ++infoSeq;
    clearTimeout(timer);
    overlay.querySelector('.ch').textContent = `${ch.num ? `${ch.num}  ` : ''}${ch.name}`;
    overlay.querySelector('.now').textContent = '';
    overlay.querySelector('.next').textContent = '';
    overlay.hidden = false;
    timer = setTimeout(hideOverlay, OVERLAY_MS);
    let list = [];
    try { list = await api.epg(ch.id, 2); } catch { /* no EPG */ }
    if (seq !== infoSeq || !overlay) return;
    const line = (p) => (p ? `${p.timeRange()}${p.timeRange() ? '  ' : ''}${p.title}` : '');
    overlay.querySelector('.now').textContent = line(list[0]);
    overlay.querySelector('.next').textContent = line(list[1]);
    const bar = overlay.querySelector('.bar > i');
    bar.style.width = `${Math.round((list[0] ? list[0].progress() : 0) * 100)}%`;
  }

  function tune() {
    errorEl.hidden = true;
    store.addHistory(current());
    player.open(current());
  }

  function zap(step) {
    index = (index + step + channels.length) % channels.length;
    player.stop(); // contract: release the old session before opening the next
    tune();
    showInfo();
  }

  return {
    mount(rootEl, params) {
      root = rootEl;
      channels = params.channels;
      index = params.index || 0;
      root.innerHTML = `<div class="live-player">
        <p class="live-error" hidden>Channel unavailable</p>
        <div class="live-info" hidden><div class="ch"></div><div class="bar"><i></i></div>
        <div class="now"></div><div class="next"></div></div></div>`;
      overlay = root.querySelector('.live-info');
      errorEl = root.querySelector('.live-error');
      const av = avEl();
      if (av) av.hidden = false;
      document.body.classList.add('video-on');
      onError = () => { errorEl.hidden = false; };
      onPlaying = () => { errorEl.hidden = true; };
      player.on('error', onError);
      player.on('playing', onPlaying);
      tune();
      showInfo();
    },
    onKey(e) {
      const k = e.keyCode;
      if (k === KEY.DOWN || k === KEY.CH_UP) { e.preventDefault(); zap(1); return true; } // list order: CH+ = next
      if (k === KEY.UP || k === KEY.CH_DOWN) { e.preventDefault(); zap(-1); return true; }
      if (k === KEY.ENTER || k === KEY.LEFT || k === KEY.RIGHT) {
        e.preventDefault();
        if (overlay.hidden) showInfo(); else hideOverlay();
        return true;
      }
      return false;
    },
    unmount() {
      clearTimeout(timer);
      infoSeq++;
      player.off('error', onError);
      player.off('playing', onPlaying);
      player.stop();
      const av = avEl();
      if (av) av.hidden = true;
      document.body.classList.remove('video-on');
      root = channels = overlay = errorEl = null;
    },
  };
}
