// TV guide listings (Guide.java): fetched per channel, only for the channels you can see in the
// guide (much lighter than downloading the provider's whole guide file), kept for 30 minutes.
// get_short_epg with limit 24 (≈ the rest of today and tonight), three requests at a time.
import * as api from './api.js';

export const KEEP_MS = 30 * 60000;
export const AHEAD = 24;
export const PARALLEL = 3;

const CACHE = new Map();   // stream id -> { list, fetched }
const LOADING = new Set(); // stream ids queued or in flight
const queue = [];          // [{ id, done }]
let running = 0;
let gen = 0; // bumped by _reset so stale requests are dropped

/** Listings for a channel, or null if not loaded yet. */
export function get(streamId) {
  const e = CACHE.get(String(streamId));
  return e ? e.list : null;
}

/**
 * Some providers' guides list overlapping or duplicate programmes (two sources merged), which drew
 * on top of each other. Keep them in time order with no overlaps.
 */
export function tidy(input) {
  const l = (input || []).filter((p) => p.stop > p.start && p.start > 0);
  l.sort((a, b) => (a.start !== b.start ? a.start - b.start : b.stop - a.stop));
  const out = [];
  let end = 0;
  for (const p of l) {
    if (p.stop <= end) continue;     // entirely inside the previous one: a duplicate
    if (p.start < end) p.start = end; // starts before the previous one ends: trim it
    out.push(p);
    end = p.stop;
  }
  return out;
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    const g = gen;
    Promise.resolve()
      .then(() => api.epg(job.id, AHEAD))
      .catch(() => [])
      .then((l) => {
        if (g !== gen) return;
        CACHE.set(job.id, { list: tidy(l), fetched: Date.now() });
        LOADING.delete(job.id);
        running--;
        if (job.done) job.done();
        pump();
      });
  }
}

/** Loads listings for these channels (skipping fresh ones), calling done as each arrives. */
export function load(channels, done) {
  const now = Date.now();
  for (const it of channels || []) {
    const id = String(it.id);
    const e = CACHE.get(id);
    if ((e && now - e.fetched < KEEP_MS) || LOADING.has(id)) continue;
    LOADING.add(id);
    queue.push({ id, done });
  }
  pump();
}

/** The programme on at time t (unix seconds) in a channel's listings, or null. */
export function at(list, t) {
  if (!list) return null;
  for (const p of list) if (p.start <= t && t < p.stop) return p;
  return null;
}

// tests
export const _state = () => ({ running, queued: queue.length, loading: [...LOADING], cached: [...CACHE.keys()] });
export function _reset() { gen++; CACHE.clear(); LOADING.clear(); queue.length = 0; running = 0; }
