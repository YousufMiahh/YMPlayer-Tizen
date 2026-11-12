// NextUpCard.java: "Watch credits  |  ▶ Next Episode" near the end of an episode. The Next Episode
// button fills up like a timer (white sweep, 10 s, linear); when it's full the next episode
// plays. The text is black over the fill and white over the rest. The countdown pauses while the
// video is paused.
export const COUNTDOWN_MS = 10000;

export function createNextUpCard(parent) {
  const el = document.createElement('div');
  el.className = 'nextup';
  el.hidden = true;
  el.innerHTML = '<button type="button" class="nu-credits" tabindex="-1">Watch credits</button>'
    + '<button type="button" class="nu-next" tabindex="-1">'
    + '<span class="nu-label"><i class="nu-tri"></i>Next Episode</span>'
    + '<span class="nu-fill"><span class="nu-label"><i class="nu-tri"></i>Next Episode</span></span></button>';
  parent.appendChild(el);
  const credits = el.querySelector('.nu-credits');
  const next = el.querySelector('.nu-next');
  const fillEl = el.querySelector('.nu-fill');

  let onNext = null; let timer = null; let running = false; let paused = false;
  let elapsed = 0; let since = 0;
  const now = () => Date.now();

  function paint(f, animateTo) {
    fillEl.style.transition = 'none';
    fillEl.style.width = `${f * 100}%`;
    if (animateTo != null) {
      void fillEl.offsetWidth;
      fillEl.style.transition = `width ${animateTo}ms linear`;
      fillEl.style.width = '100%';
    }
  }

  function run() {
    since = now();
    const left = Math.max(0, COUNTDOWN_MS - elapsed);
    paint(elapsed / COUNTDOWN_MS, left);
    clearTimeout(timer);
    timer = setTimeout(() => {
      running = false; timer = null;
      paint(1);
      if (onNext) onNext();
    }, left);
  }

  const api = {
    el, credits, next,
    /** Shows the countdown from empty and starts it. */
    start(cb) {
      onNext = cb;
      api.stopTimer();
      elapsed = 0; paused = false; running = true;
      run();
    },
    setPaused(p) {
      if (!running) return;
      if (p && !paused) {
        paused = true;
        elapsed += now() - since;
        clearTimeout(timer); timer = null;
        paint(Math.min(1, elapsed / COUNTDOWN_MS));
      } else if (!p && paused) {
        paused = false;
        run();
      }
    },
    stopTimer() {
      clearTimeout(timer); timer = null;
      running = false; paused = false;
    },
    /** 0–1, for tests. */
    fill() { return running ? Math.min(1, (elapsed + (paused ? 0 : now() - since)) / COUNTDOWN_MS) : 0; },
    isRunning: () => running,
    isPaused: () => paused,
    destroy() { api.stopTimer(); el.remove(); },
  };
  return api;
}
