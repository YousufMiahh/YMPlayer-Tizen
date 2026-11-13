# Phase 8 report: Search, Settings, Ambient, Coach, leftovers

Branch `android-parity`. Reference: SearchActivity.java, SettingsActivity.java, Ambient.java, Coach.java (and every `Coach.show` call site), Match.java, Filters.java, XtreamApi.describeAccount, Prefs.java, PlayerFactory.java.

This phase was taken over part-way. The Search rebuild and the start of Settings were in the tree uncommitted; I checked the Search work line by line against SearchActivity.java, kept it, and finished the rest.

## What was built

| Area | Files | Android source |
|---|---|---|
| **Search.** One scrolling page with the top bar: the box ("Channels, movies and series", 820u, centred 24u text), chips All / Live TV / Movies / Series (All by default), the status line, then Channels, Movies, Series. All = a shelf of up to 40 per section headed "Movies  ·  40+"; one chip, or All with hits in only one section, = a full grid of up to 120. 2 characters minimum, 300 ms after the last key, `Match.rank` over `Filters.searchItems`, each section filling as its list arrives, stale results dropped. Channels are CHANNEL cards, the others POSTER. OK opens through `js/open.js` with the hits as the zap list; Hold OK / Menu toggles the favourite. Enter / the IME's Done searches at once and leaves the box for the first result (else the Search tab); Back or the IME's Cancel in the box does the same; OK on the Search tab returns to the box. Status texts: "Type to search everything", "Getting your library ready…", "Searching…", `No results for "q"`. The query, chip and focused card survive a visit to a details page. Android has no recent searches, so there are none. | `js/views/search.js`, `css/search.css` | SearchActivity |
| **Settings.** A 900u list under the top bar in one scroller. Every row is one pill: label left, value right; OK runs the row and most values cycle in place. Info rows (the account in use, Subscription, Version) can't take focus. Sections and rows in Android's order with Android's labels, values and defaults (the test lists all 40 lines). Subscription ("Checking…" → "Active  ·  Expires: …  ·  Connections: 1/2" or "Offline — …"), Theme (flips, re-themes, restarts at Home), Live TV Preview, the two filter dialogs, the nine Home rows, the four subtitle rows with the sample frame (and the "Turn Background on to see this" toast), Live Stream Format, Fix Frozen Video Automatically, User Agent (Android's dialog: message, field, Default / Cancel / Save), Refresh Automatically, Refresh Now, Clear Watch History, Show Tutorial, Version, "Developed by Yousuf Miah". ▼ on the last row scrolls on (ScrollView.arrowScroll), which is how Version comes into view. A row keeps its focused look under a dialog it opened. Coming back from Login returns to the same row. | `js/views/settings.js`, `css/settings.css`, `js/accounts-ui.js`, `js/ui/widgets.js` (`settingsRow`), `js/ui/dialog.js` (`input`), `js/store.js` (`clearHistory`), `js/version.js` | SettingsActivity, Prefs.clearHistory |
| **Ambient.** In Android it is the background-colour system, not a screensaver, and `js/ui/backdrop.js` has been that since phase 1. The Tizen screensaver view, its stylesheet, its route and its tests are removed. | removed `js/views/ambient.js`, `css/extras.css` | Ambient.java |
| **Coach.** Checked every `Coach.show` / `Coach.offer` call in the Java against the port: the welcome offer, `home` (3 tips), `live` (4), `vod` (2), `player_live`, `player_vod`, `search` (2). All exist with Android's texts (the non-Fire "Hold OK" wording) and the same rules (tutorial on, once per screen, 900 ms after the screen opens, steps without a visible target left out). Settings → Show Tutorial clears every coach flag, sets asked + on, and restarts at Home, as `Coach.restart` does. Nothing needed changing beyond the Settings row. | `js/ui/coach.js` (unchanged), `js/views/settings.js` | Coach.java |
| **Leftovers.** Live preview now asks AVPlay for a short start buffer. `js/favourites.js` (unused) is gone. README rewritten. The shots harness had two screens named `series`; the Browse one is now `series-browse`. | `js/live-preview.js`, `README.md`, `tools/shots/run.mjs` | PlayerFactory.create(preview) |

## Where I followed Android against the brief

- **Clear Watch History has no confirm.** The brief listed it "with confirm". SettingsActivity clears at once and shows the toast "Watch history cleared", and so does this port. Adding a dialog is a few lines if it is wanted (`row('clear_history', …)` in `js/views/settings.js`); say so and I'd add it with the same Remove / Cancel dialog shape.
- **User Agent stays in Settings.** Android shows it under PLAYBACK with a dialog, so it is kept, as that dialog rather than an inline field. There are no inline text fields left in Settings, so "save on input" has nothing to apply to: Save in the dialog stores the text, and ▼ or the keyboard's Done moves from the field to Save.
- **Theme exists on Android** (APPEARANCE → Theme, Dark / Light), so it is kept and works: `html.light` swaps every token, the backdrop re-tones, dialogs and toasts switch. The old dead "Dark theme" toggle and the "Extras" section are gone.

## Rows Android has that are left out

| Android row | Why |
|---|---|
| Video Player, Remembered Player Choices | One engine (AVPlay). |
| Last Error Report | No crash capture on Tizen (phase 3). |
| Check for Updates | No in-app updates on a TV; the brief excludes it. |
| (player) Audio Sync | AVPlay cannot offset audio. |

## Could not be matched

- **Version text.** Android shows its `versionName` (1.0.N). Tizen shows the package version from `tizen.application.getAppInfo()`, falling back to `js/version.js` (kept equal to config.xml by a test). The CI build stamps `1.0.<run number>` into both before packaging (`tools/stamp-version.mjs`); a local build reads 1.0.0.
- **Search focus after Enter.** Android closes the keyboard at once and the results land a moment later; here focus waits for the results so it can go to the first one. The end state is the same.
- **Preview start buffer.** Android uses 0.3 s; AVPlay counts whole seconds, so 1 s. Check on a TV.
- **Not verifiable here:** the Tizen IME's Done (65376) and Cancel (65385) keys in the search box and the User Agent dialog; `getAppInfo().version`.

## Screenshots

`npm run shots` (105 screens) → `tools/shots/out/`. New in this phase:

- Search: `search`, `search-all`, `search-all-down`, `search-one`, `search-live`, `search-movies`, `search-series`, `search-none`, `search-short`, `search-fav`, `search-tour`, `search-light`.
- Settings: `settings`, `settings-appearance`, `settings-home`, `settings-subtitles`, `settings-subtitles-bg`, `settings-opacity-toast`, `settings-playback`, `settings-useragent`, `settings-useragent-save`, `settings-library`, `settings-clear`, `settings-about`, `settings-remove`, `settings-countries`, `settings-hidden`, `settings-offline`, `settings-light`, `settings-theme`, `settings-tutorial`.

The whole harness was run once at the end: all 105 screens saved with no page errors (the only console lines are the deliberate provider failures in `login-error`, `setup-error`, `settings-offline` and `series-error`), and the earlier phases' screens I re-read (Home, Live TV, Series browse, light theme) are unchanged.

I read the new captures against the Java. What came out of that: Version and the credit could not be reached (no focusable row below Show Tutorial), fixed with the ScrollView scroll-on rule; the sample frame's bottom margin was doubled; ▼ from the search box lands on Movies, which is where Android's FocusFinder lands too (nearest centre), so it stays.

## Tests

`npm test`: **538 passed** in 25 files (was 512 passing + 12 failing at hand-over).

- `test/search.test.js` (25): box, chips and status texts; the 2-character minimum; shelves in section order with headings; the single-section grid; each chip; the 40 / 120 caps with "+"; grid columns; no results; hidden countries; card shapes; OK, Hold OK and Menu; Enter / Done; Back; the tab reselect; saved library only; state kept on return; the tour. **Ranking order:** exact > starts with > words together > word starts > contained, shorter names first on ties, spaces / dashes / accents ignored, words in any order, provider tags ignored, provider order on exact ties.
- `test/settings.test.js` (24), rewritten: the whole list in order with defaults; rows that must not exist; row kinds and first focus; Subscription; every row persisting (preview, theme, nine Home rows, four subtitle rows + sample + toast, format, auto-recover, refresh cycle, Refresh Now); the User Agent dialog (Save, Cancel, Default, Done → Save, focused look kept); Switch, Add, Edit, Remove (dialog text, Cancel, Remove, last account); Clear Watch History (this account only, favourites kept); Show Tutorial reset; scrolling past the last row; focus on return.
- `test/package.test.js` (6), new, replaces `extras.test.js`: the build stages config.xml, index.html, js/, css/, assets/; every import resolves; no unused module; index.html loads exactly the stylesheets in css/; every `url()` and asset path exists in a staged folder; the screensaver, outbound QR and key gates are gone.
- `test/config.test.js`: `js/version.js` equals config.xml's version.

`.github/workflows/build.yml` needed no change: it stages `js`, `css` and `assets` as whole folders, so `js/ui`, `js/views` and `assets/fonts` are included. The new test holds that in place.

## Audit closure

"Closed" names the phase report (P1–P8) that records it. Totals: **281 items, 263 closed, 18 open.** Of the 18, 13 cannot be done on a Samsung TV or were excluded by the brief, 2 were decided against earlier, and 3 are partial.

### Audit A §3: features in Android missing from Tizen (56)

| # | Item | Status |
|---|---|---|
| 1–7 | Top bar, Home tab, hover-to-open, gliding highlight, YM mark, clock, Up to the current tab | Closed, P1 |
| 8 | OK on the current tab = reselect | Closed, P1 + P4 (Browse → Search category), P8 (Search → box) |
| 9–11 | Section slide, ambient background, light theme | Closed, P1 (light theme reachable from Settings, P8) |
| 12–18 | Card shapes, CW progress, "N left", initials, hint, remove dialog, Hold OK favourite | Closed, P1 / P3 |
| 19 | Toasts | Closed, P1 |
| 20–21 | Top 10 rows, hourly re-check | Closed, P3 |
| 22 | Recently Added respects filters, keeps 24 | Closed, P3 + P4 |
| 23–26 | First-run text, welcome state, first-card focus, rows refresh with the library | Closed, P2 / P3 |
| 27 | Tutorial / coach | Closed, P3 (system, Home), P4 (Browse), P6 (Player), P8 (Search, Show Tutorial) |
| 28 | Crash-report notice | **Open**: decided against in P3 (a web app does not close on a script error) |
| 29 | Branded splash | Closed, P1 + P2 |
| 30–36 | Pseudo categories, section search, dwell, arrival category, ▶ / ◀ rules, Favourite / Hide dialog | Closed, P4 |
| 37 | Country / category filtering everywhere | Closed, P4 (guide lists the filtered channels, P5; Search, P8) |
| 38–44 | Hint, pinned favourites, gliders, slide-in, spinner and texts, info panel, live preview | Closed, P4 |
| 45–46 | TV guide, programme details | Closed, P5 |
| 47 | "▶" playing marker, active row | Closed, P4 (Android never sets the marker in Browse; the player's list has it, P6) |
| 48–50 | Channel number fallback, ♥ markers, two-line titles | Closed, P1 / P4 |
| 51–53 | Zap queue from Home, Continue lists in Browse, reload on filter change | Closed, P3 / P4 |
| 54 | Update checker | **Open**: no in-app updates on a TV; excluded by the brief |
| 55 | Library cache, scheduled refresh, preload | Closed, P2 |
| 56 | Search ranking (Match) | Closed, P3 (port), P4 (Browse), P8 (Search) |

### Audit A §4: things Tizen does differently (42)

| # | Item | Status |
|---|---|---|
| 1 | Menu labels and order; Ambient and Phone entries | Closed, P1; the Ambient entry is removed altogether, P8 |
| 2–10 | Menu styling, status chip, padding, shelf title, card spacing / size / focus / title / radius | Closed, P1 |
| 11–16 | Initial focus, Recent limit, Recently Added count, Top 10 titles and source, CW pick, row build order | Closed, P3 |
| 17–32 | Browse widths, rows, markers, long OK, Menu key, hold time, channel row, EPG fetch, grid, texts, errors, Back | Closed, P1 / P4 |
| 33–35 | Back on Home exits, splash timing, splash destination | Closed, P1 / P2 |
| 36–37 | Background colour, focus accent | Closed, P1 |
| 38–39 | Navigation rules, category marking | Closed, P1 / P4 |
| 40 | Home focus on return | Closed, P3 |
| 41 | Images cannot send the provider User-Agent | **Open**: `<img>` cannot set it; fetching every image as a blob was judged too costly (P4) |
| 42 | Search screen (debounce, caps, ranking, texts) | Closed, P8 |

### Audit B §2: features in Android missing from Tizen (83)

| # | Item | Status |
|---|---|---|
| 1–3 | TV guide, details dialog, hints | Closed, P5 |
| 4–7 | Channel list in the player, favourites from the player, Subtitles & Audio panel, remembered languages | Closed, P6 |
| 8 | Audio Sync | **Open**: cannot (AVPlay has no audio offset); excluded by the brief |
| 9–10 | Subtitle size in the player, subtitle rendering | Closed, P6 |
| 11 | Player engine choice | **Open**: cannot (one engine); excluded by the brief |
| 12–17 | Scrub, seek bubble, Next Episode card, centre icon, hint, episode line | Closed, P6 |
| 18 | Remaining time and buffered segment | Closed, P6 (remaining time; AVPlay has no buffered position, as VLC on Android) |
| 19–25 | Logo box, heart, hint, no-guide text, spinner, status pill, error card | Closed, P6 |
| 26 | Retry ladder | Closed, P6 (no engine rung) |
| 27–37 | Reconnect, watchdog, zap debounce, media keys, ▲, INFO, long OK, layered Back, coach, resume toast, save rule | Closed, P6 |
| 38–50 | Movie and series pages (backdrop, meta, credits, Trailer, Start Over, refresh on return, Favourite, cards, labels, history-based button, start season, Specials) | Closed, P7 |
| 51–55 | Search: All, ranking, shelves / grids, status texts, Back and filters | Closed, P8 |
| 56–58 | Subscription row, Edit This Account, Remove confirm | Closed, P2 (56 in P8) |
| 59 | Hide What You Don't Watch | Closed, P4 |
| 60 | Subtitle sample frame | Closed, P8 |
| 61 | Extra Large | Closed, P6 |
| 62–64 | Video Player, Last Error Report, Remembered Player Choices | **Open** (3): cannot / not applicable; excluded by the brief |
| 65–66 | Fix Frozen Video toggle, User Agent dialog | Closed, P8 |
| 67 | Refresh Now | Closed, P2 |
| 68–69 | Clear Watch History, Show Tutorial | Closed, P8 |
| 70 | About: Version, footer | Closed, P8 (Check for Updates left out, see 82) |
| 71 | Theme re-themes and restarts Home | Closed, P1 + P8 |
| 72–73 | Account name, login help text | Closed, P2 |
| 74 | "Use your phone" QR and LAN server | **Open**: a TV web app cannot listen on a socket; the card says so (P2) |
| 75 | User-agent fallback list and candidate addresses | **Open (partial)**: candidate addresses done (P2); browsers cannot change the request User-Agent |
| 76–79 | Connecting state and errors, auto-forward, Setup screen, Add Account title | Closed, P2 |
| 80–81 | Ambient tints, page gradient | Closed, P1 |
| 82 | In-app updater | **Open**: not applicable; excluded by the brief |
| 83 | Feedback on unsupported audio | **Open**: AVPlay cannot say what it will decode; the track list shows the codec (P6) |

### Audit B §3: things Tizen does differently (73)

| # | Item | Status |
|---|---|---|
| 1–4 | Focus style, surfaces, background, type scale | Closed, P1 |
| 5 | Ambient was a screensaver | Closed, P1 (tints), P8 (screensaver removed) |
| 6–16 | Live player | Closed, P6 |
| 17–30 | VOD player | Closed, P6 |
| 31–35 | Movie page | Closed, P7 |
| 36–42 | Series page | Closed, P7 |
| 43–48 | Search: chips and default, box, matching, results, messages, top bar | Closed, P8 (48 in P1) |
| 49–51 | Settings structure, row widget, section headers | Closed, P8 |
| 52–53 | Subtitle colours and sizes | Closed, P6 |
| 54–57 | Preview labels, refresh labels and order, format label, Title Case | Closed, P8 (55 in P2) |
| 58 | Subtitle / Audio language inputs | Closed, P8 (removed; set in the player, P6) |
| 59–60 | Theme row, Customise Home Screen | Closed, P8 (names in P3) |
| 61–63 | Accounts rows, label, switching | Closed, P2 (row style P8) |
| 64–71 | Login and Setup | Closed, P2 |
| 72 | Phone link direction | **Open**: the outbound QR is removed (P2); the inbound form cannot be built in a web app |
| 73 | Splash destination | Closed, P2 |

### Audit B §4: engine notes (23 rows + 4 notes)

| Row | Status |
|---|---|
| Audio track list and labels; select audio; subtitle tracks; Off; rendering and style; preferred languages | Closed, P6 |
| Audio delay | **Open**: cannot |
| Engine switch, remembered choice | **Open**: cannot |
| Freeze detection (heuristic); auto-recover; retry ×2; .ts ⇄ .m3u8 | Closed, P6 |
| Detect unsupported audio | **Open**: not detected (see B §2.83) |
| Buffering spinner | Closed, P6 |
| Buffered position on the bar | **Open**: cannot (no API) |
| Duration / position / seek; start-time resume; letter-box; no speed control; user agent | Closed, P6 |
| Fast-start preview buffer | Closed, P8 (1 s; verify on a TV) |
| Keep the screen on | Closed, P6 |
| Mute for the preview | Closed, P4 (TV-wide mute) |
| Note: long-press OK and media keys | Closed, P5 / P6 |
| Note: Menu key | Closed: every ☰ action also works with Hold OK; the key code itself is unverified on a TV |
| Note: phone link | **Open**: cannot (see B §2.74) |
| Note: trailers without a key | Closed, P7 |

### Audit B §5: prefs table

Every key Android exposes that can work on Tizen is now exposed with Android's label, values and default: accounts / current, account `ua`, `live_format`, `sub_size`, `sub_color`, `sub_bg`, `sub_bg_opacity`, `sub_lang` / `audio_lang` (player), `auto_recover`, `dark`, `preview`, `refresh_hours`, `lib_time`, `home_*`, favourites, positions, durations, history (with Clear Watch History), filters, coach flags. Not present: `adelay_*`, `engine`, `vlc_*` / `exo_items`, `updater` (cannot / not applicable).

## Still open (18)

1. A §3.28 crash-report notice (decided against).
2. A §3.54, B §2.82 update checker / in-app updater (2; excluded).
3. A §4.41 provider User-Agent on images.
4. B §2.8, B §4 audio delay: Audio Sync (2; cannot).
5. B §2.11, B §2.62, B §2.64, B §4 engine switch: player choice (4; cannot).
6. B §2.63 Last Error Report (not applicable).
7. B §2.74, B §3.72, B §4 note: sign-in from a phone (3; cannot in a web app).
8. B §2.75 User-Agent retries at login (partial).
9. B §2.83, B §4 unsupported-audio detection (2).
10. B §4 buffered position on the seek bar (cannot).

## To check on a TV

The IME Done / Cancel keys (Search box, User Agent dialog); the Menu and Info key codes; the preview hole, mute and start buffer; the bounds glide into the guide; subtitle and audio track listing per container; Netflix Top 10 download through the `<access>` origin; the package version shown in About.
