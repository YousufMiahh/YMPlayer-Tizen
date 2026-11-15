// What ships in the .wgt: every file the app loads exists, sits in a folder the build stages,
// and nothing from the pre-rebuild app is left behind.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname, normalize, relative } from 'node:path';

const ROOT = process.cwd();
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8');
const files = (dir) => readdirSync(resolve(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

/** Every module reachable from js/app.js through static or dynamic relative imports. */
function reachable(entry) {
  const seen = new Set();
  const walk = (f) => {
    f = normalize(f);
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of read(f).matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) walk(join(dirname(f), m[1]));
  };
  walk(entry);
  return seen;
}

describe('the app package', () => {
  const html = read('index.html');
  const yml = read('.github/workflows/build.yml');
  const staged = yml.match(/rsync -a[\s\S]*?"\$STAGE\/"/)[0];
  const stagedRoots = ['config.xml', 'index.html', 'js', 'css', 'assets'];

  it('the build stages config.xml, index.html, js/, css/ and assets/ (whole folders, so js/ui and js/views come along)', () => {
    for (const r of stagedRoots) expect(staged).toMatch(new RegExp(`\\b${r.replace('.', '\\.')}\\b`));
    expect(staged).toContain("--exclude='*.test.js'");
    expect(yml).toContain('npm test');
  });

  it('every import resolves to a file under js/', () => {
    for (const f of reachable('js/app.js')) {
      expect(existsSync(resolve(ROOT, f)), f).toBe(true);
      expect(f.startsWith('js/'), f).toBe(true);
    }
  });

  it('no module is left unused, and no test files sit inside the shipped folders', () => {
    const used = reachable('js/app.js');
    expect(files('js').filter((f) => !used.has(normalize(f)))).toEqual([]);
    expect([...files('js'), ...files('css'), ...files('assets')].filter((f) => /\.test\.js$/.test(f))).toEqual([]);
  });

  it('index.html loads every stylesheet in css/, and each one exists', () => {
    const linked = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(linked).toEqual(files('css').map((f) => f.replace(/\\/g, '/')).sort());
    expect(html).toContain("from './js/app.js'");
  });

  it('every url() in the stylesheets and every asset path in the scripts points at a staged file', () => {
    for (const f of files('css')) {
      for (const m of read(f).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (/^(data:|https?:|#)/.test(m[1])) continue;
        const target = relative(ROOT, resolve(ROOT, dirname(f), m[1]));
        expect(existsSync(resolve(ROOT, target)), `${f}: ${m[1]}`).toBe(true);
        expect(stagedRoots.some((r) => target === r || target.startsWith(`${r}/`)), target).toBe(true);
      }
    }
    for (const f of files('js')) {
      for (const m of read(f).matchAll(/['"`](assets\/[^'"`]+)['"`]/g)) expect(existsSync(resolve(ROOT, m[1])), `${f}: ${m[1]}`).toBe(true);
    }
  });

  it('the pre-rebuild extras are gone: no screensaver, no outbound QR, no key gates', async () => {
    const { views } = await import('../js/app.js');
    expect(Object.keys(views).sort()).toEqual(['home', 'live', 'login', 'movie-detail', 'movies', 'player-live', 'player-vod',
      'search', 'series', 'series-detail', 'settings', 'setup', 'splash', 'trailer']);
    for (const gone of ['js/views/ambient.js', 'js/views/phonelink.js', 'js/keys.js', 'js/vendor', 'css/extras.css', 'js/favourites.js']) {
      expect(existsSync(resolve(ROOT, gone)), gone).toBe(false);
    }
    const src = files('js').map(read).join('\n');
    expect(src).not.toMatch(/hasTmdb|hasYoutube|googleapis\.com\/youtube/); // nothing is gated on a key the user must supply
    // The Movie Database is used the way the Android app uses it (Skip Intro, Because You Watched), from one module.
    expect(files('js').filter((f) => /api\.themoviedb\.org/.test(read(f)))).toEqual(['js/tmdb.js']);
    const homeRows = await import('../js/home-rows.js');
    expect(homeRows.REMOTE_ROWS.map((r) => r.key)).toEqual(['top_movies', 'top_series', 'new_movies', 'new_series']);
  });
});
