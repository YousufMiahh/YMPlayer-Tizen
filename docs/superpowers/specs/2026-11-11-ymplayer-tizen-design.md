# YM Player for Tizen — Design Spec

**Date:** 2026-11-11
**Author:** Yousuf Miah (with Claude)
**Status:** Approved design → ready for implementation planning
**Target device:** Samsung S90D (QD-OLED, 2024), Tizen 9, rooted via Vetro, running APL-Launcher as home.

---

## 1. Purpose

Reimplement the user's existing Fire TV / Android TV app **YM Player** (repo `YousufMiahh/XtreamPlayer`, ~11,600 lines of native Java) as a **Tizen web app** that installs onto the rooted S90D and appears as a tile on the APL-Launcher home screen. It is a self-contained Xtream Codes IPTV player, remote-control first, Apple-TV styled.

This is a **reimplementation, not a code port**: Tizen apps are web apps (HTML/CSS/JS), so none of the Java transfers directly. What carries over is the **theme**, the **Xtream API contract**, the **UX/screen structure**, and the **data model**.

### Goals
- Full feature parity with the Android app in v1 (Live TV + EPG, Movies, Series, Favourites, Search, Settings, and the Extras: Top 10, Ambient, Trailers, QR add-from-phone).
- Identical look: dark `#0B0B0F` background, iOS-blue `#0A84FF` accent, Inter font family.
- Install over the network (no USB), via Vetro, as a signed `.wgt`.
- Its own GitHub repo (`YMPlayer-Tizen`) with a GitHub Actions build producing a latest-release `.wgt` link, mirroring the APK workflow.

### Non-goals
- Replacing APL-Launcher (APL is the launcher; this is an app on it).
- Rooting / debloating the TV (handled separately by Vetro/APL; out of scope here).
- Changing the Android/Mac/phone versions.

---

## 2. Source-app reference (contract carried over)

### Xtream API (`XtreamApi.java`)
- **Server normalise:** trim, prepend `http://` if no scheme, strip query and any `/player_api.php`, `/get.php`, `/xmltv.php`, `/panel_api.php` tail and trailing slashes → `http(s)://host:port`. A pasted `get.php?username=…&password=…` M3U link must be accepted and parsed into server/user/pass.
- **Login:** `GET {base}/player_api.php?username=&password=` → JSON; must start with `{`; read `user_info` for status, `exp_date` (unix s, or "never"), `active_cons`/`max_connections`.
- **Categories:** action `get_live_categories` | `get_vod_categories` | `get_series_categories` → `[{category_id, category_name}]`.
- **Streams:** action `get_live_streams` | `get_vod_streams` | `get_series` with optional `&category_id=`. Fields kept: `stream_id`/`series_id`, `name`, `stream_icon`/`cover`, `num`, `container_extension`, `rating`, `genre`, `plot`, `category_id`, `added`/`last_modified`. (Large lists streamed/parsed incrementally for memory — JS equivalent: fetch + incremental JSON handling for big VOD sets.)
- **Detail:** `get_series_info&series_id=`, `get_vod_info&vod_id=`.
- **EPG:** `get_short_epg&stream_id=&limit=` → `epg_listings[]` with `start_timestamp`, `stop_timestamp`, `title` (base64), `description` (base64). Drop entries already ended. Now/Next = first two.
- **Playback URLs:**
  - Live: `{base}/live/{user}/{pass}/{id}.{ts|m3u8}`
  - Movie: `{base}/movie/{user}/{pass}/{id}.{ext}` (ext from `container_extension`, default `mp4`)
  - Series episode: `{base}/series/{user}/{pass}/{id}.{ext}`
- **User-agent** override sent on every request (default `XtreamPlayer/1.0 (…)`; configurable per account for fussy providers).

### Data model (`Prefs.java` → `localStorage`)
Keep the same namespacing: a per-account key prefix (`""` for the first/legacy account, `"{id}_"` otherwise) so each provider's IDs stay separate.
- **Accounts:** array of `{id, name, server, user, pass, ua, ok}` + `current` id. Multi-account with add/remove/switch. `label()` = name, else `user @ host`.
- **Global settings:** `live_format` (`ts`|`m3u8`), subtitle size/colour/background/opacity/language, audio language, `auto_recover`, `preview` mode (off / muted / sound), `refresh_hours` (0 = every launch, -1 = manual), `dark`.
- **Per-account:** `fav_{type}` (array of Items), `favcat_{type}`, `pos_{key}` + `dur_{key}` (resume ms), `hist_live` / `hist_vod` (≤40, newest first), `lib_time`, audio-delay keys.
- **Home rows (toggles, all on by default):** `continue`, `recent`, `fav_live`, `fav_movie`, `fav_series`, `top_movies`, `top_series`, `new_movies`, `new_series` → "Continue Watching", "Recent Channels", "Favourite Channels/Movies/Series", "Top 10 Movies/Series in the UK", "Recently Added Movies/Series".
- **Item key:** `{type}:{id}` (favourites, positions, history all keyed this way).

---

## 3. Architecture

Single-page vanilla-JS app, no framework. Structure:

- `index.html` + `config.xml` (Tizen manifest: privileges for internet, fullscreen, app launch).
- **Router/shell** — swaps view modules into one root, keeps a view stack for Back.
- **View modules** (one per screen, see §4), each exposing `mount(params)` / `unmount()` / `onKey(e)`.
- **`api.js`** — Xtream client (the §2 contract).
- **`store.js`** — `localStorage`-backed Prefs port with the same key scheme.
- **`player.js`** — AVPlay wrapper (see §5).
- **`nav.js`** — D-pad spatial focus engine (see §6).
- **`images.js`** — lazy image loader with a placeholder + failure fallback (ports `ImageLoader`).
- **`theme.css`** — tokens for the YM Player look.

Units are isolated: a view talks to `api`/`store`/`player`/`nav` through their public functions only, so each screen can be built and tested on its own.

---

## 4. Screens

Mirrors the Android activities:

1. **Splash** — logo, kicks off session restore / library refresh.
2. **Login / Setup** — multi-account list, add/edit/remove, server+user+pass or pasted M3U link, user-agent field, account status line (expiry, connections). Setup shows the live counts as lists download.
3. **Home** — hero + the toggleable rows from §2. Apple-TV layout.
4. **Browse** — per section (Live / Movies / Series): category rail + grid (channel rows with logos & Now/Next for Live; poster grid for Movies/Series). Menu / hold-OK = toggle favourite; favourite categories pinned.
5. **Series detail** — seasons → episodes, resume markers, play-next.
6. **Movie detail** — poster, plot, rating, resume.
7. **Player** —
   - Live: ▲▼ / CH± zapping, OK / ◀▶ shows channel info + Now/Next overlay.
   - VOD/Series: OK shows controls, ◀▶ = −10s / +30s, resume prompt, auto-advance to next episode, save position/duration on exit.
8. **Search** — per section, incremental.
9. **Settings** — stream format (TS/HLS), user-agent, subtitles, audio language, preview mode, refresh interval, home-row customise, theme, account management.
10. **Extras** — Top 10 (trending, matched to library), Ambient screensaver, Trailers, QR "add from phone".

---

## 5. Player (AVPlay) — the one real divergence

Tizen **AVPlay** plays `.ts` and HLS natively, so the Android ExoPlayer + VLC dual engine and the "VLC for Live TV" rule **collapse into a single engine**. The Android `engine`/VLC-vs-Exo preferences are dropped on Tizen.

Keep:
- **TS ↔ HLS auto-fallback** — if the first live URL errors, retry the other format automatically; honour `auto_recover`.
- **User-agent** override on the stream request where AVPlay allows custom headers (`prepare` with streaming properties); document the limit if a provider needs a header AVPlay won't send.
- **Resume** positions + duration via the same store keys.
- **Audio sync / subtitle** settings where AVPlay exposes them; note any AVPlay gaps vs VLC.

**Known risk:** AVPlay is shallower than VLC on exotic codecs / malformed timestamps. Streams VLC previously rescued may not play. Which ones, if any, is only knowable once it runs on the panel.

---

## 6. D-pad navigation

Custom spatial-focus engine: arrow keys move focus to the nearest focusable in that direction; OK activates; Back pops the view stack (and in grids, jumps to categories first, then exits — matching the Android Back behaviour); ▲▼ / CH± map to channel change in the live player; the TV remote's Menu (or hold-OK) toggles favourite. Registers the Tizen TV remote keys via `tizen.tvinputdevice`.

---

## 7. Build & packaging

- **Repo:** `YMPlayer-Tizen` (new, public — so the release `.wgt` link is fetchable, same reasoning as the APK repo).
- **GitHub Actions** (`.github/workflows/build.yml`): install Tizen CLI (tizen-studio CLI / `tizen` + `sdb`), build and sign the `.wgt`, attach it to a release so `…/releases/latest/download/YMPlayer.wgt` is a permanent link.
- **Signing:** a self-signed Tizen author+distributor certificate generated in CI. Because the S90D is **rooted** (via Vetro/APL), a self-signed `.wgt` installs without a Samsung partner certificate.
- **External API keys (optional, like APL):** Top 10 / trending and artwork need a TMDB key; Trailers need a YouTube key. Without them, those Extra rows degrade gracefully (hidden / disabled), exactly as the "Recently Added" and library rows still work from Xtream alone. Keys supplied as GitHub Actions secrets at build time.

---

## 8. Deployment — no USB

- Primary: install the `.wgt` through **Vetro** over the LAN (Vetro signs + installs `.wgt`; the same mechanism APL uses). Appears as a tile on APL home.
- Alternative: `sdb connect {TV_IP}` → `tizen install` over the network.
- **Constraint:** this cloud workspace cannot reach the TV's LAN. The install runs on the user's network — their own machine, or their computer bridged to the chat (if on the same LAN with the Tizen CLI). Build/sign happen in CI or here; the push-to-TV step is the user's side.

---

## 9. Testing — scope and limits

- **In-workspace (agents):** run the app in a headless / Claude browser against a real or mock Xtream server and verify login, the full API surface, every screen, D-pad navigation, favourites/resume/history/search logic, and `.wgt` packaging + signing. Automated.
- **Off-device gap:** **AVPlay playback cannot be verified here** — it is a Tizen-only API with no desktop equivalent. A thin shim stands in for AVPlay in browser tests (asserts correct URL + calls), but real decode/playback is confirmed only on the S90D (by the user, or driven through the bridged machine). No "playback works" claim is made until confirmed on the panel.

---

## 10. Phasing

v1 ships full parity. Implementation order (core-first, de-risking the engine early):
1. Shell + router + nav engine + theme + store.
2. `api.js` + Login/Setup + account status.
3. Player (AVPlay) with one hardcoded stream — prove playback shape early.
4. Live TV + EPG + zapping.
5. Movies + Series + detail + resume + auto-next.
6. Home screen with all rows.
7. Favourites + favourite categories + Search + Settings.
8. Extras: Top 10, Ambient, Trailers, QR add-from-phone.
9. CI build/sign + release `.wgt`.

Nothing is pushed to GitHub until the user says "push".

---

## 11. Open items / risks

- **AVPlay codec coverage** vs VLC (see §5) — resolved only on-device.
- **User-agent header** support in AVPlay for providers that demand it — verify early; document if unsupported.
- **Top 10 / Trailers** depend on external keys; confirm the user wants these wired (and will supply TMDB/YouTube keys) or accept them degrading gracefully.
- **Vetro `.wgt` install path** on this exact firmware — confirm during deployment; `sdb` is the fallback.
