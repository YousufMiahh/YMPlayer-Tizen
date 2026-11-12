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

/** Cards.initials(): first letter of the first two words, upper case. */
export function initials(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
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
