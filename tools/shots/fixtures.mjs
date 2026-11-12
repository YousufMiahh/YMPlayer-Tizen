// Deterministic Xtream fixture data for the screenshot harness: 24 live, 22 movie and 20 series
// categories, a few hundred items each, and locally generated SVG artwork (no internet needed).

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261112);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const LIVE_CATS = [
  'UK | Entertainment', 'UK | News', 'UK | Sports', 'UK | Movies', 'UK | Kids', 'UK | Documentaries',
  'UK | Music', 'UK | Regional', 'US | Entertainment', 'US | News', 'US | Sports', 'IE | General',
  'FR | Général', 'DE | Unterhaltung', 'ES | Deportes', 'IT | Intrattenimento', 'NL | Algemeen',
  'PL | Ogólne', 'PT | Geral', 'AR | عام', 'IN | Hindi', 'TR | Ulusal', '4K | UHD', 'Radio',
];
const VOD_CATS = [
  'New Releases', 'Action', 'Comedy', 'Drama', 'Thriller', 'Horror', 'Sci-Fi', 'Family', 'Animation',
  'Romance', 'Crime', 'Documentary', 'War', 'Western', 'Fantasy', 'Mystery', 'Music', 'Sport',
  'Classics', '4K Movies', 'Christmas', 'Bollywood',
];
const SERIES_CATS = [
  'Drama Series', 'Comedy Series', 'Crime Series', 'Sci-Fi Series', 'Documentary Series', 'Reality TV',
  'Kids Series', 'Anime', 'Thriller Series', 'Fantasy Series', 'Soaps', 'British Classics',
  'Talk Shows', 'Mini-Series', 'Cooking', 'Travel', 'Nature', 'History', 'Sports Series', 'Mystery Series',
];

const CHANNEL_WORDS = ['One', 'Two', 'Three', 'Four', 'News', 'Sport', 'Arena', 'Max', 'Plus', 'Gold', 'Life',
  'Kids', 'Cinema', 'Action', 'Drama', 'Comedy', 'Docs', 'Music', 'History', 'Nature', 'World', 'Prime'];
const CHANNEL_BRANDS = ['BBC', 'ITV', 'Sky', 'Channel', 'TNT', 'Eurosport', 'Discovery', 'Nat Geo', 'Comedy Central',
  'Dave', 'E4', 'More4', 'Film4', 'Gold', 'Alibi', 'W', 'Yesterday', 'Quest', 'CNN', 'Al Jazeera', 'France 24',
  'DW', 'RTÉ', 'Virgin Media', 'MTV', 'Nick', 'Cartoon Network', 'Disney', 'Premier', 'BT Sport'];
const TITLE_A = ['The', 'A', 'Last', 'Silent', 'Midnight', 'Broken', 'Golden', 'Hidden', 'Northern', 'Lost', 'Iron',
  'Crimson', 'Distant', 'Wild', 'Final', 'Electric', 'Frozen', 'Burning', 'Quiet', 'Secret'];
const TITLE_B = ['Horizon', 'Kingdom', 'Signal', 'Harbour', 'Empire', 'River', 'Station', 'Garden', 'Protocol',
  'Frontier', 'Echo', 'Island', 'Witness', 'Orchard', 'Paradox', 'Summit', 'Legacy', 'Voyage', 'Tide', 'Circuit'];
const TITLE_C = ['', '', '', ' II', ' Returns', ': Origins', ' of Fire', ' Rising', ' 1987', ' Nights'];

const HUES = [8, 22, 38, 52, 140, 168, 190, 205, 222, 248, 268, 290, 312, 336];

export const live = []; export const movies = []; export const series = [];
export const liveCats = LIVE_CATS.map((n, i) => ({ category_id: String(100 + i), category_name: n, parent_id: 0 }));
export const vodCats = VOD_CATS.map((n, i) => ({ category_id: String(200 + i), category_name: n, parent_id: 0 }));
export const seriesCats = SERIES_CATS.map((n, i) => ({ category_id: String(300 + i), category_name: n, parent_id: 0 }));

const now = Math.floor(Date.UTC(2026, 10, 12) / 1000);
let num = 1;
liveCats.forEach((c, ci) => {
  const n = 9 + Math.floor(rand() * 8);
  const prefix = c.category_name.split(' | ')[0];
  for (let i = 0; i < n; i++) {
    const id = 1000 + live.length;
    const name = `${prefix === c.category_name ? '' : `${prefix}: `}${pick(CHANNEL_BRANDS)} ${pick(CHANNEL_WORDS)}${ci === 22 ? ' 4K' : rand() < 0.25 ? ' HD' : ''}`;
    live.push({
      num: num++, name, stream_type: 'live', stream_id: id,
      stream_icon: rand() < 0.88 ? `/art/logo/${id}.svg` : '', epg_channel_id: `ch${id}`,
      added: String(now - Math.floor(rand() * 9e6)), category_id: c.category_id, tv_archive: 0,
    });
  }
});

function title() { return `${pick(TITLE_A)} ${pick(TITLE_B)}${pick(TITLE_C)}`.trim(); }

vodCats.forEach((c) => {
  const n = 12 + Math.floor(rand() * 10);
  for (let i = 0; i < n; i++) {
    const id = 5000 + movies.length;
    movies.push({
      num: movies.length + 1, name: `${title()} (${1990 + Math.floor(rand() * 36)})`, stream_type: 'movie',
      stream_id: id, stream_icon: `/art/poster/${id}.svg`, rating: (5 + rand() * 4).toFixed(1),
      added: String(now - Math.floor(rand() * 3e7)), category_id: c.category_id, container_extension: 'mp4',
    });
  }
});

seriesCats.forEach((c) => {
  const n = 10 + Math.floor(rand() * 8);
  for (let i = 0; i < n; i++) {
    const id = 8000 + series.length;
    series.push({
      num: series.length + 1, name: title(), series_id: id, cover: `/art/poster/${id}.svg`,
      plot: 'A gripping story told over several seasons.', cast: 'Alex Morgan, Sam Patel', director: 'Jo Reid',
      genre: c.category_name.replace(' Series', ''), releaseDate: '2021-03-04', rating: (6 + rand() * 3).toFixed(1),
      last_modified: String(now - Math.floor(rand() * 3e7)), category_id: c.category_id,
    });
  }
});

// One very long category (Browse windows its list: only the rows on screen are in the page).
// Built last, from its own random stream, so the data above stays the same.
export const BIG_CAT = '199';
{
  const r2 = rng(77);
  liveCats.push({ category_id: BIG_CAT, category_name: 'UK | Every Channel A–Z', parent_id: 0 });
  for (let i = 0; i < 3000; i++) {
    const id = 20000 + i;
    live.push({
      num: num++, name: `UK: ${CHANNEL_BRANDS[Math.floor(r2() * CHANNEL_BRANDS.length)]} ${CHANNEL_WORDS[Math.floor(r2() * CHANNEL_WORDS.length)]} ${i + 1}`,
      stream_type: 'live', stream_id: id, stream_icon: r2() < 0.9 ? `/art/logo/${id}.svg` : '', epg_channel_id: `ch${id}`,
      added: String(now - Math.floor(r2() * 9e6)), category_id: BIG_CAT, tv_archive: 0,
    });
  }
}

const byId = new Map();
for (const s of live) byId.set(`live:${s.stream_id}`, s);
for (const s of movies) byId.set(`movie:${s.stream_id}`, s);
for (const s of series) byId.set(`series:${s.series_id}`, s);
export const find = (type, id) => byId.get(`${type}:${id}`);

/** Stable colour per id, so the same poster always gets the same art. */
export function hueFor(id) { return HUES[Number(id) % HUES.length]; }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function wrap(text, max) {
  const words = text.split(' '); const lines = []; let line = '';
  for (const w of words) {
    if ((`${line} ${w}`).trim().length > max && line) { lines.push(line); line = w; } else line = `${line} ${w}`.trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export function posterSvg(id) {
  const item = find('movie', id) || find('series', id);
  const name = item ? item.name.replace(/\s*\(\d{4}\)$/, '') : `Title ${id}`;
  const h = hueFor(id);
  const lines = wrap(name.toUpperCase(), 11);
  const text = lines.map((l, i) => `<text x="150" y="${300 + i * 38 - (lines.length - 1) * 19}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="32" text-anchor="middle" fill="#fff" letter-spacing="1">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
<stop offset="0" stop-color="hsl(${h},70%,48%)"/><stop offset="0.6" stop-color="hsl(${(h + 25) % 360},65%,26%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},60%,10%)"/></linearGradient>
<radialGradient id="s" cx="0.7" cy="0.25" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="300" height="450" fill="url(#g)"/><rect width="300" height="450" fill="url(#s)"/>
<circle cx="${60 + (id % 7) * 30}" cy="${120 + (id % 5) * 12}" r="${50 + (id % 4) * 10}" fill="hsl(${(h + 180) % 360},70%,60%)" fill-opacity=".25"/>
${text}
<rect x="110" y="410" width="80" height="4" rx="2" fill="#fff" fill-opacity=".6"/></svg>`;
}

export function logoSvg(id) {
  const item = find('live', id);
  const brand = item ? item.name.replace(/^[A-Z0-9]{2,3}: /, '').replace(/ (HD|4K)$/, '') : `CH ${id}`;
  const h = hueFor(id);
  const words = brand.split(' ');
  const big = words[0].length <= 4 ? words[0].toUpperCase() : words[0];
  const small = words.slice(1).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
<rect x="20" y="40" width="${Math.min(280, 40 + big.length * 34)}" height="64" rx="10" fill="hsl(${h},75%,45%)"/>
<text x="38" y="88" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="42" fill="#fff">${esc(big)}</text>
<text x="22" y="146" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="34" fill="hsl(${h},80%,72%)">${esc(small)}</text></svg>`;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const SHOWS = ['Breakfast', 'Morning Live', 'Homes Under the Hammer', 'Bargain Hunt', 'News at One', 'Doctors',
  'Escape to the Country', 'Pointless', 'The Chase', 'Evening News', 'The One Show', 'EastEnders', 'Match of the Day',
  'Newsnight', 'Film: The Iron Harbour', 'Weather'];

/** Channels whose guide is empty (the TV guide's "No information" row). */
export const noEpg = (id) => id === 1051 || id % 23 === 5;
const DURS = [30, 60, 15, 45, 90, 30, 120, 25, 35, 60, 10, 50, 75, 20]; // minutes

/**
 * get_short_epg: varied lengths per channel (10 min to 2 h), a 20-minute gap on every third
 * channel, an overlapping duplicate on some (Guide.tidy drops it), one programme already over (the
 * API drops it) and nothing at all for noEpg() channels.
 */
export function shortEpg(streamId, limit = 4) {
  const id = Number(streamId);
  if (noEpg(id)) return { epg_listings: [] };
  const t0 = Math.floor(Date.now() / 1000);
  const dur = (i) => 60 * DURS[(id * 31 + i * 5 + Math.floor(id / 7)) % DURS.length];
  let start = t0 - Math.floor(dur(0) * (0.15 + ((id * 37) % 70) / 100));
  const out = [];
  const add = (i, s, e, title) => out.push({
    id: String(i), epg_id: `ch${id}`, title: b64(title), lang: 'en',
    start: new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 19),
    end: new Date(e * 1000).toISOString().replace('T', ' ').slice(0, 19),
    description: b64(`${title}: the latest from around the country, with guests and features.`),
    channel_id: `ch${id}`, start_timestamp: String(s), stop_timestamp: String(e),
  });
  add(-1, start - 3600, start - 1800, 'Earlier'); // over already
  for (let i = 0; i < limit; i++) {
    const title = SHOWS[(id + i) % SHOWS.length];
    const d = dur(i);
    add(i, start, start + d, title);
    if (i === 1 && id % 5 === 2) add(i, start, start + d - 600, title); // a duplicate from a second source
    start += d;
    if (i === 1 && id % 3 === 0) start += 1200; // a gap
  }
  return { epg_listings: out };
}

const EPISODE_NAMES = ['Pilot', 'The Long Night', 'Crossing Over', 'Low Tide', 'Signals', 'What the Fog Hid',
  'Northbound', 'The Keeper', 'Glass Houses', 'Homecoming', 'Old Debts', 'The Reckoning'];

/** A fake YouTube id (11 characters, as YouTube's are) for this item. */
export const trailerId = (id) => `yt${String(id).padStart(9, '0')}`;

/**
 * get_series_info: 1-4 seasons by id, 6-9 episodes each, a Specials season (0) on every fifth
 * series, a still per episode (some without), a trailer on every other series.
 */
export function seriesInfo(id) {
  const s = find('series', id);
  if (!s) return {};
  const episodes = {};
  const count = 1 + (id % 4);
  const keys = [...(id % 5 === 0 ? [0] : []), ...Array.from({ length: count }, (_, i) => i + 1)];
  for (const season of keys) {
    const n = season === 0 ? 2 : 6 + ((id + season) % 4);
    episodes[String(season)] = Array.from({ length: n }, (_, i) => {
      const epId = id * 100 + season * 10 + i;
      const mins = 42 + ((epId * 7) % 17);
      return {
        id: String(epId), episode_num: i + 1, title: season === 0 ? `Behind the Scenes ${i + 1}` : EPISODE_NAMES[(i + season * 3) % EPISODE_NAMES.length],
        container_extension: 'mp4', season,
        info: { duration_secs: mins * 60, duration: `00:${String(mins).padStart(2, '0')}:00`,
          plot: `Episode ${i + 1}: things take an unexpected turn when an old friend comes back to town.`,
          movie_image: (epId % 6) === 5 ? '' : `/art/still/${epId}.svg` },
      };
    });
  }
  return {
    seasons: keys.map((n) => ({ season_number: n, name: n === 0 ? 'Specials' : `Season ${n}`, cover: s.cover })),
    info: { name: s.name, cover: s.cover, plot: `${s.plot} A small coastal town keeps its secrets until a stranger arrives with questions nobody wants to answer.`,
      cast: s.cast, director: s.director, genre: s.genre, releaseDate: s.releaseDate, rating: s.rating,
      backdrop_path: [`/art/backdrop/${id}.svg`], youtube_trailer: id % 2 === 0 ? trailerId(id) : '' },
    episodes,
  };
}

/** get_vod_info: backdrop, credits, and a trailer as a bare id, a watch link, or none. */
export function vodInfo(id) {
  const m = find('movie', id);
  if (!m) return {};
  const t = id % 3 === 0 ? '' : id % 3 === 1 ? `https://www.youtube.com/watch?v=${trailerId(id)}` : trailerId(id);
  return {
    info: { name: m.name, movie_image: m.stream_icon, plot: 'When a quiet town is shaken by a strange signal, one engineer must decide who to trust. Old friendships are tested as the truth comes out, one broadcast at a time.',
      cast: 'Alex Morgan, Sam Patel, Lee Chen, Jordan Blake', director: 'Jo Reid', genre: 'Drama, Thriller', releasedate: m.name.match(/\((\d{4})\)/)?.[1] ? `${m.name.match(/\((\d{4})\)/)[1]}-05-01` : '2023-05-01',
      duration_secs: 6420, duration: '01:47:00', rating: m.rating, youtube_trailer: t, backdrop_path: [`/art/backdrop/${id}.svg`] },
    movie_data: { stream_id: m.stream_id, name: m.name, added: m.added, category_id: m.category_id, container_extension: 'mp4' },
  };
}

/** A wide scene for the detail pages' backdrop (1280x720): sky, sun, hills, the title faintly. */
export function backdropSvg(id) {
  const h = hueFor(id);
  const item = find('movie', id) || find('series', id);
  const name = item ? item.name.replace(/\s*\(\d{4}\)$/, '') : '';
  const hill = (y, amp, col, op) => `<path d="M0 ${y} C 300 ${y - amp}, 520 ${y + amp}, 800 ${y - amp / 2} S 1180 ${y - amp}, 1280 ${y} V720 H0 Z" fill="${col}" fill-opacity="${op}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${(h + 200) % 360},55%,22%)"/><stop offset="0.55" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 30) % 360},70%,70%)"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#sky)"/>
<circle cx="${820 + (id % 5) * 60}" cy="${300 + (id % 3) * 20}" r="90" fill="hsl(${(h + 40) % 360},90%,80%)" fill-opacity=".85"/>
${hill(470, 60, `hsl(${(h + 220) % 360},40%,30%)`, 0.9)}${hill(540, 80, `hsl(${(h + 240) % 360},45%,18%)`, 0.95)}${hill(620, 50, `hsl(${(h + 250) % 360},50%,10%)`, 1)}
<text x="1240" y="120" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="54" fill="#fff" fill-opacity=".18">${esc(name.toUpperCase())}</text></svg>`;
}

/** An episode still (480x270). */
export function stillSvg(id) {
  const h = hueFor(id);
  const n = id % 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${(h + n * 25) % 360},55%,45%)"/><stop offset="1" stop-color="hsl(${(h + n * 25 + 60) % 360},55%,15%)"/></linearGradient></defs>
<rect width="480" height="270" fill="url(#g)"/>
<circle cx="${120 + n * 25}" cy="${110 + (n % 3) * 20}" r="${40 + n * 3}" fill="#fff" fill-opacity=".12"/>
<rect x="0" y="200" width="480" height="70" fill="#000" fill-opacity=".25"/></svg>`;
}

/**
 * The trailer harness never reaches YouTube: the youtube-nocookie embed is answered with this
 * stand-in page. With `fail`, it reports a player error (150: not embeddable) like the real one.
 */
export function trailerStandIn(id, fail = false) {
  return `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:DejaVu Sans,Arial,sans-serif}
.f{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#bbb;
background:radial-gradient(circle at 50% 45%,#2a2a2a,#000 70%)}.p{width:136px;height:96px;border-radius:24px;background:#f00;display:flex;align-items:center;justify-content:center;margin-bottom:36px}
.p i{border-left:40px solid #fff;border-top:24px solid transparent;border-bottom:24px solid transparent;margin-left:8px}.s{font-size:30px}.u{font-size:22px;margin-top:14px;color:#777}</style></head>
<body><div class="f"><div class="p"><i></i></div><div class="s">YouTube embed stand-in (offline)</div><div class="u">youtube-nocookie.com/embed/${esc(id)}</div></div>
${fail ? '<script>setTimeout(function(){parent.postMessage(JSON.stringify({event:"onError",info:150}),"*")},700)</script>' : ''}</body></html>`;
}

/**
 * A small stand-in for Netflix's all-weeks-countries.tsv (the harness never reaches the internet):
 * several weeks and countries, with the latest UK week naming titles from this library (plus two
 * it doesn't have, which Home drops). Movie names lose their "(year)" as on Netflix.
 */
export const TOP10_WEEK = '2026-11-08';
export function top10Tsv() {
  const head = 'country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10';
  const plain = (n) => n.replace(/\s*\(\d{4}\)$/, '');
  const films = [61, 5, 'A Film Not On This Provider', 130, 200, 222, 87, 300, 150, 12].map((x) => (typeof x === 'number' ? plain(movies[x].name) : x));
  const tv = [3, 40, 'A Show Not On This Provider', 77, 120, 9, 150, 201, 55, 99].map((x) => (typeof x === 'number' ? series[x].name : x));
  const lines = [head];
  const countries = [['France', 'FR'], ['United States', 'US'], ['United Kingdom', 'GB'], ['Germany', 'DE']];
  for (const week of ['2026-10-25', '2026-11-01', TOP10_WEEK]) {
    for (const [cn, iso] of countries) {
      const latestUk = iso === 'GB' && week === TOP10_WEEK;
      for (let r = 1; r <= 10; r++) {
        const f = latestUk ? films[r - 1] : plain(movies[(r * 7 + week.length * 3 + cn.length) % movies.length].name);
        const t = latestUk ? tv[r - 1] : series[(r * 11 + cn.length) % series.length].name;
        lines.push(`${cn}\t${iso}\t${week}\tFilms (English)\t${r}\t${f}\tN/A\t${r}`);
        lines.push(`${cn}\t${iso}\t${week}\tTV (English)\t${r}\t${t}\t${t}: Season 1\t${r}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
