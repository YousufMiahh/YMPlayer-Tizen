// The launch intro: "YOUSUF MIAH" in big letters, then (like a film studio's ident) the letters
// fold away into the Y and the M, which glide together and land in the logo as its tile springs
// up behind them, with a ring of light, the play button and a sweep of shine.
//
//   0–900 ms      the name builds in, letter by letter, slowly pushing in
//   1000–1700 ms  right to left, letters tuck into the Y or the M and vanish
//   1250–1850 ms  the Y and the M glide into the logo
//   1800 ms       the tile springs up (the existing .lock animations), then "YM Player"
//
// Without the Web Animations API (tests), it goes straight to the finished logo.

export const NAME = 'YOUSUF MIAH';
export const TOTAL_MS = 3000;
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The overlay word: one span per letter; data-anchor on the Y and the M. */
export function buildName() {
  const word = document.createElement('div');
  word.className = 'si-word';
  word.setAttribute('aria-hidden', 'true');
  let anchor = null;
  [...NAME].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'si-letter';
    s.textContent = ch === ' ' ? ' ' : ch;
    if (i === 0) { s.dataset.anchor = 'y'; anchor = s; } else if (ch === 'M' && !word.querySelector('[data-anchor="m"]')) { s.dataset.anchor = 'm'; anchor = s; }
    s.dataset.to = anchor.dataset.anchor;
    word.appendChild(s);
  });
  return word;
}

const reduce = () => !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * @param splash  the .splash element (holds .splash-logo with .sl-y / .sl-m)
 * Adds the word, runs the intro, and adds .lock to the splash when the logo should finish building.
 */
export function playIntro(splash) {
  const logo = splash.querySelector('.splash-logo');
  const ty = splash.querySelector('.sl-y'); const tm = splash.querySelector('.sl-m');
  const lock = () => splash.classList.add('lock');
  if (!logo || !ty || !tm || typeof logo.animate !== 'function' || reduce()) { lock(); return; }

  const word = buildName();
  splash.appendChild(word);
  const letters = [...word.querySelectorAll('.si-letter')];
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  // 1. the name builds in
  letters.forEach((l, i) => {
    l.animate([
      { opacity: 0, transform: 'translateY(0.35em) scale(0.92)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ], { duration: 520, delay: 60 + i * 38, easing: EASE_OUT, fill: 'both' });
  });
  const push = word.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }],
    { duration: 1000, easing: 'cubic-bezier(0.3, 0, 0.7, 1)', fill: 'forwards' });

  // 2. right to left, each letter tucks in behind its Y or M and goes
  at(1000, () => {
    const k = 1.05; // the push-in: on-screen distances are k × the letters' own
    const ya = word.querySelector('[data-anchor="y"]'); const ma = word.querySelector('[data-anchor="m"]');
    const edge = { y: ya.getBoundingClientRect(), m: ma.getBoundingClientRect() };
    const folding = letters.filter((l) => !l.dataset.anchor).reverse();
    folding.forEach((l, i) => {
      const r = l.getBoundingClientRect();
      const a = edge[l.dataset.to];
      const dx = (a.right - a.width * 0.25 - r.left) / k; // its left edge into the anchor's right side
      l.animate([
        { transform: 'translateX(0) scaleX(1)', opacity: 1 },
        { transform: `translateX(${dx * 0.7}px) scaleX(0.55)`, opacity: 0.85, offset: 0.6 },
        { transform: `translateX(${dx}px) scaleX(0.05)`, opacity: 0 },
      ], { duration: 360, delay: i * 42, easing: EASE_IN_OUT, fill: 'forwards' });
    });

    // 3. the Y and the M glide onto the logo's letters (measured where they'll be)
    const fold = folding.length * 42 + 120;
    at(fold, () => {
      for (const [from, to] of [[ya, ty], [ma, tm]]) {
        const f = from.getBoundingClientRect(); const t = to.getBoundingClientRect();
        const s = t.height / f.height;
        const dx = (t.left + t.width / 2 - (f.left + f.width / 2)) / k;
        const dy = (t.top + t.height / 2 - (f.top + f.height / 2)) / k;
        from.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
          { duration: 620, easing: EASE_IN_OUT, fill: 'forwards' });
      }
      at(560, () => {
        lock();
        at(90, () => { word.style.transition = 'opacity 160ms linear'; word.style.opacity = '0'; });
        at(400, () => word.remove());
      });
    });
  });
  void push;
  return () => timers.forEach(clearTimeout);
}
