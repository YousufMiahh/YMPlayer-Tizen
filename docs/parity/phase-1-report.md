# Phase 1 report: shared look and app shell

Branch `android-parity`. Android (Java) was the reference throughout. Sizes are Android design units × 1.4 px (`--u` in CSS, `u()` in JS).

## What was built

| Area | Files | Android source |
|---|---|---|
| Design tokens: every colour for dark and light (`html.light`), `--u` unit, radii, text helpers, interpolators | `css/theme.css`, `js/ui/theme.js` | Ui.java |
| Shared component styles: top bar, cards (POSTER/CHANNEL/LANDSCAPE, white ring, 1.08 lift), poster grid cell (1.09), RowCell (hot/active), glider pill, pill button/input, section heading, shelf title, AlertDialog, toast, sheet, splash | `css/ui.css` | Ui, Cards, Adapters, TopBar, Glider, SettingsActivity, PlayerActivity |
| Ambient background: 4-stop gradient, section resting colours, `tone()`, dominant colour (12×12, S·V weighting, LRU 600), 700 ms cross-fade, hand-off between sections. API: `install()`, `setSection(name)`, `tint(url)` (blob fetch, so the canvas is not tainted), `tintColor(c)`, `retheme()` | `js/ui/backdrop.js` | Ambient.java, ImageLoader.average |
| Glider (one pill glides 240 ms / fades 140 ms behind a list) | `js/ui/glider.js` | Glider.java |
| Top bar + section model: YM mark, pill track, six tabs, glide 280 ms / appear 180 ms / vanish 160 ms, hand-off from the previous bar, HH:mm clock every 15 s, dwell 450 ms (not Settings), OK reselect, bar-owned Left/Right/Up/Down, page slide 64u / 420 ms / 60 ms delay. `mountSection()` adds the bar, page, section background and `data-art` tinting to any view | `js/ui/topbar.js` | TopBar.java |
| Up from the page lands on the current tab only; Left/Right/Down from the page never enter the bar | `js/nav.js` (`barFilter`) | TopBar.TabRow.addFocusables |
| Router: `replace`, `backTo`, `resetTo` (Home → X push, X → Y replace, → Home pop, login resets) | `js/router.js` | TopBar.go / finish() |
| Splash: logo 190u, "YM Player" 40u, "Developed by Yousuf Miah" 18u, staged animations, 1400 ms minimum, warm-up hook, 6000 ms cap, Back ignored, replaces itself | `js/views/splash.js` | SplashActivity.java |
| Exit: Back with nothing beneath calls `tizen.application.getCurrentApplication().exit()`. There is no confirm and no double-press, because HomeActivity has no `onBackPressed` | `js/app.js` | HomeActivity |
| Dialog (title, message, neutral/negative/positive or item list, D-pad, Back = null, focus restore), toast (2 s / 3.5 s, replaces the current one), side/bottom sheet (200/250 ms fades, Back closes), pill button, input, section heading, row cell, initials | `js/ui/dialog.js`, `js/ui/toast.js`, `js/ui/sheet.js`, `js/ui/widgets.js` | AlertDialog usage, Toast, PlayerActivity panels, Ui, Adapters |
| Hold OK = 450 ms; `HOLD_OK = 'Hold OK'` for hints | `js/ui/theme.js`, `js/views/live.js`, `js/views/movies.js` | EpgGrid/PlayerActivity 450 ms |
| Views wired to the shell, with minimal changes: Home (bar, Android card shapes, CW progress + "Hold OK to remove from list" hint, initials, focus on the first card), Live/Movies/Series (bar, Down → category, gliders, RowCell rail with trailing ♥, poster cells, channel row order num → logo → name), Search, Settings (bar; Ambient and Phone Link moved here; the theme toggle re-themes live). Blue focus is gone from every stylesheet. Login/Search/Settings/detail CSS uses the tokens | `js/views/*.js`, `js/favourites.js`, `css/*.css` | |
| Screenshot harness | `tools/shots/{fixtures,server,run}.mjs` | |

## Audit items closed

Audit A §3 (missing features): 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 19 (component; the call sites come with their screens), 25, 29 (except the library warm-up, see below), 40, 49 (♥ markers), 50.
Partly closed: 8 (OK on the current tab calls `onReselect`; Browse focuses the first category until the "Search" pseudo-category exists) and 47/48 (row layout only).

Audit A §4 (Tizen differences): 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 18, 20, 23, 25, 27, 28, 32, 33, 34, 36, 37.
Partly closed: 19 (trailing ♥ done, but pinning still puts favourites at the very top), 38 (▲ → current tab and ▼ → top category done; ▶/◀ category rules belong to the Browse rebuild), 35 (see below).

## What doesn't match yet, and why

- **Setup / library warm-up.** Android sends a signed-in user without a saved library to Setup, and warms that library during the splash. Tizen has no library cache yet (audit A 5.1), so the splash sends a signed-in user straight to Home. `splashView({ warmUp })` already waits for a promise (1.4 s min, 6 s cap), so the cache only needs to plug into it.
- **Dialog and toast fonts and colours.** Android uses the framework Material AlertDialog (`Theme_Material_Dialog_Alert`: #424242, teal #80CBC4 caps buttons, 2dp corners) and the system Toast. I copied those, sized at Fire TV's 2 px per dp. Tizen has no Roboto or Amazon Ember, so both use Inter. The exact toast look varies by Fire OS version, so I approximated it with a dark rounded pill near the bottom.
- **Colour cross-fade.** Android's ArgbEvaluator (API 26+) blends in linear light. The Tizen cross-fade uses compositor opacity, which blends in sRGB. Start and end colours are identical; mid-fade hues differ slightly.
- **Artwork that can't be read.** The brief said to fall back to the section colour. `ImageLoader.color` in the Java never calls back on failure, so the colour stays as it is. I followed the Java.
- **Shadows.** Elevation is approximated with `box-shadow`. Android would draw almost no lift shadow, because the card itself has no outline; I kept a soft focus shadow anyway, as the brief asked.
- **TopBar's 320 ms "sync" safety pass** was not ported. Focus/blur handlers cover it in the DOM, and the screenshots showed no stale highlight.
- **Splash → Login uses no fade.** The view swap is instant.
- **Page content not rebuilt** (Phase 2+): Home's "N left" subtitles, Remote/Top 10 rows, the CW remove dialog, pseudo-categories, the Live info panel and EPG, the Login QR panel, and the Settings list content.
- **Commit trailer.** The brief asked for a `Claude Fable 5.2` co-author line. My session's attribution instructions specify `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus the same `Claude-Session` URL, and I used those. Amend the commits if the other wording is required.

## Screenshot harness

```
npm run shots                       # every screen
node tools/shots/run.mjs home live  # only these
npm run mock                        # mock server + app on http://127.0.0.1:8090 (demo / demo)
CHROME=/path/to/chrome npm run shots
```

- One Node server serves the app and `player_api.php` on the same origin. It provides login, categories/streams for all three types, `get_series_info`, `get_vod_info` and `get_short_epg`, with 24/22/20 categories, 321 channels, 360 movies, 267 series and generated SVG artwork. No internet is needed.
- `run.mjs` uses `playwright-core` (devDependency) with the system Chrome at 1920×1080. It seeds a returning user (history, favourites, Continue Watching) through the app's own store, then drives the screens with remote keys (arrows / Enter / Escape).
- PNGs are written to `tools/shots/out/` (gitignored). Screens: splash, login, home, home-light, home-bar, live, movies, settings, dialog, toast. Add a screen by adding an entry to `SCREENS` in `run.mjs`.
- I checked every capture by eye against the Java layout. The highlight was off by about 8 px, and I fixed it.

## Tests

`npm test`: **254 passed** in 17 files (was 212). New files:
- `test/topbar.test.js`: markup, clock, dwell/cancel, Settings and current-tab exceptions, reselect, bar keys, Up → current tab, stack model, page slide, focus on hover arrival, highlight show/hide, router additions.
- `test/ui.test.js`: glider, dialog, toast, sheet, widgets, Ambient maths/tint/cache.
- `test/shell.test.js`: splash content, 1400 ms minimum, warm-up wait, 6000 ms cap, Back ignored, Back on Home exits via tizen, Back from a section goes Home first.

I updated the old tests that expected the previous look: the `data-menu` buttons, the status chip and the blue/#0B0B0F tokens.
