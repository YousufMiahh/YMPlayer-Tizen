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

export function shortEpg(streamId, limit = 4) {
  const t0 = Math.floor(Date.now() / 1000);
  const slot = 1800 * (1 + (Number(streamId) % 3));
  let start = t0 - Math.floor(slot * 0.4);
  const out = [];
  for (let i = 0; i < limit; i++) {
    const title = SHOWS[(Number(streamId) + i) % SHOWS.length];
    out.push({
      id: String(i), epg_id: `ch${streamId}`, title: b64(title), lang: 'en',
      start: new Date(start * 1000).toISOString().replace('T', ' ').slice(0, 19),
      end: new Date((start + slot) * 1000).toISOString().replace('T', ' ').slice(0, 19),
      description: b64(`${title}: the latest from around the country, with guests and features.`),
      channel_id: `ch${streamId}`, start_timestamp: String(start), stop_timestamp: String(start + slot),
    });
    start += slot;
  }
  return { epg_listings: out };
}

export function seriesInfo(id) {
  const s = find('series', id);
  if (!s) return {};
  const episodes = {};
  for (let season = 1; season <= 3; season++) {
    episodes[String(season)] = Array.from({ length: 8 }, (_, i) => ({
      id: String(id * 100 + season * 10 + i), episode_num: i + 1, title: `${s.name} S${season}E${i + 1}`,
      container_extension: 'mp4', season,
      info: { duration_secs: 2700, plot: 'Things take an unexpected turn.', movie_image: s.cover },
    }));
  }
  return {
    seasons: [1, 2, 3].map((n) => ({ season_number: n, name: `Season ${n}`, cover: s.cover })),
    info: { name: s.name, cover: s.cover, plot: s.plot, cast: s.cast, director: s.director, genre: s.genre,
      releaseDate: s.releaseDate, rating: s.rating, backdrop_path: [] },
    episodes,
  };
}

export function vodInfo(id) {
  const m = find('movie', id);
  if (!m) return {};
  return {
    info: { name: m.name, movie_image: m.stream_icon, plot: 'When a quiet town is shaken by a strange signal, one engineer must decide who to trust.',
      cast: 'Alex Morgan, Sam Patel, Lee Chen', director: 'Jo Reid', genre: 'Drama', releasedate: '2023-05-01',
      duration_secs: 6420, duration: '01:47:00', rating: m.rating, youtube_trailer: '', backdrop_path: [] },
    movie_data: { stream_id: m.stream_id, name: m.name, added: m.added, category_id: m.category_id, container_extension: 'mp4' },
  };
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
