// Port of Ambient.java + ImageLoader.average(): the window background is a 4-stop vertical gradient
// [tone, mix(tone,BG,.45), mix(tone,BG,.85), BG] that starts at the section's resting colour and
// cross-fades (700 ms) to the main colour of whatever artwork has focus.
//
// Two stacked layers are cross-faded with opacity. Because every stop is linear in the top colour,
// fading layer B (target) over layer A (current) paints exactly the ARGB-interpolated gradient
// Android draws, but runs on the compositor instead of repainting 1920x1080 every frame.
import { colors, isDark, accelDecel } from './theme.js';

/** Resting colours per section (Ambient.java:21-22). Keys are the Tizen route names. */
export const SECTION_COLORS = {
  home: 0x2A2F7A, live: 0x0F5C66, movies: 0x6A1F4A, series: 0x1F4E8C, search: 0x4A2A80, settings: 0x3A3F52,
};
export const FALLBACK = 0x3A3F52; // ImageLoader.average() when nothing usable is found
export const FADE_MS = 700;
export const TINT_DELAY_MS = 200; // tint() waits this long for focus to rest before touching the image
const LRU_MAX = 600;

// ------------------------------------------------------------ colour maths (pure, tested)

const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const pack = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
export const hex = (c) => `#${(c & 0xFFFFFF).toString(16).padStart(6, '0')}`;

/** android.graphics.Color.colorToHSV */
export function toHsv(c) {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

/** android.graphics.Color.HSVToColor */
export function fromHsv(h, s, v) {
  const c = v * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = v - c;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return pack(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Ambient.tone(): any colour -> a rich-but-calm background tone for the theme. */
export function tone(c, dark = isDark()) {
  let [h, s] = toHsv(c);
  if (s < 0.12) { h = 228; s = 0.30; }
  if (dark) return fromHsv(h, clamp(Math.max(s * 1.25, 0.35), 0.35, 0.85), 0.46);
  return fromHsv(h, clamp(s * 0.55, 0.10, 0.32), 0.97);
}

/** Ambient.mix(): integer channel lerp (truncating, like the Java cast). */
export function mix(a, b, t) {
  const A = rgb(a); const B = rgb(b);
  return pack(...A.map((v, i) => Math.trunc(v + (B[i] - v) * t)));
}

/** Ambient.colors(): the four gradient stops. */
export function stops(top, bg = colors().BG) {
  return [top, mix(top, bg, 0.45), mix(top, bg, 0.85), bg];
}

export function gradient(top) {
  const s = stops(top).map(hex);
  return `linear-gradient(to bottom, ${s[0]} 0%, ${s[1]} 33.333%, ${s[2]} 66.667%, ${s[3]} 100%)`;
}

/**
 * ImageLoader.average() over RGBA pixel data (already scaled to 12x12): skip alpha < 128,
 * weight pixels by S*V ignoring greys/whites/blacks (S < .18 or V < .12), else plain average.
 */
export function dominant(data) {
  let r = 0; let g = 0; let bl = 0; let n = 0; let ar = 0; let ag = 0; let ab = 0; let an = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const pr = data[i]; const pg = data[i + 1]; const pb = data[i + 2];
    ar += pr; ag += pg; ab += pb; an++;
    const [, s, v] = toHsv(pack(pr, pg, pb));
    if (s < 0.18 || v < 0.12) continue;
    const w = s * v;
    r += Math.trunc(pr * w * 100); g += Math.trunc(pg * w * 100); bl += Math.trunc(pb * w * 100);
    n += Math.trunc(w * 100);
  }
  if (n > 0) return pack(Math.trunc(r / n), Math.trunc(g / n), Math.trunc(bl / n));
  if (an > 0) return pack(Math.trunc(ar / an), Math.trunc(ag / an), Math.trunc(ab / an));
  return FALLBACK;
}

/** ARGB lerp, as ArgbEvaluator. */
export function lerp(a, b, t) {
  const A = rgb(a); const B = rgb(b);
  return pack(...A.map((v, i) => Math.round(v + (B[i] - v) * t)));
}

// ------------------------------------------------------------ image -> colour (browser only)

const cache = new Map(); // LRU of url -> colour
const failed = new Set();

function remember(url, c) {
  cache.delete(url);
  cache.set(url, c);
  if (cache.size > LRU_MAX) cache.delete(cache.keys().next().value);
}

/**
 * Default sampler: fetch the image as a Blob (a provider <img> would taint the canvas), draw it at
 * 12x12 and read the pixels. Rejects on any failure.
 */
async function sampleUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = obj; });
    const cv = document.createElement('canvas');
    cv.width = 12; cv.height = 12;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, 12, 12);
    return ctx.getImageData(0, 0, 12, 12).data;
  } finally {
    URL.revokeObjectURL(obj);
  }
}

let sampler = sampleUrl;
/** Tests swap the pixel source. */
export function setSampler(fn) { sampler = fn || sampleUrl; }

/** Main colour of an image, cached; resolves null when it can't be read (Android: no callback). */
export async function colorOf(url) {
  if (!url || failed.has(url)) return null;
  if (cache.has(url)) { const c = cache.get(url); remember(url, c); return c; }
  try {
    const c = dominant(await sampler(url));
    remember(url, c);
    return c;
  } catch {
    failed.add(url);
    return null;
  }
}

// ------------------------------------------------------------ the background itself

let host = null; let layerA = null; let layerB = null;
let base = SECTION_COLORS.home;
let from = null; let to = null; let startedAt = 0;
let lastUrl = null;
let clock = () => (globalThis.performance ? performance.now() : Date.now());
/** Tests control time. */
export function setClock(fn) { clock = fn || (() => (globalThis.performance ? performance.now() : Date.now())); }

/** Colour on screen right now (mid-fade aware). */
export function current() {
  if (to === null) return null;
  if (from === null) return to;
  const t = Math.min(1, (clock() - startedAt) / FADE_MS);
  return t >= 1 ? to : lerp(from, to, accelDecel(t));
}

/** Create the background layers (once) behind #root. */
export function install(parent = document.body) {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.id = 'backdrop';
  host.setAttribute('aria-hidden', 'true');
  layerA = document.createElement('div');
  layerB = document.createElement('div');
  layerA.className = 'bd-layer'; layerB.className = 'bd-layer';
  host.append(layerA, layerB);
  parent.insertBefore(host, parent.firstChild);
  if (to !== null) paint(to, null);
  return host;
}

export function uninstall() {
  if (host) host.remove();
  host = layerA = layerB = null;
  cancelTint();
  from = to = lastUrl = null;
}

function paint(fromColor, target) {
  if (!host) return;
  layerA.style.background = gradient(fromColor);
  if (target === null) {
    layerB.style.transition = 'none';
    layerB.style.opacity = '0';
    return;
  }
  layerB.style.transition = 'none';
  layerB.style.opacity = '0';
  layerB.style.background = gradient(target);
  void layerB.offsetWidth; // commit opacity 0 before fading in
  layerB.style.transition = `opacity ${FADE_MS}ms var(--ease-std)`;
  layerB.style.opacity = '1';
}

function animateTo(target) {
  const now = current();
  if (now === null) { // first paint: no fade (Ambient.install without a hand-off)
    from = null; to = target;
    paint(target, null);
    return;
  }
  from = now; to = target; startedAt = clock();
  paint(from, target);
}

let tintTimer = null; let tintDone = null;
/** Drop a tint that is still waiting (its promise resolves; nothing is fetched or painted). */
function cancelTint() {
  clearTimeout(tintTimer); tintTimer = null;
  const d = tintDone; tintDone = null;
  if (d) d();
}

/** Switch to a section's resting colour, fading from whatever is showing (Ambient hand-off). */
export function setSection(section) {
  base = SECTION_COLORS[section] ?? SECTION_COLORS.home;
  lastUrl = null; cancelTint();
  animateTo(tone(base));
}

/**
 * Fade towards the main colour of this artwork (Ambient.tint). Unreadable art leaves it as is.
 * Debounced: holding a direction key passes many cards, and only the one focus rests on has its
 * image fetched, decoded and faded to. Resolves once this request is applied or superseded.
 */
export function tint(url) {
  if (!url || url === lastUrl) return Promise.resolve();
  lastUrl = url;
  cancelTint();
  return new Promise((resolve) => {
    tintDone = resolve;
    tintTimer = setTimeout(async () => {
      tintTimer = null; tintDone = null;
      if (lastUrl === url) {
        const c = await colorOf(url);
        if (c !== null && lastUrl === url) animateTo(tone(c)); // else failed (Android: no change) or superseded
      }
      resolve();
    }, TINT_DELAY_MS);
  });
}

/** Fade back to a fixed colour (Ambient.tintColor). */
export function tintColor(c) {
  lastUrl = null; cancelTint();
  animateTo(tone(c));
}

/** Theme changed: repaint with the new BG and tone rules. */
export function retheme() {
  lastUrl = null; cancelTint();
  from = null; to = null;
  animateTo(tone(base));
}

export const section = () => Object.keys(SECTION_COLORS).find((k) => SECTION_COLORS[k] === base);
export const _reset = () => { cancelTint(); cache.clear(); failed.clear(); from = to = lastUrl = null; base = SECTION_COLORS.home; };
