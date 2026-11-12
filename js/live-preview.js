// The Live TV preview in the info panel (BrowseActivity.startPreview / stopPreview / releasePreview).
// Tizen has one AVPlay player, drawn on a video plane behind the page; the preview shrinks it into
// the panel's logo box with setDisplayRect and cuts a see-through hole (rounded like the box)
// through the page background and the panel. It is always closed before the full-screen player
// opens (the browse screen releases it when it unmounts) and when the app is hidden.
//
// Without a real AVPlay (desktop browser / tests: the shim), nothing can be drawn, so the box keeps
// showing the channel's artwork: the player calls still happen, the hole and the fade don't.
import * as store from './store.js';
import * as api from './api.js';
import { getAvplay } from './player.js';

export const LOGO_FADE_DELAY_MS = 250;
export const LOGO_FADE_MS = 250;

/** An SVG mask (white = keep) of size w x h with a rounded-rect hole at r ({x, y, w, h}). */
export function holeMask(w, h, r, radius) {
  const x0 = r.x; const y0 = r.y; const x1 = r.x + r.w; const y1 = r.y + r.h;
  const k = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  const hole = `M${x0 + k} ${y0}H${x1 - k}A${k} ${k} 0 0 1 ${x1} ${y0 + k}V${y1 - k}A${k} ${k} 0 0 1 ${x1 - k} ${y1}`
    + `H${x0 + k}A${k} ${k} 0 0 1 ${x0} ${y1 - k}V${y0 + k}A${k} ${k} 0 0 1 ${x0 + k} ${y0}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<path fill="#fff" fill-rule="evenodd" d="M0 0H${w}V${h}H0Z${hole}"/></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

const round = (v) => Math.round(v * 100) / 100;

/**
 * @param o.box       the logo / preview box (its rect is where the video goes)
 * @param o.logo      the artwork layer over the video (fades out once it plays)
 * @param o.holes     elements whose background must let the video through: () => Element[]
 * @param o.radius    the box's corner radius in px
 * @param o.realVideo true when a real AVPlay draws the picture (default: webapis.avplay exists)
 */
export function createPreview(o) {
  let timer = null; let item = null; let opened = false; let seq = 0; let mutedByUs = false;
  const realVideo = () => (o.realVideo !== undefined ? o.realVideo : !!globalThis.webapis?.avplay);
  const avEl = () => document.getElementById('av');

  function setMute(on) {
    const ac = globalThis.tizen && globalThis.tizen.tvaudiocontrol;
    if (!ac) return;
    try {
      if (on && !ac.isMute()) { ac.setMute(true); mutedByUs = true; } else if (!on && mutedByUs) { ac.setMute(false); mutedByUs = false; }
    } catch { /* no audio control on this device */ }
  }

  function punch(on) {
    const html = document.documentElement;
    const els = o.holes ? o.holes() : [];
    if (!on) {
      html.classList.remove('preview-on');
      for (const el of els) if (el) { el.style.webkitMaskImage = ''; el.style.maskImage = ''; }
      return;
    }
    const b = o.box.getBoundingClientRect();
    for (const el of els) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const m = holeMask(round(r.width), round(r.height), { x: round(b.left - r.left), y: round(b.top - r.top), w: round(b.width), h: round(b.height) }, o.radius || 0);
      el.style.webkitMaskImage = m; el.style.maskImage = m;
      el.style.webkitMaskSize = '100% 100%'; el.style.webkitMaskRepeat = 'no-repeat';
    }
    html.classList.add('preview-on');
  }

  function showLogo() {
    o.logo.style.transition = 'none';
    o.logo.style.opacity = '1';
  }

  function ready(my) {
    if (my !== seq || !realVideo()) return; // the shim draws nothing: keep the artwork
    punch(true);
    // Give the decoder a moment to draw its first picture, then uncover it
    o.logo.style.transition = `opacity ${LOGO_FADE_MS}ms linear ${LOGO_FADE_DELAY_MS}ms`;
    o.logo.style.opacity = '0';
  }

  function closePlayer() {
    if (!opened) return;
    opened = false;
    const av = getAvplay();
    try { av.stop(); } catch { /* already idle */ }
    try { av.close(); } catch { /* already closed */ }
    const el = avEl();
    if (el) el.hidden = true;
  }

  const api$ = {
    /** schedulePreview: once you pause on a channel (not while scrolling past). */
    schedule(getItem, delay) {
      clearTimeout(timer); timer = null;
      if (store.previewMode() === 0) return;
      timer = setTimeout(() => { timer = null; const it = getItem(); if (it) api$.start(it); }, delay);
    },
    start(it) {
      if (it === item && opened) return;
      if (store.previewMode() === 0) return;
      closePlayer();
      punch(false);
      item = it;
      const my = ++seq;
      showLogo();
      const av = getAvplay();
      try {
        av.open(api.playUrl(it, store.liveFormat()));
        opened = true;
        const el = avEl();
        if (el && realVideo()) el.hidden = false; // a desktop browser would draw a plugin placeholder
        av.setListener({ onerror: () => { if (my === seq) api$.stop(); } });
        const r = o.box.getBoundingClientRect();
        av.setDisplayRect(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height));
        try { av.setStreamingProperty('USER_AGENT', store.userAgent()); } catch { /* unsupported */ }
        setMute(store.previewMode() === 1);
        av.prepareAsync(() => {
          if (my !== seq) return;
          try { av.play(); } catch { api$.stop(); return; }
          ready(my);
        }, () => { if (my === seq) api$.stop(); }); // an error stops the preview silently
      } catch {
        api$.stop();
      }
    },
    /** stopPreview: nothing pending, nothing playing, the artwork back. */
    stop() {
      clearTimeout(timer); timer = null;
      seq++;
      item = null;
      closePlayer();
      punch(false);
      setMute(false);
      showLogo();
    },
    /** releasePreview: before the full-screen player starts, or when leaving. */
    release() { api$.stop(); },
    get item() { return item; },
    get pending() { return timer !== null; },
    get playing() { return opened; },
  };
  return api$;
}
