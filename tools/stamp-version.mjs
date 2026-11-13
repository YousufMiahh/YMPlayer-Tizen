#!/usr/bin/env node
// Writes the build's version into the two places the app reads it from:
//   config.xml   <widget version="…">            (what the TV shows for the installed package)
//   js/version.js  export const VERSION = '…'    (Settings → About, when not on a TV)
// The CI build runs it with 1.0.<run number> (Android's versionName scheme) before packaging:
//   node tools/stamp-version.mjs 1.0.123
// test/config.test.js keeps the two files in step, stamped or not.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Tizen package versions: x.y.z with x, y <= 255 and z <= 65535. */
export function valid(v) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,5})$/.exec(String(v));
  return !!m && Number(m[1]) <= 255 && Number(m[2]) <= 255 && Number(m[3]) <= 65535;
}

/** config.xml with the <widget> element's version replaced (nothing else touched). */
export function stampConfig(xml, v) {
  let hit = false;
  const out = xml.replace(/(<widget\b[^>]*?\sversion=")[^"]*(")/, (_, a, b) => { hit = true; return a + v + b; });
  if (!hit) throw new Error('config.xml: no <widget version="…"> to stamp');
  return out;
}

/** js/version.js with the VERSION constant replaced. */
export function stampVersionJs(src, v) {
  let hit = false;
  const out = src.replace(/(export const VERSION = ')[^']*(')/, (_, a, b) => { hit = true; return a + v + b; });
  if (!hit) throw new Error("js/version.js: no export const VERSION = '…' to stamp");
  return out;
}

export function stamp(root, v) {
  if (!valid(v)) throw new Error(`"${v}" is not a Tizen version (x.y.z, x and y up to 255, z up to 65535)`);
  const cfg = path.join(root, 'config.xml'); const js = path.join(root, 'js', 'version.js');
  writeFileSync(cfg, stampConfig(readFileSync(cfg, 'utf8'), v));
  writeFileSync(js, stampVersionJs(readFileSync(js, 'utf8'), v));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = process.argv[2];
  try {
    stamp(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), v);
    console.log(`stamped version ${v} into config.xml and js/version.js`);
  } catch (e) { console.error(e.message || e); process.exit(1); }
}
