// ScrollView / HorizontalScrollView focus scrolling, shared by Home and the series page:
// move just enough to bring the focused child fully on screen (no fading edge), animated over
// 250 ms, or at once when keys come quicker than that.
const SCROLL_MS = 250; // Scroller's default duration (smoothScrollBy)

function viscous(x) {
  x *= 8;
  if (x < 1) x -= 1 - Math.exp(-x);
  else { const start = 0.36787944117; x = start + (1 - Math.exp(1 - x)) * (1 - start); }
  return x;
}
const VISCOUS_NORM = 1 / viscous(1);
const scrollEase = (t) => VISCOUS_NORM * viscous(t);

const scrollState = new WeakMap();
export function scrollBy(el, prop, delta, smooth = true) {
  if (!delta) return;
  let st = scrollState.get(el);
  if (!st) { st = { last: -1e9, raf: 0 }; scrollState.set(el, st); }
  const now = globalThis.performance ? performance.now() : Date.now();
  cancelAnimationFrame(st.raf);
  const from = el[prop];
  const to = from + delta;
  if (!smooth || now - st.last <= SCROLL_MS || typeof requestAnimationFrame !== 'function') {
    el[prop] = to;
  } else {
    const t0 = now;
    const step = (t) => {
      const f = Math.min(1, (t - t0) / SCROLL_MS);
      el[prop] = from + delta * scrollEase(f);
      if (f < 1) st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  }
  st.last = now;
}

/** ScrollView.computeScrollDeltaToGetChildRectOnScreen for one axis. */
export function deltaToShow(start, end, viewStart, viewSize, maxScroll) {
  const viewEnd = viewStart + viewSize;
  let d = 0;
  if (end > viewEnd && start > viewStart) {
    d = end - start > viewSize ? start - viewStart : end - viewEnd;
    d = Math.min(d, maxScroll - viewStart);
  } else if (start < viewStart && end < viewEnd) {
    d = end - start > viewSize ? -(viewEnd - end) : -(viewStart - start);
    d = Math.max(d, -viewStart);
  }
  return d;
}

/** The element's layout box (its focus scale removed) relative to the scroller's content. */
function boxIn(el, scroller, vertical) {
  const r = el.getBoundingClientRect(); const s = scroller.getBoundingClientRect();
  if (vertical) {
    const h = el.offsetHeight || r.height; const c = (r.top + r.bottom) / 2 - s.top + scroller.scrollTop;
    return [c - h / 2, c + h / 2];
  }
  const w = el.offsetWidth || r.width; const c = (r.left + r.right) / 2 - s.left + scroller.scrollLeft;
  return [c - w / 2, c + w / 2];
}

export function bringIntoView(el, scroller, vertical, smooth) {
  if (!el || !scroller) return;
  const [a, b] = boxIn(el, scroller, vertical);
  const d = vertical
    ? deltaToShow(a, b, scroller.scrollTop, scroller.clientHeight, scroller.scrollHeight - scroller.clientHeight)
    : deltaToShow(a, b, scroller.scrollLeft, scroller.clientWidth, scroller.scrollWidth - scroller.clientWidth);
  scrollBy(scroller, vertical ? 'scrollTop' : 'scrollLeft', d, smooth);
}

