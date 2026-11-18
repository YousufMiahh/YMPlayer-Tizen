// Series page (SeriesActivity.java). Params: { item }.
// Backdrop and scrims as on the movie page. A 960u info block filling the space above, anchored
// to its bottom: title, meta ("Loading episodes…" → "year · genre · ★ rating"), the episode's
// "S1: Ep. 3   name", its plot, and, Netflix-style, the big stacked buttons
//   ▶  Resume S1: Ep. 3 (progress) | ↻  Play From Beginning | Episodes & More   (watching it)
//   ▶  Play S1: E1 | Episodes & More | Audio & Subtitles                          (new to you)
// then ▶  Trailer | ♡  Favourite on a line. The page opens on just that; Episodes & More brings up
// the seasons and episodes on the one you'd play, and Back puts them away again. Something part
// way through plays muted behind the page after a moment (Settings → Film & Series Previews).
// Once shown, a row of season pills (focusing one switches the season, no OK needed) and a shelf of
// 300×169 episode cards ("N.  title", "M:SS left" or the duration, progress bar). ▲ from a card
// goes to the active season's pill. Menu (☰) toggles the favourite with a toast; on an episode
// card ☰ or Hold OK opens its options (Add to Queue, Mark as Watched, Mark Season as Watched…).
// Watched episodes carry a ✓, and the season pills count them ("Season 2  3/10", "Season 2  ✓").
// An episode plays with its own season as the queue (Open.play(eps, i)).
import * as api from '../api.js';
import * as store from '../store.js';
import * as nav from '../nav.js';
import { play, toggleFav } from '../open.js';
import { openTrailer } from '../trailer.js';
import {
  seriesInfo, parseSeasons, seasonPillLabel, lastWatched, seriesHero,
  startSeason, episodeCard, favLabel,
} from '../detail.js';
import { renderButtons, askAudioSubtitles, pagePreview } from '../ui/hero.js';
import { showItemMenu } from '../item-menu.js';
import { LONG_PRESS_MS } from '../ui/theme.js';
import { pillButton, card } from '../ui/widgets.js';
import { bringIntoView } from '../ui/scroll.js';
import { detailFrame } from './movie-detail.js';

const KEY_UP = 38;
const KEY_ENTER = 13;
const KEY_MENU = 10133;

export const LOADING = 'Loading episodes…';
export const NO_EPISODES = 'No episodes found for this series';
export const loadError = (msg) => `Couldn't load episodes — ${msg}`;

export function seriesDetailView() {
  let root; let params; let series; let page;
  let metaEl; let epLabelEl; let plotEl; let buttonsEl; let pillsEl; let shelfEl;
  let seasons = []; let active = null; let trailer = null; let loaded = false; let seq = 0;
  let onActivate; let onClick; let onFocusIn; let onKeyUp;
  let hold = null; // OK held on an episode card: { card, timer, held }
  let hero = null; let preview = null;
  const rowsShown = () => !!(params && params.rows);
  const allButtons = () => [...buttonsEl.querySelectorAll('button')];

  const eps = () => (seasons.find((s) => s.season === active) || { episodes: [] }).episodes;
  const activePill = () => pillsEl.querySelector(`[data-season="${active}"]`);

  function buildButtons() {
    // Android: `if (hadFocus || getCurrentFocus() == null) playBtn.requestFocus()`. Removing a
    // focused button drops focus to <body>, which is the null case.
    const a0 = document.activeElement;
    const at = a0 && buttonsEl.contains(a0) ? allButtons().indexOf(a0) : -1;
    hero = seriesHero(seasons, lastWatched(series));
    const spec = [...hero.buttons];
    if (trailer) spec.push({ action: 'trailer', label: '▶  Trailer' });
    spec.push({ action: 'fav', label: favLabel(series) });
    const list = renderButtons(buttonsEl, spec, (b) => pillButton(b.label, { action: b.action }));
    if (hero.target && !rowsShown()) showEpisode(hero.target, hero.name);
    const a = document.activeElement;
    if (at >= 0 && list[at]) list[at].focus();
    else if (!a || a === document.body || !root.contains(a)) list[0].focus();
    if (preview && !rowsShown() && hero.target) preview.schedule(hero.target, store.position(hero.target));
  }

  /** Episodes & More: the seasons come up, on the episode you'd play. */
  function showRows() {
    if (!loaded) return;
    params.rows = true;
    if (preview) preview.stop();
    page.el.classList.remove('sp-hero');
    const t = hero && hero.target;
    const s = t ? seasons.find((x) => x.episodes.includes(t)) : null;
    if (s && s.season !== active) showSeason(s.season);
    const i = t ? eps().indexOf(t) : 0;
    const c = shelfEl.children[Math.max(0, i)];
    if (c) { c.focus({ preventScroll: true }); bringIntoView(c, shelfEl.parentElement, false, true); }
  }

  /** Back from the seasons: the big picture and the buttons again. */
  function hideRows() {
    params.rows = false;
    page.el.classList.add('sp-hero');
    buttonsEl.querySelector('button').focus();
    buildButtons();
    allButtons()[0].focus();
  }

  function showEpisode(ep, heroName) {
    epLabelEl.textContent = heroName ? `${heroName}   ${ep.name}` : `Episode ${ep.num}  ·  ${ep.name}`;
    epLabelEl.hidden = false;
    plotEl.textContent = ep.plot != null ? ep.plot : (series.plot || '');
    params.shownEpisode = ep.id;
  }

  function updatePillLabels() {
    for (const p of pillsEl.children) {
      const s = seasons.find((x) => x.season === Number(p.dataset.season));
      if (s) p.textContent = seasonPillLabel(s);
    }
  }

  /** ☰ / Hold OK on an episode: Add to Queue, Mark as Watched, Mark Season as Watched… */
  function episodeMenu(c) {
    const list = eps();
    const idx = Number(c.dataset.ep);
    const ep = list[idx];
    if (!ep) return;
    c.classList.add('keep-focus');
    showItemMenu(ep, list).then((changed) => {
      hold = null; // the dialog may have swallowed the key's release
      if (!root) return;
      c.classList.remove('keep-focus');
      if (!changed) return;
      const left = shelfEl.parentElement.scrollLeft;
      buildEpisodes();
      buildButtons();
      shelfEl.parentElement.scrollLeft = left;
      const again = shelfEl.children[idx];
      if (again) again.focus({ preventScroll: true });
    });
  }

  function buildEpisodes() {
    const list = eps();
    updatePillLabels();
    shelfEl.replaceChildren(...list.map((ep, i) => {
      const c = card({ shape: 'landscape', ...episodeCard(ep, series) });
      c.dataset.ep = String(i);
      return c;
    }));
    shelfEl.parentElement.scrollLeft = 0; // episodeScroll.scrollTo(0, 0)
  }

  function showSeason(key) {
    if (key === active) return;
    active = key;
    params.season = key;
    for (const p of pillsEl.children) p.classList.toggle('on', Number(p.dataset.season) === key);
    buildEpisodes();
  }

  function playEpisode(ep) {
    const s = seasons.find((x) => x.episodes.includes(ep));
    if (s) play(s.episodes, s.episodes.indexOf(ep));
  }

  function act(action, btn) {
    if (action === 'fav') { store.toggleFav(series); btn.textContent = favLabel(series); return; }
    if (action === 'more') { showRows(); return; }
    if (action === 'audio') { askAudioSubtitles(); return; }
    if (preview) preview.stop();
    if (action === 'trailer') { openTrailer(trailer); return; }
    const t = hero && hero.target;
    if (!t) return;
    if (action === 'over') store.setPosition(t, 0); // Play From Beginning forgets the saved point first
    playEpisode(t);
  }

  /** SeriesActivity.parse. */
  function parse(r) {
    const info = seriesInfo(r, series);
    if (info.plot !== null) { series.plot = info.plot; plotEl.textContent = info.plot; }
    metaEl.textContent = info.meta;
    if (info.backdrop) page.setBackdrop(info.backdrop, { fade: !params.seriesInfo });
    if (!series.icon && info.cover) series.icon = info.cover;
    trailer = info.trailer;
    seasons = parseSeasons(r, series);
    pillsEl.replaceChildren();
    if (!seasons.length) { metaEl.textContent = NO_EPISODES; return; }
    pillsEl.replaceChildren(...seasons.map((s) => {
      const p = document.createElement('button');
      p.type = 'button'; p.className = 'season-pill'; p.dataset.season = String(s.season);
      p.textContent = seasonPillLabel(s);
      return p;
    }));
    loaded = true;
    const keep = params.season;
    active = null;
    showSeason(keep !== undefined && seasons.some((s) => s.season === keep) ? keep : startSeason(seasons, lastWatched(series)));
    buildButtons();
  }

  /** onResume: put focus back where it was (an episode by its place, a pill, else Play). */
  function restoreFocus() {
    const f = params.focus || {};
    if (f.ep !== undefined) {
      const c = shelfEl.children[f.ep];
      if (c) { c.focus({ preventScroll: true }); shelfEl.parentElement.scrollLeft = params.shelfScroll || 0; return; }
    }
    if (f.pill !== undefined) {
      const p = pillsEl.querySelector(`[data-season="${f.pill}"]`);
      if (p) { p.focus({ preventScroll: true }); pillsEl.parentElement.scrollLeft = params.pillScroll || 0; return; }
    }
    allButtons()[0].focus();
  }

  function rememberFocus() {
    const a = document.activeElement;
    params.focus = {};
    if (a && a.dataset && a.dataset.ep !== undefined && shelfEl.contains(a)) params.focus.ep = Number(a.dataset.ep);
    else if (a && a.dataset && a.dataset.season !== undefined && pillsEl.contains(a)) params.focus.pill = Number(a.dataset.season);
    params.shelfScroll = shelfEl.parentElement.scrollLeft;
    params.pillScroll = pillsEl.parentElement.scrollLeft;
  }

  return {
    async mount(rootEl, p) {
      root = rootEl; params = p;
      series = params.series || (params.series = { ...params.item });
      seasons = []; active = null; trailer = null; loaded = false;
      page = detailFrame('series-page');
      if (!params.rows) page.el.classList.add('sp-hero');
      preview = pagePreview(page);
      const body = document.createElement('div');
      body.className = 'sp-page';
      body.innerHTML = `
        <div class="sp-info"><h1 class="dp-title"></h1><div class="dp-meta"></div><div class="sp-eplabel" hidden></div>
          <div class="dp-plot"></div><div class="dp-buttons"></div></div>
        <div class="sp-scroll sp-pills-scroll" data-own-scroll><div class="sp-pills"></div></div>
        <div class="sp-scroll sp-shelf-scroll" data-own-scroll><div class="sp-shelf"></div></div>`;
      page.el.appendChild(body);
      page.el.querySelector('.dp-title').textContent = series.name || '';
      metaEl = page.el.querySelector('.dp-meta'); metaEl.textContent = series.info || '';
      epLabelEl = page.el.querySelector('.sp-eplabel');
      plotEl = page.el.querySelector('.dp-plot'); plotEl.textContent = series.plot || '';
      buttonsEl = page.el.querySelector('.dp-buttons');
      pillsEl = page.el.querySelector('.sp-pills');
      shelfEl = page.el.querySelector('.sp-shelf');
      root.appendChild(page.el);

      onClick = (e) => {
        const t = e.target.closest ? e.target : null;
        if (!t) return;
        const b = t.closest('[data-action]');
        if (b && buttonsEl.contains(b)) { act(b.dataset.action, b); return; }
        const c = t.closest('.card');
        if (c && shelfEl.contains(c)) {
          if (hold && hold.held) return; // the release of a Hold OK
          const list = eps();
          const ep = list[Number(c.dataset.ep)];
          if (ep) { rememberFocus(); if (preview) preview.stop(); play(list, list.indexOf(ep)); }
        }
      };
      onActivate = (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.click(); };
      onFocusIn = (e) => {
        const t = e.target;
        if (!t || !t.dataset) return;
        if (t.dataset.season !== undefined && pillsEl.contains(t)) {
          showSeason(Number(t.dataset.season));
          bringIntoView(t, pillsEl.parentElement, false, true);
        } else if (t.dataset.ep !== undefined && shelfEl.contains(t)) {
          const ep = eps()[Number(t.dataset.ep)];
          if (ep) showEpisode(ep);
          bringIntoView(t, shelfEl.parentElement, false, true);
        }
      };
      // OK on an episode is decided on release: a short press plays, a hold is the menu.
      onKeyUp = (e) => {
        if (e.keyCode !== KEY_ENTER || !hold) return;
        const h = hold; hold = null;
        clearTimeout(h.timer);
        if (!h.held && root && h.card === document.activeElement) h.card.click();
      };
      document.addEventListener('keyup', onKeyUp);
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      page.el.addEventListener('focusin', onFocusIn);
      nav.register(root);

      page.setBackdrop(series.icon, { fade: !params.seriesInfo });
      buildButtons(); // "▶  Play" (or Resume/Play without the episode yet), focused

      if (params.seriesInfo) { // back from the player: the Activity still has everything
        parse(params.seriesInfo);
        const shown = params.shownEpisode && seasons.flatMap((s) => s.episodes).find((x) => x.id === params.shownEpisode);
        if (shown && params.rows) showEpisode(shown);
        restoreFocus();
        return;
      }
      metaEl.textContent = LOADING;
      const mine = ++seq;
      let r = null; let err = null;
      try { r = await api.seriesInfo(series.id); } catch (e) { err = e; }
      if (mine !== seq || !root) return;
      if (err || !r) { metaEl.textContent = loadError(api.errorMessage(err)); return; }
      params.seriesInfo = r;
      parse(r);
    },
    onKey(e) {
      if (!root) return false;
      const onEpisode = () => {
        const f = document.activeElement;
        return f && f.dataset && f.dataset.ep !== undefined && shelfEl.contains(f) ? f : null;
      };
      if (e.keyCode === KEY_MENU && onEpisode()) { e.preventDefault(); episodeMenu(onEpisode()); return true; }
      if (e.keyCode === KEY_ENTER && onEpisode()) {
        e.preventDefault();
        if (!e.repeat && !hold) {
          const c = onEpisode();
          const h = { card: c, held: false, timer: null };
          h.timer = setTimeout(() => { h.timer = null; h.held = true; if (root && h.card === document.activeElement) episodeMenu(h.card); }, LONG_PRESS_MS);
          hold = h;
        }
        return true;
      }
      if (e.keyCode === KEY_MENU) { // SeriesActivity.onKeyDown(KEYCODE_MENU)
        e.preventDefault();
        toggleFav(series);
        const fav = buttonsEl.querySelector('[data-action="fav"]');
        if (fav) fav.textContent = favLabel(series);
        return true;
      }
      const a = document.activeElement;
      if (e.keyCode === KEY_UP && a && shelfEl.contains(a) && loaded) { // card.setNextFocusUpId(pill)
        e.preventDefault();
        const p = activePill();
        if (p) p.focus({ preventScroll: true });
        return true;
      }
      return false;
    },
    onBack() {
      if (root && rowsShown()) { hideRows(); return true; }
      return false;
    },
    unmount() {
      seq++;
      if (preview) { preview.stop(); preview = null; }
      if (hold) { clearTimeout(hold.timer); hold = null; }
      document.removeEventListener('keyup', onKeyUp);
      if (root) {
        if (page && loaded) rememberFocus();
        root.removeEventListener('click', onClick);
        root.removeEventListener('activate', onActivate);
        if (page) page.el.removeEventListener('focusin', onFocusIn);
      }
      root = params = series = page = metaEl = epLabelEl = plotEl = buttonsEl = pillsEl = shelfEl = null;
      seasons = [];
    },
  };
}
