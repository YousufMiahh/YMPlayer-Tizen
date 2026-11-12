// Mock Xtream server + static host for the app, all on one origin.
//   /player_api.php?username=&password=[&action=...]   Xtream JSON API from fixtures.mjs
//   /art/poster/<id>.svg, /art/logo/<id>.svg            generated artwork
//   anything else                                       files from the repo root (the app)
// Run standalone: node tools/shots/server.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as fx from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const USER = 'demo';
export const PASS = 'demo';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.json': 'application/json', '.xml': 'application/xml',
};

function api(q, origin) {
  if (q.get('username') !== USER || q.get('password') !== PASS) return { user_info: { auth: 0 } };
  const cat = q.get('category_id');
  const inCat = (list) => (cat ? list.filter((s) => s.category_id === cat) : list);
  switch (q.get('action')) {
    case null: case undefined: case '':
      return {
        user_info: { username: USER, password: PASS, auth: 1, status: 'Active', exp_date: '1893456000', is_trial: '0',
          active_cons: '0', max_connections: '2', created_at: '1700000000', allowed_output_formats: ['m3u8', 'ts'] },
        server_info: { url: new URL(origin).hostname, port: new URL(origin).port, server_protocol: 'http', timezone: 'Europe/London', timestamp_now: Math.floor(Date.now() / 1000) },
      };
    case 'get_live_categories': return fx.liveCats;
    case 'get_vod_categories': return fx.vodCats;
    case 'get_series_categories': return fx.seriesCats;
    case 'get_live_streams': return inCat(fx.live);
    case 'get_vod_streams': return inCat(fx.movies);
    case 'get_series': return inCat(fx.series);
    case 'get_series_info': return fx.seriesInfo(Number(q.get('series_id')));
    case 'get_vod_info': return fx.vodInfo(Number(q.get('vod_id')));
    case 'get_short_epg': return fx.shortEpg(Number(q.get('stream_id')), Number(q.get('limit')) || 4);
    default: return [];
  }
}

/**
 * Per-action behaviour for screens that need a slow or failing provider (Setup):
 *   { get_vod_streams: { trickleMs: 30000 }, get_series: { holdMs: 60000 }, get_live_streams: { status: 502 } }
 * trickle = send the body in small pieces over that time; hold = say nothing for that long;
 * body = answer with this JSON instead (e.g. [] for an account with nothing in it).
 */
let behaviour = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`;
    const url = new URL(req.url, origin);
    const send = (code, type, body) => {
      res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(body);
    };
    try {
      if (url.pathname === '/favicon.ico') { send(204, 'text/plain', ''); return; }
      if (url.pathname === '/player_api.php') {
        // Providers return absolute artwork URLs; mirror that so the app fetches them like real ones.
        const b = behaviour[url.searchParams.get('action')] || {};
        const body = JSON.stringify(b.body !== undefined ? b.body : api(url.searchParams, origin)).replaceAll('"/art/', `"${origin}/art/`);
        if (b.holdMs) await sleep(b.holdMs);
        if (b.status) { send(b.status, 'text/plain', 'Bad Gateway'); return; }
        if (b.trickleMs) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
          const parts = 200; const size = Math.ceil(body.length / parts);
          for (let i = 0; i < parts && !res.destroyed; i++) { res.write(body.slice(i * size, (i + 1) * size)); await sleep(b.trickleMs / parts); }
          res.end();
          return;
        }
        send(200, 'application/json', body);
        return;
      }
      let m = url.pathname.match(/^\/art\/poster\/(\d+)\.svg$/);
      if (m) { send(200, MIME['.svg'], fx.posterSvg(Number(m[1]))); return; }
      m = url.pathname.match(/^\/art\/logo\/(\d+)\.svg$/);
      if (m) { send(200, MIME['.svg'], fx.logoSvg(Number(m[1]))); return; }
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(ROOT, `.${rel}`);
      if (!file.startsWith(ROOT + path.sep)) { send(403, 'text/plain', 'forbidden'); return; }
      const data = await readFile(file);
      send(200, MIME[path.extname(file)] || 'application/octet-stream', data);
    } catch {
      send(404, 'text/plain', 'not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({
        url: `http://127.0.0.1:${p}`,
        set(b) { behaviour = b || {}; },
        close: () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); },
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startServer(Number(process.argv[2]) || 8090);
  console.log(`YM Player mock Xtream server + app on ${s.url}  (user ${USER} / pass ${PASS})`);
}
