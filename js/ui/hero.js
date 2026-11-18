// The Netflix-style top of the film and series pages: the big stacked buttons (Resume with its
// progress bar, Play From Beginning, Episodes & More, Audio & Subtitles), the small ones on a line
// under them (Trailer, Favourite…), and the muted preview of something you're part way through,
// playing behind the page from where you left it.
import * as store from '../store.js';
import { showDialog } from './dialog.js';
import { toast } from './toast.js';
import { audioSubtitleChoices } from '../detail.js';
import { createPreview } from '../live-preview.js';

export const PREVIEW_AFTER_MS = 2000;

/** A stacked button: its label, and a red progress bar for Resume. */
export function heroButton(b) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pill-btn hero-btn';
  el.dataset.action = b.action;
  const t = document.createElement('span');
  t.className = 'hero-label';
  t.textContent = b.label;
  el.appendChild(t);
  if (b.progress >= 0) {
    const bar = document.createElement('span');
    bar.className = 'hero-progress';
    const fill = document.createElement('span');
    fill.style.width = `${Math.round(Math.max(0.02, Math.min(1, b.progress)) * 1000) / 10}%`;
    bar.appendChild(fill);
    el.appendChild(bar);
  }
  return el;
}

/**
 * Fills the buttons box: the stack, then a line of small pill buttons.
 * @param small (b) => element for a small button
 * @returns all the buttons in order
 */
export function renderButtons(box, list, small) {
  const stack = document.createElement('div');
  stack.className = 'hero-stack';
  const row = document.createElement('div');
  row.className = 'hero-row';
  const out = [];
  for (const b of list) {
    const el = b.hero ? heroButton(b) : small(b);
    (b.hero ? stack : row).appendChild(el);
    out.push(el);
  }
  box.replaceChildren(stack, ...(row.children.length ? [row] : []));
  return out;
}

/** The label text of a page button (a stacked one keeps it in a span). */
export const labelOf = (b) => (b.querySelector('.hero-label') || b).textContent;

/** Audio & Subtitles: the languages the player picks when it can, from the next thing you play. */
export async function askAudioSubtitles() {
  const items = audioSubtitleChoices();
  const which = await showDialog({ title: 'Audio & Subtitles', items: items.map((x) => x.label) }).result;
  if (typeof which !== 'number' || !items[which]) return false;
  items[which].run();
  toast('Used from the next thing you play');
  return true;
}

/** The page's muted preview: the whole page is the picture, the artwork fades away over it. */
export function pagePreview(page) {
  const p = createPreview({
    box: page.el, logo: page.backdrop, radius: 0,
    holes: () => [document.getElementById('backdrop')],
    enabled: () => store.homePreviews() === 1,
    muted: () => true,
  });
  let timer = null;
  return {
    /** After a moment, plays `item` from startMs (only when there's a point to carry on from). */
    schedule(item, startMs) {
      clearTimeout(timer); timer = null;
      if (!item || !(startMs > 0) || store.homePreviews() !== 1) return;
      timer = setTimeout(() => { timer = null; page.el.classList.add('pv-on'); p.start(item, startMs); }, PREVIEW_AFTER_MS);
    },
    stop() {
      clearTimeout(timer); timer = null;
      page.el.classList.remove('pv-on');
      p.stop();
    },
    get pending() { return timer !== null; },
    get playing() { return p.playing; },
  };
}
