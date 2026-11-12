// XtreamApi.normalize, on its own so modules that only need it (repo.js) don't depend on api.js.
const TAILS = ['/player_api.php', '/get.php', '/xmltv.php', '/panel_api.php'];

/** Turns whatever the user typed into "http(s)://host:port". */
export function normalize(server) {
  let s = (server ?? '').trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  for (const t of TAILS) if (s.endsWith(t)) s = s.slice(0, -t.length);
  return s.replace(/\/+$/, '');
}
