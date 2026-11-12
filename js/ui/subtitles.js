// Subtitle renderer. AVPlay doesn't draw subtitles on the video plane: it hands each line to
// onsubtitlechange(duration, text), so the app draws them here, styled as ExoEngine.
// applySubtitleStyle does it on Android: fractional text size of the screen height, one of six
// colours, SemiBold, a drop shadow (0xE6000000) or a black background at the chosen opacity,
// 7 % bottom padding, embedded styles ignored.
import * as store from '../store.js';

/** PlayerActivity.SUB_SIZES (fraction of the video height). */
export const SUB_SIZES = [0.045, 0.056, 0.068, 0.085];
/** SettingsActivity.SUB_SIZES. */
export const SUB_SIZE_NAMES = ['Small', 'Medium', 'Large', 'Extra Large'];
export const SUB_COLOR_NAMES = ['White', 'Yellow', 'Cyan', 'Green', 'Pink', 'Orange'];
export const SUB_COLORS = ['#FFFFFF', '#FFE14D', '#5AE0FF', '#6BEA7A', '#FF8AD8', '#FFA94D'];
export const SUB_OPACITY_NAMES = ['25%', '50%', '75%', '100%'];
export const SUB_OPACITY_ALPHA = [0x40, 0x80, 0xBF, 0xFF];
const VIDEO_H = 1080;
const BOTTOM = 0.07;

/** The look from the prefs, as CSS values. */
export function style() {
  const size = Math.max(0, Math.min(SUB_SIZES.length - 1, store.subtitleSize()));
  const bg = store.subtitleBackground();
  const a = SUB_OPACITY_ALPHA[store.subtitleOpacity()] / 255;
  return {
    fontSize: Math.round(SUB_SIZES[size] * VIDEO_H * 10) / 10,
    color: SUB_COLORS[store.subtitleColor()] || SUB_COLORS[0],
    background: bg ? `rgba(0, 0, 0, ${Math.round(a * 1000) / 1000})` : 'transparent',
    // CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW with 0xE6000000
    textShadow: bg ? 'none' : '2px 2px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.9)',
    bottom: Math.round(BOTTOM * VIDEO_H),
  };
}

/** Plain text of a cue: tags stripped (embedded styles are ignored, as on Android), line breaks kept. */
export function cleanText(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '') // SSA override tags
    .replace(/\\N/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).filter((l) => l)
    .join('\n');
}

export function createSubtitleOverlay(parent) {
  const el = document.createElement('div');
  el.className = 'pl-subs';
  el.setAttribute('aria-live', 'off');
  parent.appendChild(el);
  let timer = null;

  function applyStyle() {
    const s = style();
    el.style.bottom = `${s.bottom}px`;
    el.style.setProperty('--sub-size', `${s.fontSize}px`);
    el.style.setProperty('--sub-color', s.color);
    el.style.setProperty('--sub-bg', s.background);
    el.style.setProperty('--sub-shadow', s.textShadow);
  }

  function clear() { clearTimeout(timer); timer = null; el.replaceChildren(); }

  /** Show a cue for `duration` ms (0 = until the next one). Empty text clears. */
  function show(text, duration = 0) {
    clearTimeout(timer);
    const t = cleanText(text);
    el.replaceChildren();
    if (!t) return;
    for (const line of t.split('\n')) {
      const row = document.createElement('div');
      const span = document.createElement('span');
      span.className = 'pl-sub-line';
      span.textContent = line;
      row.appendChild(span);
      el.appendChild(row);
    }
    if (duration > 0) timer = setTimeout(clear, duration);
  }

  applyStyle();
  return { el, show, clear, applyStyle, text: () => [...el.querySelectorAll('.pl-sub-line')].map((s) => s.textContent).join('\n'), destroy() { clear(); el.remove(); } };
}
