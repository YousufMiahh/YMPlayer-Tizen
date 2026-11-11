# YM Player for Tizen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement YM Player (Xtream Codes IPTV player) as a Tizen 7+ web app for a rooted Samsung S90D, matching the Android app's features and look.

**Architecture:** Single-page vanilla-JS app, no framework. A router/shell swaps per-screen view modules over one root; shared services are `api` (Xtream HTTP), `store` (localStorage Prefs port), `player` (AVPlay wrapper), `nav` (D-pad spatial focus). Video is Tizen AVPlay only (TS↔HLS fallback replaces the Android ExoPlayer/VLC split). Packaged and signed as a `.wgt` in GitHub Actions.

**Tech Stack:** HTML/CSS/vanilla ES modules; Tizen Web Device API (AVPlay, `tizen.tvinputdevice`); Node.js + vitest + jsdom for tests; Tizen Studio CLI (`tizen`, `sdb`) for packaging in CI.

**Spec:** `docs/superpowers/specs/2026-11-11-ymplayer-tizen-design.md`

## Global Constraints

- Target **Tizen 7.0+** (`required_version` 7.0 in `config.xml`); app id/package self-chosen, consistent across `config.xml`.
- **Vanilla JS, no UI framework.** ES modules only. No build-time bundler required to run on-device.
- **Theme tokens (exact):** background `#0B0B0F`, accent `#0A84FF`, font family `Inter`. Bundle the Inter fonts from the source repo.
- **Default user-agent:** `XtreamPlayer/1.0 (Linux; Android; Fire TV)` unless an account overrides it.
- **Store key scheme (verbatim from spec §2):** per-account prefix `""` for the first account else `"{id}_"`; `fav_{type}`, `favcat_{type}`, `pos_{key}`, `dur_{key}`, `hist_live`/`hist_vod`, `lib_time`; global `live_format` (`ts`|`m3u8`), `preview`, `refresh_hours`, `dark`, subtitle/audio keys; home toggles `home_{continue,recent,fav_live,fav_movie,fav_series,top_movies,top_series,new_movies,new_series}`. Item key = `{type}:{id}`.
- **No external API keys for v1.** Top 10 (`top_movies`/`top_series`) and Trailers are built but hidden/disabled when no TMDB/YouTube key is present. Every other feature works from Xtream alone. A missing key hides its feature, never breaks a screen.
- **Signing:** self-signed Tizen author+distributor cert (rooted TV accepts it). No Samsung partner cert.
- **Commits:** end every commit message with the two attribution lines from the session reminder.

## Review Focus

- **Pasted M3U link as server** — user types a whole `get.php?username=…&password=…` URL into the server box; `store`/`api` must extract server/user/pass, not treat it as a bare host. (Task 3)
- **Provider returns an error object, not an array** — `get_*` endpoints sometimes return `{}` or an error object; list parsing must yield `[]`, not throw. (Task 3)
- **Live first-format failure → fallback** — if `.ts` URL errors, the player must retry `.m3u8` (and vice-versa) before giving up, honouring `auto_recover`. (Task 7, Task 8)
- **Base64 EPG fields** — `title`/`description` in `get_short_epg` are base64; must decode, and tolerate already-plain text without corrupting it. (Task 3)
- **Per-account namespace isolation** — favourites/resume/history for account A must never leak into account B; switching `current` re-scopes all reads/writes. (Task 2)

---

### Task 1: Project scaffold + smoke test

**Files:**
- Create: `config.xml`, `index.html`, `css/theme.css`, `js/app.js`, `assets/fonts/*` (copy Inter from source), `assets/logo.png`
- Create: `package.json`, `vitest.config.js`, `test/smoke.test.js`
- Create: `.gitignore`

**Interfaces:**
- Produces: `js/app.js` exporting `boot(rootEl)`; `config.xml` with the app id and Tizen 7.0 floor; `theme.css` exposing CSS vars `--bg`, `--accent`, `--font`.

- [ ] **Step 1: Write the failing test** — `test/smoke.test.js`: importing `js/app.js` exposes a `boot` function; `theme.css` contains `--bg:#0B0B0F` and `--accent:#0A84FF`.
- [ ] **Step 2: Run, verify fail** — `npx vitest run test/smoke.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** scaffold: `config.xml` (Tizen web app, `required_version="7.0"`, fullscreen, `http://tizen.org/privilege/internet`, `.../tv.inputdevice`, `.../application.launch`), `index.html` loading `theme.css` + `js/app.js` as a module into `#root`, `js/app.js` with `export function boot(rootEl){…}`, `theme.css` tokens, copy Inter fonts, add `package.json` (vitest, jsdom).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat: project scaffold and theme tokens`.

---

### Task 2: `store.js` — Prefs port over localStorage

**Files:**
- Create: `js/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Produces: `accounts()`, `current()`, `setCurrent(id)`, `saveAccount(acc)`, `removeAccount(id)`, `newAccount()`, `hasAccount()`; `server()/user()/pass()/userAgent()/setUserAgent(ua)`; `liveFormat()/setLiveFormat(f)`, `previewMode()`, `refreshHours()`, `dark()`, subtitle/audio getters+setters; `favs(type)`, `isFav(item)`, `toggleFav(item)`, `favCategories(type)`, `toggleFavCategory(type,id)`; `position(item)/setPosition(item,ms)`, `duration(item)/setDuration(item,ms)`; `history(live)`, `addHistory(item)`; `homeShows(key)/setHomeShows(key,on)`. `item.key()` = `{type}:{id}`. Namespacing exactly per Global Constraints.

- [ ] **Step 1: Write failing tests** — namespace isolation (fav added under account A absent under account B); `toggleFav` returns new state and persists; `position`/`duration` round-trip and clear on 0; `history` caps at 40 newest-first and de-dupes; `homeShows` defaults true. Use a jsdom `localStorage`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `js/store.js` with the key scheme; port the legacy-single-account adoption (first run copies old `server/user/pass` into `accounts[]`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat: localStorage store (accounts, favourites, resume, history, home toggles)`.

---

### Task 3: `api.js` — Xtream client

**Files:**
- Create: `js/api.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `store` (for server/user/pass/ua).
- Produces: `normalize(server)`; `login()`; `describeAccount(userInfo)`; `categories(type)`; `streams(type, categoryId)`; `seriesInfo(id)`; `vodInfo(id)`; `epg(streamId, limit=6)` → `[{title,desc,start,stop,timeRange(),progress()}]`; `shortEpg(streamId)` → `[now, next]`; `playUrl(item, liveFormat)`. `type` ∈ `live|movie|series`. URLs exactly per spec §2 (live `/live/u/p/id.fmt`, movie `/movie/…`, episode `/series/…`).

- [ ] **Step 1: Write failing tests** (mock `fetch`):
  - `normalize('line.ex.com:8080/get.php?username=a&password=b')` → `http://line.ex.com:8080`; prepends `http://`; strips trailing slash.
  - pasted M3U link → server/user/pass extracted (Review Focus).
  - `categories` returns `[]` when the body is `{}` not an array (Review Focus).
  - `streams('live', '5')` maps `stream_id/name/stream_icon/num/container_extension/category_id`.
  - `epg` decodes base64 `title`/`description` and drops entries ended before now (Review Focus).
  - `playUrl` for live/movie/episode produce the three exact URL shapes.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `js/api.js`; stream-parse large arrays (incremental JSON or chunked fetch) keeping only the spec's fields; send `User-Agent` header where the webview allows, else document the limit.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat: Xtream API client`.

---

### Task 4: `nav.js` — D-pad spatial focus engine

**Files:**
- Create: `js/nav.js`
- Test: `test/nav.test.js`

**Interfaces:**
- Produces: `register(container)`, `focusFirst(container)`, `onKey(keyEvent)` returning whether handled; `moveFocus(dir)` (`up|down|left|right`) picking the nearest focusable by geometry; events `activate` (OK) and `back`. Binds Tizen remote keys via `tizen.tvinputdevice.registerKey` when present.

- [ ] **Step 1: Write failing tests** (jsdom with stubbed `getBoundingClientRect`): right/down move to nearest neighbour; focus wraps/stops at edges per rule; OK fires `activate` on focused element; Back fires `back`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** geometry-based nearest-in-direction selection; ignore non-visible elements.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat: D-pad spatial navigation engine`.

---

### Task 5: Shell + router

**Files:**
- Create: `js/router.js`, `js/view.js` (base view contract)
- Modify: `js/app.js`
- Test: `test/router.test.js`

**Interfaces:**
- Produces: `router.go(name, params)`, `router.back()`, `router.stackDepth()`; a view contract `{mount(root, params), unmount(), onKey(e)}`. `app.boot` wires `nav` key events to the active view then the router.

- [ ] **Step 1: Write failing tests** — `go` mounts a registered view and unmounts the previous; `back` pops and remounts; Back at depth 1 emits an `exit` intent.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** router + view registry; a dummy view in the test.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat: view router and shell`.

---

### Task 6: Login / Setup view

**Files:**
- Create: `js/views/login.js`, `js/views/setup.js`, `css/login.css`
- Test: `test/login.test.js`

**Interfaces:**
- Consumes: `api.login`, `api.describeAccount`, `store` account methods, `nav`, `router`.
- Produces: views `login`, `setup`; on success `store.saveAccount({…, ok:true})`, `store.setCurrent(id)`, `router.go('home')`.

- [ ] **Step 1: Write failing tests** — submitting server/user/pass calls `api.login`, saves an `ok` account on a valid `user_info`, shows the account status line; a pasted M3U link fills server/user/pass; multi-account add/switch/remove updates `current`.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: login and multi-account setup`.

---

### Task 7: `player.js` — AVPlay wrapper + TS/HLS fallback

**Files:**
- Create: `js/player.js`, `js/avplay-shim.js` (test/dev stand-in)
- Test: `test/player.test.js`

**Interfaces:**
- Consumes: `api.playUrl`, `store` (live format, auto_recover, positions).
- Produces: `open(item, {startMs})`, `play()`, `pause()`, `seek(ms)`, `stop()`, `setRate`, events `ready|playing|ended|error|timeupdate`. On live error, retry the other format (`ts`↔`m3u8`) once before emitting `error` (Review Focus); on VOD `ended`, emit for auto-next; save `position`/`duration` on stop.

- [ ] **Step 1: Write failing tests** against the shim — `open` calls AVPlay `open/prepare/play` with the correct URL; a live `.ts` error triggers a retry with `.m3u8`; `stop` persists position+duration.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: AVPlay player wrapper with TS/HLS fallback`.

---

### Task 8: Live TV — browse, EPG, player zapping

**Files:**
- Create: `js/views/live.js`, `js/views/player-live.js`, `css/browse.css`
- Test: `test/live.test.js`

**Interfaces:**
- Consumes: `api.categories('live')`, `api.streams('live',cat)`, `api.shortEpg`, `player`, `store` favourites/history.
- Produces: views `live`, `player-live`. Channel rows with logos + Now/Next; Menu/hold-OK toggles favourite; in player ▲▼/CH± change channel, OK/◀▶ shows info overlay.

- [ ] **Step 1: Write failing tests** — category select loads channels; Now/Next rendered from `shortEpg`; ▲▼ advances channel index and re-opens player; favourite toggle persists.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: Live TV browse, EPG, and zapping`.

---

### Task 9: Movies + Series — browse, detail, resume, auto-next

**Files:**
- Create: `js/views/movies.js`, `js/views/series.js`, `js/views/movie-detail.js`, `js/views/series-detail.js`, `js/views/player-vod.js`
- Test: `test/vod.test.js`

**Interfaces:**
- Consumes: `api.streams('movie'/'series',cat)`, `api.vodInfo`, `api.seriesInfo`, `player`, `store` positions.
- Produces: poster grids; movie detail (plot/rating/resume); series detail (seasons→episodes, resume markers); `player-vod` with OK controls, ◀▶ −10s/+30s, resume prompt, auto-advance to next episode.

- [ ] **Step 1: Write failing tests** — movie grid from `streams`; resume prompt appears when `position>0`; series detail lists seasons/episodes from `seriesInfo`; on episode end the next episode opens.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: Movies and Series browse, detail, resume, auto-next`.

---

### Task 10: Home screen

**Files:**
- Create: `js/views/home.js`, `js/home-rows.js`, `css/home.css`
- Test: `test/home.test.js`

**Interfaces:**
- Consumes: `store` (history, favourites, home toggles), `api.streams` (recently added via `added`/`last_modified` sort).
- Produces: view `home` with hero + rows Continue Watching, Recent Channels, Favourite Live/Movies/Series, Recently Added Movies/Series. `top_movies`/`top_series` rows present but hidden (no TMDB key).

- [ ] **Step 1: Write failing tests** — only enabled rows render; Continue Watching built from positions>0; Recently Added sorted by `added` desc; Top 10 rows hidden when no key.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: Apple-TV home screen with toggleable rows`.

---

### Task 11: Favourites management + Search

**Files:**
- Create: `js/views/search.js`, `js/favourites.js`, `css/search.css`
- Test: `test/search.test.js`

**Interfaces:**
- Consumes: `store` favourites/favcats, `api.streams` (cached per section).
- Produces: view `search` (per section, incremental filter over loaded lists); favourite + favourite-category toggles reused across Live/Movies/Series.

- [ ] **Step 1: Write failing tests** — search filters the current section case-insensitively; favourite-category pins to the top of the category rail.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: per-section search and favourite management`.

---

### Task 12: Settings

**Files:**
- Create: `js/views/settings.js`, `css/settings.css`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes/produces: `store` setters for stream format (TS/HLS), user-agent, subtitles (size/colour/bg/opacity/language), audio language, preview mode, refresh interval, home-row customise, theme, and account management (reuse Task 6).

- [ ] **Step 1: Write failing tests** — changing stream format persists and the live player uses it; home-row toggle flips `homeShows`; user-agent change flows into the next `api` request header.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: settings screen`.

---

### Task 13: Extras — Ambient, QR add-from-phone (Top 10/Trailers inert)

**Files:**
- Create: `js/views/ambient.js`, `js/views/phonelink.js`, `js/keys.js` (key-presence gate)
- Test: `test/extras.test.js`

**Interfaces:**
- Consumes: `store` artwork sources (Xtream posters/backdrops), a QR generator (bundle a small QR lib or draw it), `js/keys.js` (`hasTmdb()`, `hasYoutube()` — false in v1).
- Produces: `ambient` screensaver (cycles Xtream artwork, no TMDB); `phonelink` (shows a QR to add the account from a phone). Top 10 and Trailers code paths guarded by `keys.hasTmdb()/hasYoutube()` → off.

- [ ] **Step 1: Write failing tests** — Ambient cycles through provided artwork and needs no key; Top 10/Trailers helpers return disabled when keys absent; QR renders for an account payload.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** `feat: Ambient and QR add-from-phone; key-gated Top 10/Trailers`.

---

### Task 14: CI build + signed `.wgt` release

**Files:**
- Create: `.github/workflows/build.yml`, `README.md`
- Test: manual CI run (documented), plus `test/config.test.js` asserting `config.xml` validity.

**Interfaces:**
- Produces: a GitHub Actions workflow that installs the Tizen CLI, generates a self-signed author+distributor cert, `tizen build-web` + `tizen package -t wgt -s <cert>`, and attaches `YMPlayer.wgt` to a release so `…/releases/latest/download/YMPlayer.wgt` is permanent. README mirrors the APK repo's instructions, adapted for Vetro/`sdb` network install (no USB).

- [ ] **Step 1: Write failing test** — `config.xml` parses and declares `required_version` 7.0 and the internet/tvinputdevice privileges.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** workflow + README; verify the `.wgt` artifact name and release link shape.
- [ ] **Step 4: Run config test, verify pass.**
- [ ] **Step 5: Commit** `ci: build and sign .wgt, publish release`.

---

## Self-Review

1. **Spec coverage:** §2 API → Task 3; §2 data model → Task 2; §4 screens → Tasks 6,8,9,10,11,12,13; §5 player → Task 7; §6 nav → Task 4; §7 build/sign → Task 14; §7 no-keys → Tasks 10,13; §8 deployment → Task 14 README (on-device step is the user's, per spec §8); §9 testing limits → AVPlay shim in Task 7. Covered.
2. **Step scan:** steps carry signatures + test intents, not bodies; no "handle edge cases" lines.
3. **Type consistency:** `item.key()`, `type` vocabulary (`live|movie|series|episode`), `playUrl(item, liveFormat)`, store method names consistent across Tasks 2,3,7,8,9.
4. **Review Focus:** M3U paste (T3), error-object→[] (T3), TS/HLS fallback (T7/T8), base64 EPG (T3), namespace isolation (T2) — each pinned to a task's tests.
5. **Proportion:** plan is far shorter than the ~11.6k-line source; step bodies omitted in favour of signatures and test names.
