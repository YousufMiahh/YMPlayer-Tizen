# Phase 4 report: Browse (Live TV, Movies, Series)

Branch `android-parity`. I used Android as the reference throughout: BrowseActivity, Adapters, Filters, FilterSettings, Glider, Coach, Prefs and Open. The TV-guide grid is Phase 5. I left a marked hook for it (see below).

## What was built

| Area | Files | Android source |
|---|---|---|
| **Category list.** Order: Search, Favourite Channels/Movies/Series, Recent Channels or Continue Watching, All Channels or All. Then come favourite categories in the order you favourited them, with a trailing ♥, then the provider's other categories with hidden ones and hidden countries removed. There are no counts, because Android's header and count are `GONE`. | `js/browse.js` (`buildCategoryList`), `js/views/browse.js` | BrowseActivity.buildCategoryList, loadCategories |
| **Arrival.** The list is selected on Search, and focus goes there unless you arrived by hovering the tab. The category shown is Favourites, else Recent/Continue, else the first provider category, else All. Nothing is marked until you pick one. | `js/browse.js` (`startIndex`), `js/views/browse.js` | loadCategories, `hideActive` |
| **Dwell.** A category opens 350 ms after the selection stops. Search waits for OK. A category is marked (SURFACE_HI) once picked, but never while the bar has focus. While the bar has focus, the list also returns to the top. | `js/views/browse.js` | openSelectedCategory, markPicked, global focus listener |
| **Gliding highlight** on the category list and the channel list. It stays put under a dialog: `glider.freeze()` and `.keep-focus`. The hint "Hold OK  Favourite or hide" shows while the categories have focus, fading in 180 ms. | `js/ui/glider.js`, `css/browse.css` | Glider.java, catHint |
| **Keys**: see the table below. | `js/views/browse.js` | dispatchKeyEvent, onKeyDown, onBackPressed, onItemLongClick |
| **Favourites and hiding.** Hold OK on a category opens a dialog titled with the category name, with "♡  Favourite" or "♥  Remove from favourites", and "Hide". Special entries ignore it. The Menu key hides a category: toast "Hidden: X  (Settings → Hidden Categories to bring it back)", the category is unfavourited, and All opens if it was the open category. Favouriting shows "Added to / Removed from favourite categories — X" and keeps the selection on the moved row. Hold OK or Menu on an item toggles its favourite with Android's toast. In Favourites the list is rebuilt in place and keeps its selection. | `js/views/browse.js` | categoryMenu, hideCategory, reloadCategories, toggleFavCategory, toggleFav |
| **Live channel rows**: number (or position + 1), 72×44u logo box, name, trailing ♥. Now/Next is not in the row. | `js/views/browse.js` (`channelCell`) | Adapters.Channels |
| **Poster grid**: AUTO_FIT columns 178u wide with uniform spacing (5 columns at 1920), 150×225u image, two-line centred 15u title, "♥ " prefix on favourites, focus scale 1.09 with a ring. | `js/views/browse.js` (`posterCell`), `js/ui/vlist.js` | Adapters.Posters / PosterCell, GridView setup |
| **Windowed lists.** Only the rows on screen, plus 3 either side, are in the DOM. The body moves with a transform using ListView's minimal arrow scroll. Selection is index based. Grid ▼ onto a short last row lands on its last cell. A 3000-channel category scrolls as fast as a 20-channel one. | `js/ui/vlist.js` | ListView / GridView |
| **Content.** New content slides in 56u from the direction you moved, over 380 ms. There is a 48u spinner. Empty and error texts are Android's: "Nothing here yet", "No favourites yet\nHold OK on anything to add it.", "Couldn't load this list\n…", "Type the name of a channel/film/series", "No results for "q"". | `js/browse.js`, `js/views/browse.js` | show(), openCategory |
| **Search entry.** Box placeholders are "Search all channels/movies/series". Typing searches after a 300 ms debounce. Search covers the whole section through `Filters.searchItems`, ranked by `Match.rank`, max 300. Enter or the IME's Done key goes to the first result. Back closes the box and returns to the categories. | `js/browse.js` (`search`), `js/views/browse.js` | wireSearch, runSearch, openKeyboard |
| **Special lists**: favourites, `history(true)`, `continueMovies()`, and `continueSeries()` (one entry per series, built from episode history). | `js/store.js` | Prefs.continueMovies / continueSeries |
| **Live info panel.** 400u wide, SURFACE, radius 22, padding 28. A 194u logo/preview box over #24252C, with padding 26 and contain. Name in Bold 26. Then NOW, the title, "HH:mm – HH:mm", a progress bar (min 2 %), a 4-line description, and UP NEXT "HH:mm   title". These load 400 ms after the selection settles. With no listings it shows "No guide information" in TEXT2. The hint reads "▶  TV guide      Hold OK  Favourite". Empty text views keep one line of height, as an empty TextView does. | `js/views/browse.js` (`buildInfo`, `showChannelInfo`, `loadEpgForSelection`) | buildInfoPanel, showChannelInfo, loadEpgForSelection |
| **Live preview.** Starts 450 ms after you pause on a channel. One AVPlay instance: `open → setListener → setDisplayRect(box) → USER_AGENT → prepareAsync → play`. When playing, a rounded see-through hole (an SVG mask) is cut through the backdrop and the panel background, and the logo fades out (250 ms delay, 250 ms). The preview-mode pref: Off never opens; Muted mutes the TV with `tvaudiocontrol` and restores it; With sound leaves audio alone. It stops on the next channel, when focus leaves the list, on an error (silently), and when the app is hidden. It is released on unmount, so it is closed before the full-screen player opens; the player then sets the rect to 0,0,1920,1080. In a browser (the shim), the box keeps the channel artwork. | `js/live-preview.js` | schedulePreview, startPreview, stopPreview, releasePreview, onPause |
| **Coach tours.** Live has 4 tips: Categories, Channels, What's on, The TV guide. Movies/Series have 2: Categories, Pick something. Wording is the non-Fire version. The tour starts 600 ms after the categories load. | `js/browse.js` (`tourSteps`) | BrowseActivity.tour, catTip |
| **Filters** (Filters.java): the tag regex, writing systems, tag names, per-account sets, `categories / items / searchItems`, version and cache, `detectTags`. | `js/filters.js` | Filters.java |
| **FilterSettings.** "Countries & languages to show" has Save, "Unselect all"/"Select all" (stays open) and Cancel, plus the "Looking through your categories…" toast and the no-tags toast. "Hidden categories — untick to show" lists yours first, then the filters'; unticking a filtered category adds it to `show_cat`. It has the "Nothing hidden…" toast and Android's row labels. Both are listed in Settings under "Hide What You Don't Watch", after Playback. The dialog gained multi-choice items. | `js/filter-settings.js`, `js/ui/dialog.js`, `js/views/settings.js` | FilterSettings.java, SettingsActivity |
| **Home Recently Added** now uses `Filters.items`: the newest 300, filtered, then 24. Phase 3's pass-through hook is replaced. | `js/home-rows.js` | HomeActivity.recent |
| **Focus memory.** Coming back from the player or a details screen restores the open category, the list selection and offset, the content selection and offset, the zone, and the search text and results. Top-bar visits now pass a fresh `{}` params object to hold this. | `js/views/browse.js`, `js/ui/topbar.js` | the Activity is kept under the player |

### Keys (Samsung remotes have no ☰ key, so Android's "Hold OK" behaviour applies; the Menu key 10133 acts as ☰ if a remote has it)

| Where | Key | Action |
|---|---|---|
| Categories | ▲ ▼ | Move. ▲ on the top row goes to the current tab. |
| | ▶ / OK | Open the category and move to its first item. On Search, focus goes into the box. ▶ on the category that is already open jumps to item 0. |
| | Hold OK (450 ms) | Favourite / Hide dialog. |
| | Menu | Hide. |
| | Back | Home. |
| Content | ▲ ▼ ◀ ▶ | Move. ◀ from the first column returns to the open category where it sits on screen. ▲ from the top row goes to the search box if shown, otherwise the tab. |
| | OK (on release) | Open details or play. Live plays through the visible list. |
| | Hold OK / Menu | Favourite. |
| | Back | Categories. |
| | Live ▶ | TV guide hook (Phase 5). |
| Search box | ▼ | Results. |
| | Enter / Done | Search now and go to the first result. |
| | Back / Cancel | Categories. |
| Bar | ▼ | Search, the top category. |
| | OK on the current tab | Same as ▼. |

The browse screens handle no number or channel keys; Android doesn't handle them here either. CH+/− belong to the guide (Phase 5).

### Phase 5 hook
- In `js/views/browse.js`, `enterGuide()` is marked `PHASE 5 HOOK`. ▶ from the channel list calls it and currently does nothing.
- The empty `<div class="b-guide" data-phase5="tv-guide" hidden>` sits in the Live stage. `data-mode="list"` on `.browse` is ready for `"guide"`. The panel hint for guide mode is already `B.GUIDE_PANEL_HINT`.
- `onFocusIn` stops the preview when focus leaves the list. It is marked for the "not when going into the guide" exception.

## Audit items closed

- **Audit A §3:**
  - Closed: 8 (reselect → Search), 22 (the filter itself), 30, 31, 32, 33, 34, 35, 36, 37 (everything but the TV guide), 38, 39, 40, 41, 42, 43, 44, 48, 49, 50, 52, 53 (filters re-read on every mount; Settings replaces Browse, so a return is a fresh mount), 27 (Browse tours).
  - 47: the active-row look is done. The "▶ playing" marker is never set by BrowseActivity (`playingId` stays null), so there is none.
  - 45 and 46 are Phase 5.
- **Audit A §4:**
  - Closed: 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 39, 38 (the ▶/◀ rules).
  - 41: unchanged (see below).
- **Audit A §2.4 and §2.5:** everything except the TV guide (GUIDE/FOCUS layouts, EpgGrid, programme details).
- **Audit A §5.2:** fully ported. **§5.7:** done (setDisplayRect, transparent hole, mute, close before full screen).

## What could not be matched, and why

- **Grid row height.** Android's GridView row is as tall as its tallest cell, so a row where every title fits on one line is about 17u shorter. Windowing needs a fixed pitch, so every row takes two title lines.
- **Muted preview.** AVPlay has no per-player volume. Muted mode therefore mutes the TV through `tizen.tvaudiocontrol`, which may show the TV's mute icon, and unmutes when the preview stops (only if the app did the muting). I added the `tv.audio` privilege to config.xml. Verify on a device.
- **Preview hole.** The hole is an SVG mask on `#backdrop` and on the panel background, with `html.preview-on` making the page background transparent. In Chrome I checked it with a stand-in video plane (`live-preview` shot). Check on a TV that Tizen's compositor shows the AVPlay plane through it and that the masks repaint smoothly.
- **Shim and browser.** There is no picture, so the artwork stays and `#av` stays hidden; a desktop browser would draw a plugin placeholder. Every AVPlay call still happens, and the tests check their order.
- **Search IME.** Enter and the Tizen IME "Done" key (65376) submit; "Cancel" (65385) acts as Back. Android's keyboard keeps focus in the box when there are no results, and so does this port. Verify the IME keys on a device.
- **Copied from Android unchanged.** The "Couldn't load categories" text is replaced at once by the start category's own text, as on Android. Removing the last favourite in Favourites leaves an empty list with no text, because Android doesn't update the text there. "Sci-Fi" is detected as a "SCI" tag by Android's regex, and that is kept.
- **Coach placement.** On Live tip 2 the caption overlaps the highlighted list. Coach.java places it the same way when the hole fills the height.
- **Images (audit §4.41).** `<img>` can't send the provider User-Agent. Unchanged.
- **Commit trailer.** As in phases 1–3, the commits use this session's `Claude Opus 5.5` co-author line rather than `Claude Fable 5.2`.

## Screenshots

`node tools/shots/run.mjs live live-cats live-preview live-search live-long live-empty live-catmenu live-hidden live-favcat live-tour live-light movies movies-fav movies-scrolled series filters-countries filters-hidden`

PNGs go to `tools/shots/out/`. The fixtures gained a 3000-channel category, "UK | Every Channel A–Z". It is added last, from its own random stream, so earlier data is unchanged. `live-preview` installs a stand-in `webapis.avplay` that paints a coloured plane at the requested rect, behind the page.

I checked every capture against the Java. Fixes that came out of that:
- `#av` must stay hidden in a browser.
- The highlighted category kept its focused look under the Favourite/Hide dialog.
- The double spaces in the toast collapsed.
- The search box drew a browser clear button.
- Empty panel lines collapsed.

## Tests

`npm test`: **400 passed** in 24 files (was 348).

- New `test/browse.test.js` (40 tests):
  - Category ordering and the special entries; arrival rules; Continue lists; empty texts and tours.
  - Arrival focus and marking; no provider request per category; 350 ms dwell; Search waiting for OK; OK and ▶.
  - ▲ to the tab and ▼ back; marking hidden while in the bar; Back steps.
  - Load and category errors.
  - The Favourite/Hide dialog; Hide by Menu (toast, unfavourite, All); item favourites; the Favourites rebuild; country filters.
  - Grid keys and details; return focus memory; channel and poster cells.
  - Search debounce, Enter and Back; search filters.
  - Info panel timing and fields; No guide information.
  - Preview start timing and call order; stop before next; stop on leaving; closed before the full-screen player.
  - Off and muted modes; the error path and the hole with a "real" player; artwork in the browser.
  - The Phase 5 hook.
- New `test/filters.test.js` (16 tests): tags, writing systems, hide/show logic, items vs searchItems, cache/version, per-account keys and removal, detectTags, Home Recently Added, both FilterSettings dialogs (Save, Unselect/Select all, Cancel, toasts), and the Settings rows.
- New `test/vlist.test.js` (8 tests): windowing with 10 000 rows, far selection, minimal scroll, edges, grid columns and spacing, the short last row, keep/refresh, setSelectionFromTop, and the hole mask.
- Removed the obsolete browse tests: 9 in live.test.js, 2 in vod.test.js, and the favourites-rail helper in search.test.js.
