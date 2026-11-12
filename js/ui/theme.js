// Design constants ported from Ui.java. CSS tokens live in css/theme.css; this is the JS side.

/** CSS px per Android design unit at 1920x1080 (Ui.unit()). */
export const UNIT = 1.4;
/** Android design units -> CSS px. */
export const u = (v) => v * UNIT;

/**
 * Hold-OK threshold. Android uses 450 ms wherever it times the press itself (EpgGrid.java:154,
 * PlayerActivity.java:980) and the system long-press (~400-500 ms) elsewhere.
 */
export const LONG_PRESS_MS = 450;

/** Samsung remotes have no ☰ key, so every hint uses Android's non-Fire-TV wording. */
export const HOLD_OK = 'Hold OK';

const DARK = {
  BG: 0x0A0B12, BG_TOP: 0x1C2040, TEXT: 0xFFFFFF,
};
const LIGHT = {
  BG: 0xF2F2F7, BG_TOP: 0xFFFFFF, TEXT: 0x000000,
};

let dark = true;

/** Ui.applyTheme: switch the token set (html.light) and the colours JS code reads. */
export function applyTheme(isDark) {
  dark = isDark !== false;
  const html = globalThis.document && document.documentElement;
  if (html) html.classList.toggle('light', !dark);
}

export const isDark = () => dark;
export const colors = () => (dark ? DARK : LIGHT);

/** DecelerateInterpolator(f): 1 - (1 - t)^(2f). */
export const decelerate = (f) => (t) => 1 - (1 - t) ** (2 * f);
/** AccelerateDecelerateInterpolator (ValueAnimator default). */
export const accelDecel = (t) => Math.cos((t + 1) * Math.PI) / 2 + 0.5;
