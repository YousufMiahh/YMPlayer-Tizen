// Small builders ported from Ui.java / Cards.java / Adapters.java / SettingsActivity.section().
// Styling lives in css/ui.css; these only produce the markup.

/** Ui.button(): translucent pill, white with dark text when focused, lifts 1.06. */
export function pillButton(label, attrs = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pill-btn';
  b.textContent = label;
  for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v;
  return b;
}

/** Ui.input(): pill text field, TEXT3 hint. */
export function pillInput(hint, type = 'text') {
  const i = document.createElement('input');
  i.type = type;
  i.className = 'pill-input';
  i.placeholder = hint;
  i.autocomplete = 'off';
  return i;
}

/** SettingsActivity.section(): medium 14u, TEXT3, upper case, letter-spacing .1em. */
export function sectionHeading(text) {
  const h = document.createElement('div');
  h.className = 'section-heading';
  h.textContent = String(text).toUpperCase();
  return h;
}

/**
 * SettingsActivity.row(): the whole row is one pill, label on the left (Medium 19u), value on the
 * right (18u, TEXT2, up to 2 lines). Actionable rows take focus and OK; info rows are SURFACE_LO
 * and can't be focused.
 */
export function settingsRow(label, value = '', actionable = true) {
  const r = document.createElement(actionable ? 'button' : 'div');
  if (actionable) r.type = 'button';
  r.className = `srow${actionable ? '' : ' info'}`;
  const l = document.createElement('span');
  l.className = 'srow-label'; l.textContent = label;
  const v = document.createElement('span');
  v.className = 'srow-value'; v.textContent = value;
  r.append(l, v);
  return r;
}

/** Cards.shelf() title: SemiBold 22u, TEXT2. Optional hint in TEXT3 after a 6-space gap. */
export function shelfTitle(text, hint) {
  const h = document.createElement('h2');
  h.className = 'shelf-title';
  h.textContent = text;
  if (hint) {
    const s = document.createElement('span');
    s.className = 'shelf-hint';
    s.textContent = `      ${hint}`; // Cards.java: six spaces before the hint
    h.appendChild(s);
  }
  return h;
}

/** Cards.initials(): punctuation out, then the first letter of the first two words, upper case. */
export function initials(name) {
  return String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => [...w][0].toUpperCase()).join('');
}

/**
 * Adapters.RowCell: [num] [logo] title/sub [trail]. Focus (hot) = white pill (or the glider behind
 * it), active = SURFACE_HI pill.
 */
export function rowCell({ title, sub, num, logo, trail, active } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `row-cell${active ? ' active' : ''}`;
  if (num !== undefined && num !== null) {
    const n = document.createElement('span'); n.className = 'rc-num'; n.textContent = num; b.appendChild(n);
  }
  if (logo !== undefined) {
    const l = document.createElement('span'); l.className = 'rc-logo';
    if (logo) { const img = document.createElement('img'); img.src = logo; img.alt = ''; l.appendChild(img); }
    b.appendChild(l);
  }
  const col = document.createElement('span'); col.className = 'rc-col';
  const t = document.createElement('span'); t.className = 'rc-title'; t.textContent = title || '';
  col.appendChild(t);
  if (sub) { const s = document.createElement('span'); s.className = 'rc-sub'; s.textContent = sub; col.appendChild(s); }
  b.appendChild(col);
  if (trail) { const tr = document.createElement('span'); tr.className = 'rc-trail'; tr.textContent = trail; b.appendChild(tr); }
  return b;
}

/**
 * Cards.card(): rounded artwork (initials when there is none, except posters), a one-line title,
 * an optional one-line subtitle, and a progress bar along the bottom of the art when > 0.
 * Same markup and CSS (.card) as Home's shelves.
 */
export function card({ shape = 'landscape', image = null, title = '', sub = '', progress = 0 } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `card ${shape}`;
  if (image) b.dataset.art = image;
  const art = document.createElement('span');
  art.className = 'art';
  if (image) {
    const img = document.createElement('img');
    img.src = image; img.alt = ''; img.decoding = 'async';
    art.appendChild(img);
  } else if (shape !== 'poster') {
    const ph = document.createElement('span');
    ph.className = 'initials'; ph.textContent = initials(title);
    art.appendChild(ph);
  }
  if (progress > 0) {
    const bar = document.createElement('span');
    bar.className = 'progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(2, Math.min(100, progress * 100))}%`;
    bar.appendChild(fill);
    art.appendChild(bar);
  }
  const t = document.createElement('span');
  t.className = 'title'; t.textContent = title || '';
  b.append(art, t);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'sub'; s.textContent = sub;
    b.appendChild(s);
  }
  return b;
}
