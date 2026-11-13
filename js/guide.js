// TV guide listings (Guide.java): fetched per channel, only for the channels you can see in the
// guide (much lighter than downloading the provider's whole guide file), kept for 30 minutes.
// get_short_epg with limit 24 (≈ the rest of today and tonight), three requests at a time.
//
// Listings belong to an account (two providers reuse the same stream ids), so the cache is keyed by
// account + stream id and emptied when the account changes (clear()).
import * as api from './api.js';
import * as store from './store.js';

export const KEEP_MS = 30 * 60000;
export const AHEAD = 24;
export const PARALLEL = 3;

const CACHE = new Map();   // account|stream id -> { list, fetched }
const LOADING = new Set(); // keys queued or in flight
const queue = [];          // [{ id, key, done }], served from the front
let running = 0;
let gen = 0; // bumped by clear() so stale requests are dropped

const keyOf = (streamId) => `${store.accountNs()}|${streamId}`;

/** Listings for a channel of the current account, or null if not loaded yet. */
export function get(streamId) {
  const e = CACHE.get(keyOf(streamId));
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
        CACHE.set(job.key, { list: tidy(l), fetched: Date.now() });
        LOADING.delete(job.key);
        running--;
        if (job.done) job.done();
        pump();
      });
  }
}

/**
 * Loads listings for these channels (skipping fresh ones), calling done as each arrives.
 * The newest request is the rows on screen now: its channels go to the front of the queue, and
 * anything still waiting from an earlier request that is no longer wanted is dropped (scrolling
 * through a long list must not make the rows you stopped on wait for the ones you passed).
 */
export function load(channels, done) {
  const now = Date.now();
  const want = new Map(); // key -> stream id, in row order
  for (const it of channels || []) want.set(keyOf(it.id), String(it.id));
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i];
    if (want.has(job.key)) { job.done = done; continue; }
    LOADING.delete(job.key);
    queue.splice(i, 1);
  }
  const fresh = [];
  for (const [key, id] of want) {
    const e = CACHE.get(key);
    if ((e && now - e.fetched < KEEP_MS) || LOADING.has(key)) continue;
    LOADING.add(key);
    fresh.push({ id, key, done });
  }
  queue.unshift(...fresh);
  pump();
}

/** The programme on at time t (unix seconds) in a channel's listings, or null. */
export function at(list, t) {
  if (!list) return null;
  for (const p of list) if (p.start <= t && t < p.stop) return p;
  return null;
}

/** Forget every listing and drop what is queued or in flight (account switched, removed or edited). */
export function clear() { gen++; CACHE.clear(); LOADING.clear(); queue.length = 0; running = 0; }

// tests
export const _state = () => ({ running, queued: queue.map((j) => j.id), loading: [...LOADING], cached: [...CACHE.keys()] });
export const _reset = clear;
