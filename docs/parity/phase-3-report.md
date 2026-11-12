# Phase 3 report: Home

Branch `android-parity`. Android (HomeActivity, Cards, Open, Top10, Match, Coach, Prefs, PlayerActivity.savePosition) was the reference throughout.

## What was built

| Area | Files | Android source |
|---|---|---|
| Row model: order, titles, shapes, sources, limits. Local: Continue Watching (LANDSCAPE), Recent Channels (CHANNEL, 20), Favourite Channels / Movies / Series. Remote: Top 10 Movies / Series on Netflix UK, Recently Added Movies / Series (newest 300 → filter hook → 24). Every row needs its Settings toggle and must be non-empty | `js/home-rows.js` | HomeActivity.buildLocalRows / buildRemoteRows / recent |
| Continue Watching cards: progress pos/dur (min 2 %), `"<N> left"` / `"<series>  ·  <N> left"` (SeriesActivity.fmt, joinNonEmpty), series art for an episode with none of its own, title hint "Hold OK to remove from list" | `js/home-rows.js`, `js/views/home.js` | Cards.shelf / titleWithMenuHint |
| Card routing (Open.item): movie → details (Continue Watching too), series → series screen, episode → player at its resume point (> 10 s) with a one-item queue, live → player with the Recent list if the channel is in it (the whole history, not the 20 shown), otherwise Favourite Channels, otherwise just that channel | `js/home-rows.js` | Open.item, HomeActivity.pick, PlayerActivity.play |
| Hold OK (450 ms, decided on release) and the Menu key: Continue Watching → "Remove from Continue Watching?", item name / "Series · Episode", Remove / Cancel with Cancel focused, Remove clears the resume point. Other rows → toggle favourite (episodes ignored), toast "Added to Favourites — X" / "Removed from Favourites — X". Rows rebuild and focus stays on the same shelf and index, or moves to the shelf that took its place | `js/views/home.js` | HomeActivity.favMenu / removeMenu / refreshKeepingPlace, Open.toggleFav |
| Home screen: one vertical scroller that holds the top bar (the bar scrolls away as on Android), local rows built at once, remote rows async, empty text (welcome / first run), focus on the first card (the Home tab when there are no cards), backdrop tint from the focused card's art (the series art for an episode), Android's minimal ScrollView / HorizontalScrollView moves (just enough to show the focused card, 250 ms viscous-fluid, jumps when keys come faster) | `js/views/home.js`, `css/home.css`, `js/nav.js` (`data-own-scroll`) | HomeActivity, Cards.shelf, ScrollView.computeScrollDeltaToGetChildRectOnScreen |
| Library: startLibrary (first run downloads once with the "getting ready" text; otherwise saved → preload → refreshIfDue), `Repo.onUpdated` reloads Recently Added and Top 10 | `js/views/home.js` | HomeActivity.startLibrary / loadNewArrivals |
| Returning to Home: rows rebuild (history and favourites may have changed). Focus goes to the first card if it was in a local row, the same card if it was in a remote row, and the Home tab if it was in the bar (TopBar.onHomeResumed). Loaded rows, Top 10 signature and scroll position are kept per account between visits, because the router remounts Home where Android keeps the Activity. Another account starts afresh | `js/views/home.js` | HomeActivity.onResume, TopBar.onHomeResumed |
| Netflix UK Top 10, no key: `all-weeks-countries.tsv` streamed (`fetch` body reader + `TextDecoder`, line by line, non-GB lines skipped without splitting), latest UK week, films vs TV, rank order. Cache in localStorage `netflix_top10_uk` (week, checked, etag, lastModified, films, tv), conditional GET, due at most hourly and only from Sunday + 9 days, failure keeps the old copy and retries in ~10 min, no-UK-rows keeps the old copy, one job at a time. Matching: provider tags / `(…)` / `[…]` / `: season…` stripped, squash, newest copy wins, Netflix order, misses dropped, in 2000-item slices so the remote stays responsive. Checked on mount and hourly while Home is on screen (paused when the app is hidden); rows rebuild only when the signature changes | `js/top10.js`, `js/views/home.js` | Top10.java, HomeActivity.loadTop10 / top10Tick / sig |
| Match / Item text helpers (squash, fold, compact, words, Match.score/rank/tagLength) | `js/match.js` | Item.java, Match.java |
| Coach: "Welcome to YM Player" offer once, 1.5 s after Home opens ("Show me" / "No thanks"). Overlay: dim 85 %, rounded hole with a white ring morphing over 380 ms, caption card (TIP n OF m, title, body, "OK  Next      Back  Skip tour" / "OK  Done") placed below/above/beside, OK/▶ next, Back skips, once per screen. Home's three tips with the non-Fire wording. `restart()` is ready for Settings → Show Tutorial | `js/ui/coach.js`, `css/ui.css` | Coach.java, HomeActivity.homeTour |
| Resume points follow PlayerActivity.savePosition: within the last minute = watched (off Continue Watching), under 10 s not kept | `js/player.js` | PlayerActivity.savePosition |
| TMDB gate removed: `keys.hasTmdb` is gone, Settings lists both Top 10 toggles, HOME_NAMES use Android's "Top 10 Movies in the UK" / "Top 10 Series in the UK" | `js/keys.js`, `js/views/settings.js`, `js/store.js` | Prefs.HOME_NAMES |
| `initials()` strips punctuation first, like Cards.initials | `js/ui/widgets.js` | Cards.initials |

`config.xml` needed no change: `<access origin="*" subdomains="true"/>` and the CSP `default-src … https:` already allow `https://www.netflix.com`.

## Audit items closed

- Audit A §3: 12, 13, 14, 15, 16, 17, 18, 20, 21, 23, 24, 25, 26, 51; 22 (the newest-300 → 24 rule; the filter itself is a hook, see below); 27 (the coach system and Home's tour); 56 (ranking ported in `js/match.js`, not yet wired into Search).
- Audit A §4: 11, 12, 13, 14, 15, 16, 40.
- Audit A §2.3 Home: everything except the crash notice and the update check (below).

## What could not be matched, and why

- **Hidden categories / countries in Recently Added.** Android runs `Filters.items` over the newest 300. Filters.java isn't ported yet (audit A 5.2, Browse/Settings phases), so `home-rows.setFilter()` is a hook that keeps everything until it is.
- **No video or artwork preview on Home.** HomeActivity has none (the live preview is BrowseActivity's), so Home doesn't touch AVPlay or the preview-mode setting.
- **NextUpCard** belongs to the player (the "Next Episode" countdown). Android's Continue Watching has no separate next-up logic: it is VOD history with a resume point. An episode finished in the player drops off through the savePosition rule, which is now ported. The countdown card itself comes with the Player phase.
- **Crash notice.** A web app doesn't close when a script fails, so "closed unexpectedly last time" would be untrue. Not ported. The VLC variant doesn't apply.
- **Update check (GitHub)** doesn't apply on Tizen (store / sideload installs).
- **Focus after a remote row reloads in the background**, and on return from a remote card. Android rebuilds the remote rows on resume and its focus then depends on the framework. Tizen puts focus back on the same card, as the brief asks. When focus is in a remote row and that row reloads while Home is on screen, focus jumps to the first card, exactly as HomeActivity does.
- **First-run text vs Top 10.** On Android, a Top 10 result arriving during the first download can replace "Getting your channels…" with the welcome text (a race). Tizen keeps the first-run text until the download finishes.
- **Scrolling.** Android's ScrollView uses the card's unscaled bounds, so a focused card at the screen edge is cut by its 1.08 scale (about 15 px). Tizen does the same on purpose. The top bar scrolls with the rows; when you come back up, the Home tab sits flush at the top edge, as on Android.
- **Coach ring.** Android strokes the ring centred on the hole's edge. Tizen uses an outline offset by half its width, which looks the same.
- **Dialog default focus** for the coach offer is the first button ("No thanks"). This is the phase 1 dialog's rule, and it matches AlertDialog's button order on TV.
- **Netflix on a real TV (verify on device).** No browser can set the Android `User-Agent`. Tizen's runtime skips CORS for `<access>` origins, so neither the missing CORS headers nor the conditional-GET headers should matter there. In a plain browser, ETag / Last-Modified would only be readable if Netflix exposed them, and the app would then just download the file in full. The file is several MB; it is read as a stream and only GB lines are split.

## Screenshots

`node tools/shots/run.mjs home home-cw home-mid home-top10 home-bottom home-remove home-fav home-return home-empty home-coach-offer home-tour home-light home-bar` writes `tools/shots/out/<name>.png`. The harness never reaches the internet: `www.netflix.com/tudum/top10/data/all-weeks-countries.tsv` is served from `fixtures.top10Tsv()` (4 countries × 3 weeks; the latest UK week names library titles plus two it doesn't have), and every other outside request is refused. The mock server can answer an action with a fixed body (`{ body: [] }`), used for the empty account. Seeds now include an episode in Continue Watching and mark the coach as asked, except on the coach screens.

I checked every capture against the Java. Two fixes came out of that: the `"  ·  "` separators collapsed to single spaces (card text is now `white-space: pre`), and the Continue Watching card lost its focused look under the remove dialog (it now keeps it, as the Android view stays focused beneath the dialog window).

## Tests

`npm test`: **348 passed** in 21 files (was 302).
- `test/home.test.js`, rewritten (42 tests): row order, titles, shapes and toggles; limits (20, 300 → 24, filter hook); Continue Watching progress, "left" text, episode subtitle and art, initials; routing for every card type, including the live queue choice and the resume threshold; short OK opens on release; Hold OK favourite toggle with toast and focus kept; Menu on a remote card; focus to the replacing shelf; the remove dialog's texts, focus, Remove and Cancel; welcome state with focus on the Home tab; focus memory from local, remote and the bar; rows rebuild on return; account change; ScrollView delta maths; Top 10 rows, failure, hourly signature compare, toggles; first-run and library refresh.
- `test/top10.test.js` (19): parsing (latest UK week, films/TV, rank order, chunked CRLF stream, name-only layout, bad ranks, errors), `due`, refresh (streamed download and cache, conditional GET / 304, failure retry in 10 min, offline with no cache, not due = no fetch, no UK rows), the single worker, `key`, `match` / `matchAsync`, plus squash / fold / tag / ranking from `js/match.js`.
- `test/coach.test.js` (5): offer once, Show me / No thanks, 900 ms delay, tip counter and hints, once per screen, Back, steps left out when their target isn't on screen.
- Updated: player (savePosition rule), settings (both Top 10 toggles, Android names), extras (no TMDB gate). `test/setup.js` makes Netflix unreachable in every test and resets the Home and coach state.

Commit trailer: as in phases 1 and 2, the commits use this session's `Claude Opus 5.5` co-author line rather than `Claude Fable 5.2`.
