// The trailer screen (TrailerActivity.java's embedded player). Params: { id }.
// A full-screen black page holding the youtube-nocookie iframe with Android's parameters. No API
// key. The screen saver is held off while it is up (FLAG_KEEP_SCREEN_ON); Back closes it.
//
// Keys stay with this page (the iframe never takes focus, so Back always works): OK and the media
// keys play / pause, ◀ / RW go back 5 s and ▶ / FF forward 10 s, through the embed's postMessage
// commands. If the player reports an error (removed, private, not embeddable…) or the embed
// doesn't load within LOAD_TIMEOUT_MS, the screen closes with "No trailer available", the same
// words Android uses when a title has none.
import { router } from '../router.js';
import { toast } from '../ui/toast.js';
import { embedUrl, EMBED_HOST, NO_TRAILER } from '../trailer.js';

export const LOAD_TIMEOUT_MS = 20000;
const KEY = {
  ENTER: 13, LEFT: 37, RIGHT: 39, PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, RW: 412, FF: 417,
};
const PLAYING = 1;

export function trailerView() {
  let root; let el; let frame; let timer = null; let failed = false;
  let state = -1; let time = 0; let onMessage; let onLoad; let alive = false;

  function screenSaver(on) {
    const ac = globalThis.webapis && globalThis.webapis.appcommon;
    if (!ac || typeof ac.setScreenSaver !== 'function') return;
    const st = ac.AppCommonScreenSaverState || {};
    try { ac.setScreenSaver(on ? st.SCREEN_SAVER_ON : st.SCREEN_SAVER_OFF); } catch { /* not allowed */ }
  }

  function send(msg) {
    try { frame.contentWindow.postMessage(JSON.stringify(msg), EMBED_HOST); } catch { /* gone */ }
  }
  const command = (func, args = []) => send({ event: 'command', func, args });

  /** The embed failed: back to the page that opened it, with Android's words. */
  function fail() {
    if (failed || !alive) return;
    failed = true;
    toast(NO_TRAILER);
    if (router.current() && router.current().name === 'trailer') router.back();
  }

  return {
    mount(rootEl, params) {
      root = rootEl; failed = false; state = -1; time = 0; alive = true;
      el = document.createElement('div');
      el.className = 'trailer';
      el.tabIndex = -1;
      frame = document.createElement('iframe');
      frame.className = 'trailer-frame';
      frame.setAttribute('allow', 'autoplay; encrypted-media; fullscreen');
      frame.setAttribute('allowfullscreen', '');
      frame.tabIndex = -1;
      frame.src = embedUrl(params.id);
      el.appendChild(frame);
      root.appendChild(el);
      el.focus({ preventScroll: true });
      screenSaver(false);

      onLoad = () => {
        clearTimeout(timer); timer = null;
        send({ event: 'listening', id: 'ym-trailer', channel: 'widget' }); // ask for state / errors
      };
      frame.addEventListener('load', onLoad);
      timer = setTimeout(fail, LOAD_TIMEOUT_MS);

      onMessage = (e) => {
        if (!frame || e.source !== frame.contentWindow) return;
        let d = e.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
        if (!d || typeof d !== 'object') return;
        if (d.event === 'onError') { fail(); return; }
        const info = d.info && typeof d.info === 'object' ? d.info : null;
        if (d.event === 'onStateChange' && typeof d.info === 'number') state = d.info;
        if (info && typeof info.playerState === 'number') state = info.playerState;
        if (info && typeof info.currentTime === 'number') time = info.currentTime;
      };
      window.addEventListener('message', onMessage);
    },
    onKey(e) {
      if (!root) return false;
      const k = e.keyCode;
      if (k === KEY.ENTER || k === KEY.PLAY_PAUSE) {
        e.preventDefault();
        if (!e.repeat) command(state === PLAYING ? 'pauseVideo' : 'playVideo');
        return true;
      }
      if (k === KEY.PLAY) { e.preventDefault(); command('playVideo'); return true; }
      if (k === KEY.PAUSE) { e.preventDefault(); command('pauseVideo'); return true; }
      if (k === KEY.LEFT || k === KEY.RW || k === KEY.RIGHT || k === KEY.FF) {
        e.preventDefault();
        time = Math.max(0, time + (k === KEY.LEFT || k === KEY.RW ? -5 : 10));
        command('seekTo', [time, true]);
        return true;
      }
      return k === 38 || k === 40; // nothing to move to
    },
    unmount() {
      alive = false;
      clearTimeout(timer); timer = null;
      window.removeEventListener('message', onMessage);
      if (frame) {
        frame.removeEventListener('load', onLoad);
        frame.src = 'about:blank'; // web.loadUrl("about:blank"); web.destroy()
        frame.remove();
      }
      screenSaver(true);
      root = el = frame = null;
    },
  };
}
