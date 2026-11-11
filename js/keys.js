// Single gate for optional third-party features. v1 ships with NO external API keys,
// so Top 10 (TMDB) and Trailers (YouTube) are built but stay off.
// A build can define globalThis.YM_KEYS = { tmdb: '...', youtube: '...' } to enable them.
const key = (name) => {
  const k = globalThis.YM_KEYS && globalThis.YM_KEYS[name];
  return typeof k === 'string' && k.trim() !== '' ? k : '';
};

export const hasTmdb = () => key('tmdb') !== '';
export const hasYoutube = () => key('youtube') !== '';
