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
 * A square-cornered hole as a clip-path (w x h with the rect r cut out): one outline that runs
 * round the edge and back round the hole, so no mask image has to load (a mask that fails to load
 * hides the whole element: the page went black behind Home's preview).
 */
export function holeClip(w, h, r) {
  const x0 = r.x; const y0 = r.y; const x1 = r.x + r.w; const y1 = r.y + r.h;
  const p = (x, y) => `${round(x)}px ${round(y)}px`;
  return `polygon(${[p(0, 0), p(0, h), p(x0, h), p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1), p(x0, h), p(w, h), p(w, 0)].join(', ')})`;
}

/** How long a preview that was moved off keeps decoding, hidden, before AVPlay is closed. */
export const CLOSE_AFTER_MS = 700;

// ------------------------------------------------------------ the TV's own mute
//
// A muted preview mutes the whole TV (AVPlay has no volume of its own). The app must never leave
// the TV muted behind it: MUTE_FLAG records, on the TV's storage, that it was the app that muted,
// so the sound comes back when the preview stops, when the app is hidden or closed, and, if the
// app died before it could, the next time it starts.
export const MUTE_FLAG = 'preview_muted_tv';
const flag = {
  get() { try { return globalThis.localStorage.getItem(MUTE_FLAG) === 'true'; } catch { return false; } },
  set(on) { try { if (on) globalThis.localStorage.setItem(MUTE_FLAG, 'true'); else globalThis.localStorage.removeItem(MUTE_FLAG); } catch { /* no storage */ } },
};
const audio = () => (globalThis.tizen && globalThis.tizen.tvaudiocontrol) || null;

/** Mute the TV for a muted preview (a TV the viewer muted themselves is left alone). */
export function muteTv() {
  const ac = audio();
  if (!ac) return;
  try {
    if (ac.isMute()) return;
    flag.set(true); // before the call: if the app dies right after it, the next launch still knows
    ac.setMute(true);
  } catch { flag.set(false); /* no audio control on this device */ }
}

/** Give the sound back if the app took it. Safe to call at any time. @returns true if it unmuted. */
export function restoreTvMute() {
  if (!flag.get()) return false;
  const ac = audio();
  if (!ac) { flag.set(false); return false; }
  try { ac.setMute(false); } catch { return false; } // still flagged: tried again at the next chance
  flag.set(false);
  return true;
}

/**
 * @param o.box       the logo / preview box (its rect is where the video goes)
 * @param o.logo      the artwork layer over the video (fades out once it plays)
 * @param o.holes     elements whose background must let the video through: () => Element[]
 * @param o.radius    the box's corner radius in px
 * @param o.realVideo true when a real AVPlay draws the picture (default: webapis.avplay exists)
 * @param o.enabled   () => whether previews are on (default: Settings → Live TV Preview isn't Off)
 * @param o.muted     () => whether it plays muted (default: Live TV Preview is "On (muted)")
 * Films and episodes (the film / series page, Home's cards) pass their own enabled and muted, and a
 * start point: start(item, startMs).
 */
export function createPreview(o) {
  let timer = null; let item = null; let opened = false; let seq = 0;
  const enabled = () => (o.enabled ? o.enabled() : store.previewMode() !== 0);
  const muted = () => (o.muted ? o.muted() : store.previewMode() === 1);
  const realVideo = () => (o.realVideo !== undefined ? o.realVideo : !!globalThis.webapis?.avplay);
  const avEl = () => document.getElementById('av');

  function setMute(on) {
    if (on) muteTv(); else restoreTvMute();
  }

  function punch(on) {
    const html = document.documentElement;
    const els = o.holes ? o.holes() : [];
    if (!on) {
      html.classList.remove('preview-on');
      for (const el of els) {
        if (!el) continue;
        el.style.webkitMaskImage = ''; el.style.maskImage = '';
        el.style.webkitClipPath = ''; el.style.clipPath = '';
      }
      return;
    }
    const b = o.box.getBoundingClientRect();
    for (const el of els) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!o.radius) {
        const c = holeClip(r.width, r.height, { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height });
        el.style.webkitClipPath = c; el.style.clipPath = c;
        continue;
      }
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

  // Stopping and closing AVPlay are synchronous and can hold the page for a moment, so moving off a
  // preview only hides it (the page covers the video plane again) and the player is closed once
  // you rest, or right before the next preview opens: the move itself stays smooth.
  let closing = false; let closeTimer = null;
  function shut() {
    clearTimeout(closeTimer); closeTimer = null;
    if (!closing) return;
    closing = false;
    const av = getAvplay();
    if (av) {
      try { av.stop(); } catch { /* already idle */ }
      try { av.close(); } catch { /* already closed */ }
    }
    const el = avEl();
    if (el) el.hidden = true;
  }
  function closeLater() {
    if (opened) { opened = false; closing = true; }
    if (!closing) { setMute(false); return; }
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { shut(); if (!opened) setMute(false); }, CLOSE_AFTER_MS);
  }

  function closePlayer() {
    shut();
    if (!opened) return;
    opened = false;
    const av = getAvplay();
    if (!av) return;
    try { av.stop(); } catch { /* already idle */ }
    try { av.close(); } catch { /* already closed */ }
    const el = avEl();
    if (el) el.hidden = true;
  }

  const api$ = {
    /** schedulePreview: once you pause on a channel (not while scrolling past). */
    schedule(getItem, delay) {
      clearTimeout(timer); timer = null;
      if (!enabled()) return;
      timer = setTimeout(() => { timer = null; const it = getItem(); if (it) api$.start(it); }, delay);
    },
    start(it, startMs = 0) {
      if (it === item && opened) return;
      if (!enabled()) return;
      closePlayer();
      punch(false);
      item = it;
      const my = ++seq;
      showLogo();
      const av = getAvplay();
      if (!av) return; // a TV without AVPlay: the artwork stays (the full-screen player says why)
      try {
        av.open(api.playUrl(it, store.liveFormat()));
        opened = true;
        const el = avEl();
        if (el && realVideo()) el.hidden = false; // a desktop browser would draw a plugin placeholder
        av.setListener({ onerror: () => { if (my === seq) api$.stop(); } });
        const r = o.box.getBoundingClientRect();
        av.setDisplayRect(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height));
        try { av.setStreamingProperty('USER_AGENT', store.userAgent()); } catch { /* unsupported */ }
        // PlayerFactory.create(preview): show the picture after a short buffer (Android 0.3 s;
        // AVPlay counts in whole seconds, so 1 s)
        try { if (typeof av.setBufferingParam === 'function') av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 1); } catch { /* unsupported */ }
        setMute(muted());
        av.prepareAsync(() => {
          if (my !== seq) return;
          const go = () => {
            if (my !== seq) return;
            try { av.play(); } catch { api$.stop(); return; }
            ready(my);
          };
          if (startMs > 0) {
            try { av.seekTo(Math.floor(startMs), go, go); } catch { go(); }
          } else go();
        }, () => { if (my === seq) api$.stop(); }); // an error stops the preview silently
      } catch {
        api$.stop();
      }
    },
    /**
     * stopPreview: nothing pending, nothing playing, the artwork back.
     * @param later  hide it now and close the player a moment later (moving along Home's rows)
     */
    stop(later = false) {
      clearTimeout(timer); timer = null;
      seq++;
      item = null;
      punch(false);
      showLogo();
      if (later) { closeLater(); return; }
      closePlayer();
      setMute(false);
    },
    /**
     * The box moved or changed size (the TV guide's layout glide): the picture and the hole follow
     * it, as the Android preview view moves with its parent.
     */
    relayout() {
      if (!opened) return;
      const r = o.box.getBoundingClientRect();
      try { const av = getAvplay(); if (av) av.setDisplayRect(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)); } catch { /* not ready */ }
      if (document.documentElement.classList.contains('preview-on')) punch(true);
    },
    /** releasePreview: before the full-screen player starts, or when leaving. */
    release() { api$.stop(); },
    /** The artwork over the video (Home moves one preview from card to card). */
    setLogo(el) { o.logo = el; },
    get item() { return item; },
    get pending() { return timer !== null; },
    get playing() { return opened; },
    get closing() { return closing; },
  };
  return api$;
}
