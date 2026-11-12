// TrailerActivity.java: YouTube trailers with no API key. The id is pulled out of whatever the
// provider gave (a bare id, a watch?v= link, youtu.be/…, /embed/…), then played in the
// youtube-nocookie embed, full screen on black, with the same parameters as Android.
import { router } from './router.js';
import { toast } from './ui/toast.js';

export const EMBED_HOST = 'https://www.youtube-nocookie.com';
export const NO_TRAILER = 'No trailer available';
const ID = /^[A-Za-z0-9_-]{11}$/;

/** TrailerActivity.youtubeId: an 11-character YouTube id, or null. */
export function youtubeId(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (ID.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const v = u.searchParams.get('v');
    if (v !== null && ID.test(v)) return v;
    const last = u.pathname.split('/').filter(Boolean).pop();
    if (last && ID.test(decodeURIComponent(last))) return decodeURIComponent(last);
  } catch { /* not a URL */ }
  return null;
}

/**
 * The embed address. Android's parameters (autoplay=1&rel=0&modestbranding=1&playsinline=1)
 * plus enablejsapi=1, which needs no key and lets the screen hear the player's errors and pass
 * the remote's OK / play / pause / seek keys to it.
 */
export function embedUrl(id) {
  return `${EMBED_HOST}/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
}

/** TrailerActivity.open: "No trailer available" when there is no id, else the trailer screen. */
export function openTrailer(raw) {
  const id = youtubeId(raw);
  if (!id) { toast(NO_TRAILER); return false; }
  router.go('trailer', { id });
  return true;
}
