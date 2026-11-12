// AlertDialog as Android shows it: every dialog in the Java is an AlertDialog.Builder with
// Theme_Material_Dialog_Alert (dark) / Theme_Material_Light_Dialog_Alert (light). Title, message,
// then the button bar (neutral … negative, positive) or a list of items (Builder.setItems).
// D-pad moves between buttons/items, OK picks, Back closes (resolves null).
export const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27 };

let openCount = 0;
export const isOpen = () => openCount > 0;

/**
 * @param o.title     string
 * @param o.message   string (optional)
 * @param o.positive  label (right-most button)    -> resolves 'positive'
 * @param o.negative  label                        -> resolves 'negative'
 * @param o.neutral   label (left-most button)     -> resolves 'neutral'
 * @param o.items     string[] (setItems)          -> resolves the item index
 * @param o.focus     'positive'|'negative'|'neutral'|number  initial focus (default: first)
 * @returns {{ el, result: Promise<string|number|null>, close(value?) }}
 */
export function showDialog(o = {}) {
  const prevFocus = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = 'dialog-scrim';
  const box = document.createElement('div');
  box.className = 'dialog';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  scrim.appendChild(box);

  if (o.title) {
    const t = document.createElement('div');
    t.className = 'dialog-title';
    t.textContent = o.title;
    box.appendChild(t);
  }
  if (o.message) {
    const m = document.createElement('div');
    m.className = 'dialog-message';
    m.textContent = o.message;
    box.appendChild(m);
  }
  if (o.content) box.appendChild(o.content);

  const targets = []; // focusable things in D-pad order
  let vertical = false;
  if (Array.isArray(o.items) && o.items.length) {
    vertical = true;
    const list = document.createElement('div');
    list.className = 'dialog-items';
    o.items.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dialog-item'; b.textContent = label;
      b.dataset.value = String(i);
      list.appendChild(b);
      targets.push(b);
    });
    box.appendChild(list);
  }
  const btns = [['neutral', o.neutral], ['negative', o.negative], ['positive', o.positive]].filter(([, l]) => l);
  if (btns.length) {
    const bar = document.createElement('div');
    bar.className = 'dialog-buttons';
    btns.forEach(([key, label], i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'dialog-button'; b.textContent = label;
      b.dataset.value = key;
      if (key === 'neutral' && btns.length > 1) b.classList.add('neutral'); // pushed to the left
      bar.appendChild(b);
      targets.push(b);
      if (i === 0 && key !== 'neutral') bar.classList.add('right');
    });
    box.appendChild(bar);
  }

  let done; const result = new Promise((r) => { done = r; });
  let closed = false;
  const root = document.getElementById('root');

  function close(value = null) {
    if (closed) return;
    closed = true;
    openCount--;
    window.removeEventListener('keydown', onKey, true);
    scrim.classList.remove('on');
    scrim.remove();
    if (root && openCount === 0) root.removeAttribute('inert');
    if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus();
    if (o.onClose) o.onClose(value);
    done(value);
  }

  function pick(el) {
    const v = el.dataset.value;
    close(/^\d+$/.test(v) ? Number(v) : v);
  }

  function onKey(e) {
    const k = e.keyCode;
    const i = targets.indexOf(document.activeElement);
    const step = (d) => { const t = targets[Math.max(0, Math.min(targets.length - 1, (i < 0 ? 0 : i) + d))]; if (t) t.focus(); };
    if (k === KEY.BACK || k === KEY.ESC) close(null);
    else if (k === KEY.ENTER) { if (!e.repeat && i >= 0) pick(targets[i]); else if (i < 0 && targets[0]) targets[0].focus(); }
    else if (k === (vertical ? KEY.DOWN : KEY.RIGHT)) step(1);
    else if (k === (vertical ? KEY.UP : KEY.LEFT)) step(-1);
    else if (vertical && (k === KEY.RIGHT || k === KEY.LEFT)) { /* stay */ } else if (!vertical && (k === KEY.UP || k === KEY.DOWN)) { /* stay */ } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (b) pick(b);
  });

  document.body.appendChild(scrim);
  openCount++;
  if (root) root.setAttribute('inert', '');
  window.addEventListener('keydown', onKey, true);
  void scrim.offsetWidth;
  scrim.classList.add('on');

  let first = targets[0];
  if (typeof o.focus === 'number') first = targets.find((t) => t.dataset.value === String(o.focus)) || first;
  else if (o.focus) first = targets.find((t) => t.dataset.value === o.focus) || first;
  if (first) first.focus();

  return { el: scrim, result, close };
}

/** Builder-style shorthand: resolves the chosen value (or null on Back). */
export const dialog = (o) => showDialog(o).result;
