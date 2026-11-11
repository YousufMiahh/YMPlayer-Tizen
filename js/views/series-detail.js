// Series detail. Params: { item }. Season rail + episode list from seriesInfo, resume markers,
// and "Play next". Episodes are EPISODE items carrying parentId = series id.
import * as api from '../api.js';
import * as store from '../store.js';
import * as nav from '../nav.js';
import { router } from '../router.js';
import { EPISODE } from '../item.js';
import { formatTime } from './movie-detail.js';

/** seriesInfo JSON -> [{ season, episodes: EpisodeItem[] }] sorted by season then episode number. */
export function buildSeasons(series, data) {
  const raw = data?.episodes;
  const entries = Array.isArray(raw) ? raw.map((l, i) => [String(i + 1), l]) : Object.entries(raw || {});
  return entries
    .map(([season, list]) => ({
      season,
      episodes: (Array.isArray(list) ? list : [])
        .filter((e) => e && e.id !== undefined)
        .sort((a, b) => (Number(a.episode_num) || 0) - (Number(b.episode_num) || 0))
        .map((e) => {
          const n = Number(e.episode_num) || 0;
          const ep = {
            type: EPISODE, id: String(e.id), parentId: String(series.id), parentName: series.name,
            name: `S${season}E${n}${e.title ? ` · ${e.title}` : ''}`,
          };
          if (series.icon) ep.parentIcon = series.icon;
          if (e.container_extension) ep.ext = String(e.container_extension);
          const img = e.info?.movie_image;
          if (img) ep.icon = String(img);
          return ep;
        }),
    }))
    .filter((s) => s.episodes.length)
    .sort((a, b) => Number(a.season) - Number(b.season));
}

export function seriesDetailView() {
  let root; let series; let seasons = []; let current = null; let seq = 0;
  let listEl; let railEl; let onClick; let onActivate; let onBack;

  const flat = () => seasons.flatMap((s) => s.episodes);

  function play(ep) {
    const queue = flat();
    router.go('player-vod', { item: ep, queue, index: queue.findIndex((e) => e.id === ep.id) });
  }

  function renderEpisodes() {
    const s = seasons.find((x) => x.season === current);
    for (const b of railEl.querySelectorAll('[data-season]')) b.classList.toggle('selected', b.dataset.season === current);
    listEl.replaceChildren(...(s ? s.episodes : []).map((ep) => {
      const pos = store.position(ep);
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.episode = ep.id;
      b.className = `episode${pos > 0 ? ' resume' : ''}`;
      const t = document.createElement('span'); t.className = 'name'; t.textContent = ep.name;
      const m = document.createElement('span'); m.className = 'mark';
      if (pos > 0) {
        const dur = store.duration(ep);
        m.textContent = `▶ ${formatTime(pos)}${dur > 0 ? ` / ${formatTime(dur)}` : ''}`;
      }
      b.append(t, m);
      return b;
    }));
  }

  return {
    async mount(rootEl, params) {
      root = rootEl; series = params.item;
      const el = document.createElement('div');
      el.className = 'live series-detail';
      el.innerHTML = `<nav class="rail"><h1></h1><p class="plot"></p>
        <button type="button" data-action="next" hidden>Play next</button><div class="seasons"></div></nav>
        <section class="episodes"></section>`;
      el.querySelector('h1').textContent = series.name;
      el.querySelector('.plot').textContent = series.plot || '';
      railEl = el.querySelector('.rail');
      listEl = el.querySelector('.episodes');
      root.appendChild(el);

      onClick = (e) => {
        const a = e.target.closest('[data-action="next"]');
        if (a) {
          const all = flat();
          const ep = all.find((x) => store.position(x) > 0) || all[0];
          if (ep) play(ep);
          return;
        }
        const s = e.target.closest('[data-season]');
        if (s) { current = s.dataset.season; renderEpisodes(); nav.focusFirst(listEl); return; }
        const ep = e.target.closest('[data-episode]');
        if (ep) {
          const item = flat().find((x) => x.id === ep.dataset.episode);
          if (item) { params.episodeId = item.id; params.season = current; play(item); }
        }
      };
      onActivate = (e) => { e.target.closest('button')?.click(); };
      onBack = (e) => {
        if (e.target.closest?.('[data-episode]')) {
          e.stopPropagation();
          railEl.querySelector(`[data-season="${current}"]`)?.focus();
        }
      };
      root.addEventListener('click', onClick);
      root.addEventListener('activate', onActivate);
      root.addEventListener('back', onBack);
      nav.register(root);

      const mine = ++seq;
      let data = null;
      try { data = await api.seriesInfo(series.id); } catch { /* empty */ }
      if (mine !== seq || !root) return;
      const plot = data?.info?.plot;
      if (plot) railEl.querySelector('.plot').textContent = plot;
      seasons = buildSeasons(series, data);
      if (!seasons.length) { listEl.innerHTML = '<p class="empty">No episodes.</p>'; return; }
      const box = railEl.querySelector('.seasons');
      box.replaceChildren(...seasons.map((s) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'cat'; b.dataset.season = s.season;
        b.textContent = `Season ${s.season}`;
        return b;
      }));
      railEl.querySelector('[data-action="next"]').hidden = false;
      current = params.season && seasons.some((s) => s.season === params.season) ? params.season : seasons[0].season;
      renderEpisodes();
      const back = params.episodeId && listEl.querySelector(`[data-episode="${params.episodeId}"]`);
      (back || railEl.querySelector('[data-action="next"]')).focus();
    },
    unmount() {
      seq++;
      if (root) {
        root.removeEventListener('click', onClick);
        root.removeEventListener('activate', onActivate);
        root.removeEventListener('back', onBack);
      }
      root = series = listEl = railEl = null; seasons = []; current = null;
    },
  };
}
