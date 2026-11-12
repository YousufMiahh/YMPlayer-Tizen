// Series page (SeriesActivity.java). Params: { item }.
// Backdrop and scrims as on the movie page. A 960u info block filling the space above, anchored
// to its bottom: title, meta ("Loading episodes…" → "year · genre · ★ rating"), the focused
// episode's "Episode N  ·  name", the plot (the focused episode's), and the buttons
//   ▶  Play / ▶  Resume S1 · E3 / ▶  Play S1 · E4 | ▶  Trailer | ♡  Favourite
// Under it a row of season pills (focusing one switches the season, no OK needed) and a shelf of
// 300×169 episode cards ("N.  title", "M:SS left" or the duration, progress bar). ▲ from a card
// goes to the active season's pill. Menu (☰) toggles the favourite with a toast.
// An episode plays with its own season as the queue (Open.play(eps, i)).
import * as api from '../api.js';
import * as store from '../store.js';
import * as nav from '../nav.js';
import { play, toggleFav } from '../open.js';
import { openTrailer } from '../trailer.js';
import {
  seriesInfo, parseSeasons, seasonLabel, lastWatched, seriesPlayLabel, playTargetEpisode,
  startSeason, episodeCard, favLabel,
} from '../detail.js';
import { pillButton, card } from '../ui/widgets.js';
import { bringIntoView } from '../ui/scroll.js';
import { detailFrame } from './movie-detail.js';

const KEY_UP = 38;
const KEY_MENU = 10133;

export const LOADING = 'Loading episodes…';
export const NO_EPISODES = 'No episodes found for this series';
export const loadError = (msg) => `Couldn't load episodes — ${msg}`;

export function seriesDetailView() {
  let root; let params; let series; let page;
  let metaEl; let epLabelEl; let plotEl; let buttonsEl; let pillsEl; let shelfEl;
  let seasons = []; let active = null; let trailer = null; let loaded = false; let seq = 0;
  let onActivate; let onClick; let onFocusIn;

  const eps = () => (seasons.find((s) => s.season === active) || { episodes: [] }).episodes;
  const activePill = () => pillsEl.querySelector(`[data-season="${active}"]`);

  function buildButtons() {
    // Android: `if (hadFocus || getCurrentFocus() == null) playBtn.requestFocus()`. Removing a
    // focused button drops focus to <body>, which is the null case.
    const list = [pillButton(seriesPlayLabel(seasons, lastWatched(series)), { action: 'play' })];
    if (trailer) list.push(pillButton('▶  Trailer', { action: 'trailer' }));
    list.push(pillButton(favLabel(series), { action: 'fav' }));
    buttonsEl.replaceChildren(...list);
    const a = document.activeElement;
    if (!a || a === document.body || !root.contains(a)) list[0].focus();
  }

  function showEpisode(ep) {
    epLabelEl.textContent = `Episode ${ep.num}  ·  ${ep.name}`;
    epLabelEl.hidden = false;
    plotEl.textContent = ep.plot != null ? ep.plot : (series.plot || '');
    params.shownEpisode = ep.id;
  }

  function buildEpisodes() {
    const list = eps();
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
    if (action === 'trailer') { openTrailer(trailer); return; }
    const t = playTargetEpisode(seasons, lastWatched(series));
    if (t) playEpisode(t);
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
      p.textContent = seasonLabel(s.season);
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
    buttonsEl.firstChild.focus();
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
          const list = eps();
          const ep = list[Number(c.dataset.ep)];
          if (ep) { rememberFocus(); play(list, list.indexOf(ep)); }
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
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      page.el.addEventListener('focusin', onFocusIn);
      nav.register(root);

      page.setBackdrop(series.icon, { fade: !params.seriesInfo });
      buildButtons(); // "▶  Play" (or Resume/Play without the episode yet), focused

      if (params.seriesInfo) { // back from the player: the Activity still has everything
        parse(params.seriesInfo);
        const shown = params.shownEpisode && seasons.flatMap((s) => s.episodes).find((x) => x.id === params.shownEpisode);
        if (shown) showEpisode(shown);
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
    unmount() {
      seq++;
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
