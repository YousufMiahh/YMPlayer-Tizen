# Phase 5 report: the TV guide (EPG grid)

Branch `android-parity`. Reference: EpgGrid.java, Guide.java, BrowseActivity.java (applyMode, enterGuide, exitGuide, guideListener, showProgrammeDetails, setPanelHint, the preview rules), XtreamApi.epg.

## What was built

| Area | Files | Android source |
|---|---|---|
| **Listings.** `get_short_epg` with limit 24 for each channel. Up to 3 requests run at once, and each channel is fetched only once. Results are cached for 30 minutes; a failed request is cached as "no listings". `tidy()` drops invalid entries, sorts, removes duplicates and trims overlaps. Base64 decoding and dropping finished programmes come from the existing `api.epg`, so api.js was unchanged. | `js/guide.js` | Guide.java, XtreamApi.epg |
| **Grid.** Header is 44u: "EEE d MMM   HH:mm" at x 12, plus an "HH:mm" label and a 2u SURFACE_HI tick at every half hour (Medium 14 TEXT2). The channel column is 330u: SURFACE_LO cells, SURFACE_HI on the selected row, number at 14, 64×40 logo at 64, name in Medium 17 (SemiBold when selected), ellipsized. The grid starts 8u to the right of the column. Rows use the list's pitch (74u) with a 3u gap and 10u radius. The window is 2 hours, aligned to the half hour. Programme cells are sized by time and clipped to the window edges. Colours: SURFACE for past and future, SURFACE_HI for on now, FOCUS_BG with SemiBold ON_FOCUS when highlighted (only while the guide has focus, or a dialog opened from it). No title when less than 20u is left after 2×12u padding. Gaps stay empty. "Loading…" / "No information" span the window (TEXT3, ON_FOCUS2 when highlighted). The now line is ACCENT, 2u wide, starts at 70 % of the header height, with a 4u dot. A 30 s tick redraws it. | `js/ui/epg-grid.js`, `css/browse.css` | EpgGrid.onDraw |
| **Windowing.** Rows are windowed through `js/ui/vlist.js`, extended with `freeScroll` and `setPitch`. Each row is rebuilt only when its signature changes. With 400 channels, under 20 rows exist in the DOM. Scrolling uses EpgGrid.moveRow, which keeps one row of context above and below, and animates over 200 ms with Decelerate(2). | `js/ui/vlist.js`, `js/ui/epg-grid.js` | EpgGrid.moveRow / animateScroll |
| **Lazy loading.** Listings are requested for rows from 2 above the first visible row to 4 below the last. Requests go out when the guide opens and whenever the first visible row changes. | `js/ui/epg-grid.js` | requestListings |
| **Navigation.** ▼ / CH−: next channel. ▲ / CH+: previous channel; on row 0 it goes into the top bar. The cursor is a time, so ▲▼ land on whatever is on at that time. ▶: start of the next programme +1 s (+30 min in a gap), up to 24 h ahead; the window moves by half hours to stay 5 min clear of its edge. ◀: the previous programme, never before now; on what's on now it leaves the guide. OK tap (on key-up) watches the channel, with the whole list as the queue. Hold OK (450 ms), Menu or Info opens the details. Back returns to the channel list on the same channel, at the same position on screen. | `js/ui/epg-grid.js`, `js/views/browse.js` | EpgGrid.onKeyDown/onKeyUp, onBackPressed |
| **Layout change.** The categories fold off to the left and fade (220 ms). The list fades. The info panel becomes a strip 38 % of the screen height, with a 16:9 preview box and a text column 32u to its right. The guide glides from where the list was, fading in over 320 ms. The bottom hint line reads "OK  Watch        Hold OK  Full programme details        ▲▼  Channels        ◀ ▶  Programmes        Back  Channel list". The panel hint changes to the guide wording. Bounds glide over 420 ms with Decelerate(2.2). Exiting reverses all of this. | `js/views/browse.js` (`stageLayout`, `applyMode`), `css/browse.css` | applyMode, fade, place |
| **Info panel follows the highlight.** Shows the name and the title, or "Loading guide…" / "No guide information". The time shows "HH:mm – HH:mm" with "   ·   later" for programmes not on now. A progress bar appears when the programme is on now. Also the description and the next programme. On a new channel: ambient tint, and the preview restarts unless that channel is already playing. The preview keeps playing into the guide, and the AVPlay rect and hole follow the box during the glide. | `js/views/browse.js`, `js/live-preview.js` (`relayout`) | guideListener.onHighlight, content focus listener |
| **Details dialog.** Title is the programme title (or the channel name). The message is: channel, then time range plus "   ·   On now, N min left" or "   ·   Starts in N min / H hr M min", then the description. With no programme it says "No guide information for this time.". Buttons are "Close" and "Watch {channel}". | `js/browse.js` (`programmeDetails`) | showProgrammeDetails |
| **Focus memory.** Coming back from the player reopens the guide, with no animation, on the same channel, row and time. | `js/views/browse.js` | the Activity is kept |
| **Coach.** Coach.java has no guide-specific card. The Live tour's 4th tip, "The TV guide", already existed from phase 4. | — | BrowseActivity.tour |

## Deliberate deviations (Android bugs that strand the user)
- **Selected row hidden.** `setChannels` keeps the list's first visible row. The guide is only about 3 rows tall, so a channel low in the list would sit below the guide. Here it is scrolled into view using the moveRow rule.
- **"Loading guide…" stuck.** Android's `onHighlight` dedupe ignores listings arriving when nothing is under the cursor, so "Loading guide…" stays. The loaded state is now part of the comparison.
- **▼ from the top bar.** In the guide, ▼ from the top bar returns to the guide. Android asks the faded categories, which can't take focus, so nothing happens.
- **OK on a future programme.** The brief said OK on a future programme opens details. Android always watches on an OK tap, and details come from Hold OK, Menu or Info. Android's behaviour was kept.

## Copied as Android does it
- Finished programmes are removed at fetch time, so a row can start after the window's left edge.
- A programme that ends inside the window may draw as a sliver.
- In the guide layout, the info text column cuts off "UP NEXT" and the panel hint.
- Highlighting moves into gaps.

## Not verifiable here
- On a TV: how smooth the bounds glide is (layout per frame), and `setDisplayRect` being called every frame during the glide.
- The Info key (457) is now registered; check it on a device.
- Commits use this session's `Claude Opus 5.5` trailer, as in phases 1–4.

## Screenshots
`node tools/shots/run.mjs guide guide-future guide-gap guide-details guide-time guide-down guide-nodata guide-preview guide-light` → `tools/shots/out/`.

The fixture EPG now has:
- programmes from 10 min to 2 h long;
- 20-min gaps;
- an overlapping duplicate;
- a finished programme;
- channels with no listings (1051, and ids where id % 23 == 5).

From checking the shots I fixed two things: `.b-time` and the dialog message had collapsed the "   ·   " spacing.

## Tests
`npm test`: **429 passed** in 25 files (was 400). New `test/guide.test.js` (29 tests) covers:
- cell maths and clipping;
- `showsTitle`;
- the stage layout;
- ▶/◀ paging, the window shift, the 24 h limit and exit;
- moveRow and the listing range;
- tidy, the limit, the concurrency of 3, de-duplication, the 30-min cache and failures;
- entering (morph, focus, hints, panel, header, now line);
- cell states, Loading and No information;
- time-aligned ▲▼ and CH±, and ▲ into the bar and back;
- OK tap vs Hold OK and Menu, and the dialog's text and buttons;
- Back to the list;
- 400-channel windowing with lazy loading and the cache;
- the 30 s tick;
- restoring after the player;
- the preview carrying over into the guide.

I removed the phase-4 hook test.
