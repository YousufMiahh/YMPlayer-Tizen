// Single gate for optional third-party features that need a key. v1 ships with none, so
// Trailers (YouTube) stay off. A build can define globalThis.YM_KEYS = { youtube: '...' }.
// (The Netflix UK Top 10 needs no key: see js/top10.js.)
const key = (name) => {
  const k = globalThis.YM_KEYS && globalThis.YM_KEYS[name];
  return typeof k === 'string' && k.trim() !== '' ? k : '';
};

export const hasYoutube = () => key('youtube') !== '';
