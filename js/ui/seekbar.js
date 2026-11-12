// SeekBarView.java in the DOM: a rounded bar (track .25, buffered .40, played white). With a bar
// height set, the bar is drawn centred and thinner than the view, which leaves room at each end
// for the round scrub knob; while scrubbing it is 1.5x thicker, the stretch you're about to jump
// over shows at .60 and the knob (radius = view height / 2.6, 6u shadow) sits on top.
import { u } from './theme.js';

/**
 * @param o.height    view height in design units (VOD 28, live banner 5)
 * @param o.barHeight bar thickness in units (VOD 7); leave out for "the view's full height"
 */
export function createSeekBar(o = {}) {
  const full = u(o.height || 5);
  const barH = o.barHeight ? u(o.barHeight) : 0;
  const el = document.createElement('div');
  el.className = 'seekbar';
  el.style.height = `${full}px`;
  el.innerHTML = '<div class="sb-in"><i class="sb-track"></i><i class="sb-buf"></i><i class="sb-ahead"></i><i class="sb-fill"></i><i class="sb-knob"></i></div>';
  const inner = el.firstChild;
  const [track, buf, ahead, fill, knobEl] = inner.children;
  const pad = barH > 0 ? full / 2 : 0; // room for the knob at either end
  inner.style.left = `${pad}px`;
  inner.style.right = `${pad}px`;
  const kd = (full / 2.6) * 2;
  Object.assign(knobEl.style, { width: `${kd}px`, height: `${kd}px`, marginLeft: `${-kd / 2}px`, top: `${(full - kd) / 2}px` });

  let progress = 0; let buffered = 0; let knob = -1;
  const clamp = (f) => (Number.isNaN(f) || f == null ? 0 : Math.max(0, Math.min(1, f)));

  function draw() {
    const scrub = knob >= 0;
    const h = barH > 0 ? Math.min(barH * (scrub ? 1.5 : 1), full) : full;
    const top = (full - h) / 2;
    for (const b of [track, buf, ahead, fill]) { b.style.top = `${top}px`; b.style.height = `${h}px`; b.style.borderRadius = `${h / 2}px`; }
    const w = (f) => `max(${h}px, ${f * 100}%)`;
    buf.style.display = buffered > 0 ? '' : 'none';
    buf.style.width = w(buffered);
    ahead.style.display = scrub && knob > progress ? '' : 'none';
    ahead.style.width = `${knob * 100}%`;
    const played = scrub ? Math.min(progress, knob) : progress;
    fill.style.display = played > 0 ? '' : 'none';
    fill.style.width = w(played);
    knobEl.style.display = scrub ? '' : 'none';
    knobEl.style.left = `${Math.max(0, knob) * 100}%`;
    el.classList.toggle('scrubbing', scrub);
  }

  draw();
  return {
    el,
    set(p, b = 0) { progress = clamp(p); buffered = clamp(b); draw(); },
    /** 0–1, or -1 for no knob. */
    setKnob(f) { knob = f < 0 ? -1 : clamp(f); draw(); },
    /** Knob centre in px from the view's left edge. */
    knobX() {
      const width = el.getBoundingClientRect().width || el.offsetWidth || 0;
      return pad + (width - pad * 2) * Math.max(0, knob);
    },
    state: () => ({ progress, buffered, knob }),
  };
}
