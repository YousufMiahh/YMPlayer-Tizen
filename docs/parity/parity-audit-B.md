# Parity audit B: playback, detail screens, guide, search, settings, login

Android (source of truth): `XtreamPlayer/app/src/main/java/com/xtreamplayer/tv/` (paths below are relative to it).
Tizen: `/home/claude/YMPlayer-Tizen/` (paths relative to it).

**Unit conversion (read this first).** Android sizes are design units: `Ui.unit = min(w/1920, h/1080) * 1.4` (Ui.java:103-110). On a 1920x1080 Tizen page, **1 Android unit = 1.4 CSS px**, for both `dp()` and `sp()` text sizes. Example: VOD title `title(…, 34)` = 47.6px. Every Android number below is in Android units. Multiply by 1.4 for CSS.

**Shared design tokens (Ui.java), dark theme (default):**
- BG `#0A0B12`, BG_TOP `#1C2040`. `screenBackground()` is a vertical gradient BG_TOP→BG→BG (Ui.java:42, 139-141).
- SURFACE `rgba(255,255,255,.10)` (0x1A), SURFACE_HI `.18` (0x2E), SURFACE_LO `.07` (0x12), SHEET `rgba(28,28,34,.95)` (0xF21C1C22).
- TEXT `#FFF`, TEXT2 `rgba(235,235,245,.60)`, TEXT3 `rgba(235,235,245,.30)` (0x4D).
- FOCUS_BG `#FFF`, ON_FOCUS `#0B0B0F`, ON_FOCUS2 `rgba(11,11,15,.70)` (Ui.java:43-46).
- ACCENT `#0A84FF` (used only for the guide's "now" line), RED `#FF453A`. Video-overlay text is always light: W1 `#FFF`, W2 `rgba(235,235,245,.60)`, W3 `rgba(235,235,245,.40)` (Ui.java:29-32).
- Light theme: BG `#F2F2F7`, BG_TOP `#FFF`, SURFACE `rgba(0,0,0,.07)`, SURFACE_HI `.13`, SURFACE_LO `.04`, SHEET `rgba(247,247,250,.96)`, TEXT `#000`, TEXT2 `rgba(60,60,67,.60)`, TEXT3 `rgba(60,60,67,.36)`, FOCUS_BG `#1D1D1F`, ON_FOCUS `#FFF` (Ui.java:47-53).
- Fonts: Inter Regular / Medium / SemiBold / Bold (Ui.java:79-82). `text()` uses Regular with line spacing 1.15 and no font padding. `title()` is Bold with letter-spacing -0.02em (Ui.java:176-199).
- **Focus style:** a "pill". When unfocused it is translucent (or transparent if fill 0). When focused it is solid FOCUS_BG (white) with ON_FOCUS (near-black) text, and it scales up ("lift") over 180 ms with DecelerateInterpolator(1.6) and translationZ 14 (Ui.java:160-174, 252-269). There is **no coloured outline**. On artwork the focus ring is a 4-unit white stroke (Ui.java:131-137).
- `button()`: SemiBold 18, pill fill SURFACE_HI, radius 12, padding 28/14 (h/v), focus lift 1.06 (Ui.java:214-232).
- `input()`: Medium 19, hint TEXT3, pill fill SURFACE, radius 12, padding 20/16/16/16. It turns white with dark text when focused (Ui.java:234-248).
- `scrimBottom()` (over video): bottom-to-top `rgba(0,0,0,.94)` → `.60` → transparent (Ui.java:144-146).
- `pageScrimBottom()` / `scrimLeft()`: page-coloured gradients, BG at α .96/.60/0 (bottom) and .98/.80/0 (left→right) (Ui.java:149-157).
- Remote hint wording: `Ui.hasMenuKey()` is true only on Fire TV (Ui.java:64-70). Elsewhere every hint reads "Hold OK" instead of "☰". **Samsung remotes have no ☰, so Tizen should use the "Hold OK" variants everywhere.**

---

## 1. ANDROID SCREEN-BY-SCREEN SPEC

### 1.1 Player: common frame (PlayerActivity.java)
- Window: FLAG_KEEP_SCREEN_ON (124). Root is black (136). The video host fills the screen and is focusable (137-139).
- Spinner: 64x64, centred, tint W2, shown on engine buffering (141-144, 489-491).
- **Error card** (`errorText`): Regular 20 TEXT, centred, background SHEET radius 22, padding 36, centred on screen, hidden by default (151-157). Text (533-534):
  `Can't play this channel|video\n<engine error name>\n\nOK  Try again      Back  Exit` plus `      ▲▼  Other channel` for live. OK on the error card resets retry state and replays (1027-1031).
- **Status pill** (`statusPill`): Medium 16 TEXT, SHEET background radius 20, padding 20/10, top-right with 40 margins, auto-hides after **2500 ms** (159-165, 718-723). Messages: "Reconnecting…", "Trying Android player…", "Trying VLC player…", "Picture froze — switching to VLC player", "Re-syncing video…", "This sound format needs the VLC player — switching", "VLC couldn't start — using the Android player", "Switched to Android player", "Switched to VLC player", "Audio sync: …", "Audio sync reset", "Switched to VLC to adjust audio sync: …", "Audio sync needs the VLC player, which isn't working on this device".
- Fade animation for all overlays: in 200 ms, out 250 ms (643-656).
- First-run coach card (Coach, 379-383). Live: title "Watching Live TV", body "▲ ▼  Change channel\nOK  Channel list\n◀ ▶  Channel info\n{Hold OK}  Favourite, subtitles & audio\nBack  Leave". VOD: title "Watching films & series", body "OK  Pause / play\n◀  Back 5 seconds     ▶  Forward 10 seconds (press again to go further)\n▼  Scrub: move the knob with ◀ ▶, OK to jump there\n{Hold OK}  Subtitles, audio & favourite\nBack  Leave — your place is saved".
- Tickers: progress/next-card tick every **500 ms** (106-112). Freeze watchdog every **1000 ms** (113-118).
- Resume: plays from the saved position if it is > **10 000 ms**, with Toast "Resuming from H:MM:SS" on the first start (554-560). There is no prompt.
- Position save on stop (593-599): duration stored. If position > duration-60 s the position is cleared (counts as finished). Else if > 10 s it is saved. Live is never saved. History is added on every play (562).
- Time format `fmt`: `H:MM:SS` when ≥ 1 h, otherwise `M:SS` (SeriesActivity.java:390-394).

### 1.2 Player: VOD / episodes overlay
Layout. A full-width bottom sheet with `scrimBottom()` background and padding L/T/R/B **80/160/80/52**. Children top to bottom (177-236):
1. `vodSub`: Medium 18 W2, one line. Episodes only: "{Series name}  ·  Episode {num}" (569-571).
2. `vodTitle`: Bold 34 W1, one line, padding 4 top / 22 bottom.
3. `seekBubble`: SemiBold 18 W1, background `rgba(255,255,255,.20)` radius 16, padding 16/6, centred, margin-bottom 12, INVISIBLE until a seek. Text "+10 sec", "−20 sec", or "+1:30" once ≥ 60 s. The burst accumulates and resets **1200 ms** after the last press (192-200, 1267-1281).
4. Scrub row (hidden unless scrubbing). `scrubTime` is SemiBold 22 W1 with shadow 6 `rgba(0,0,0,.8)`, padding 10/8. It is slid horizontally to sit centred over the knob and clamped to the edges. Text "H:MM:SS   +M:SS" / "−M:SS" (delta shown when ≥ 1 s) (203-215, 1159-1182).
5. `vodBar` (SeekBarView): view height 28, bar thickness 7, side margins -14 so the knob overhangs (217-221). Colours: track `rgba(255,255,255,.25)`, buffered `.40`, played `#FFF`, "ahead" stretch while scrubbing `.60`. The knob is a white circle of radius height/2.6 with a 6-unit shadow. The bar is 1.5x thicker while scrubbing (SeekBarView.java:26-31, 63-86).
6. Times row: left `timeLeft` = position, right `timeRight` = "−" + remaining. Both Medium 17 W2, top padding 12 (223-230, 665-678). If the duration is unknown: the bar is empty, left shows the position and right is blank.
7. Hint: Regular 14 W3, centred, top padding 18:
   `VOD_HINT` = "◀  5 sec      ▶  10 sec      OK  Play / Pause      ▼  Scrub      Hold OK  Subtitles & Audio" (37-38).
   While scrubbing: `SCRUB_HINT` = "◀ ▶  Move (hold to go faster)      OK  Play from here      Back  Cancel" (39).

Centre play/pause icon: 120x120 circle `rgba(0,0,0,.50)` radius 60. It draws a white triangle when paused and two rounded bars when playing. It is visible only while paused (and ready), and while paused the overlay stays up with no auto-hide (247-250, 474-487, 1315-1347).

Auto-hide: **4000 ms** while playing (658-663, 484). When paused it stays.

Next-episode card (NextUpCard.java):
- When it appears: episodes only, there is a next item in the queue, duration ≥ **5 min**, remaining ≤ **30 s** and > 2 s, not dismissed, not scrubbing, and playing (1212-1232).
- When it hides or re-arms: hidden again if remaining > 35 s. Re-armed if remaining > 45 s.
- Position: bottom-right, margins right 72 / bottom 64 (240-243).
- "Watch credits": SemiBold 20, height 60, padding h 28, radius 6. Background `rgba(255,255,255,.35)` with white text, or white with black text when focused (NextUpCard.java:37-59).
- "Next Episode" FillButton: 250x60, left margin 16, radius 6, base `rgba(255,255,255,.35)`. A white fill sweeps left to right over **10 000 ms** (linear), and the text/▶ is black over the fill and white elsewhere. When focused it scales to 1.05 with a 3-unit white ring. The countdown pauses while the video is paused. At full it plays the next episode (NextUpCard.java:24, 49-160).
- Focus starts on Next. The VOD overlay is hidden while the card shows.
- Ended without the card: an episode with a next item advances. Otherwise the player finishes (459-472). **The queue is the season's episode list only** (SeriesActivity.java:381, 209), so there is no cross-season auto-advance.

### 1.3 Player: live banner
Full-width bottom sheet with `scrimBottom()` and padding **80/150/80/52**, horizontal (253-305):
- Logo box: 220x124, background `rgba(255,255,255,.15)` radius 18, logo fit-centre with padding 18, right margin 32.
- Text column:
  - Name row: `liveNum` Medium 22 W2 (padding right 14, bottom 2) and `liveName` Bold 32 W1, one line, with "  ♥" appended if favourite (684).
  - `liveNow`: SemiBold 21 W1, padding 14 top / 8 bottom. It shows the programme title, or "No guide information" (698-700).
  - Time row: `liveTime` Medium 16 W2 "HH:mm – HH:mm", then the progress bar, 360x5 (SeekBarView, track `.25`, fill white), left margin 16. The bar is shown only when start > 0.
  - `liveNext`: Regular 17 W2, padding-top 10: "Next   HH:mm   Title" (712).
  - Hint: Regular 14 W3, padding-top 18: "▲▼  Change channel      OK  Channel list      Hold OK  Favourite, subtitles & audio" (299-300).
- EPG source: `get_short_epg` limit 6 (XtreamApi.java:172), taking [0] = now and [1] = next.
- Auto-hide **6000 ms** (692). The banner shows on every zap and on ◀ ▶ INFO.

### 1.4 Player: channel list panel (live)
- Left sheet 560 wide by full height, margins 40 (top/left/bottom), SHEET background radius 26, padding 22 (307-353).
- Title "Channels" Bold 26 (padding 10/6/0/2). Sub-hint "Hold OK  Add or remove favourite" Regular 14 TEXT2.
- ListView rows (Adapters.Channels → RowCell): padding 18/14. Number Medium 16 TEXT2 (min width 44), logo box 72x44 SURFACE radius 8 (logo padding 5, right margin 16), then the name. The trailing mark is "▶" for the playing channel, "♥" for favourites. The playing row is "active". The gliding highlight is a white pill (Adapters.java:259-277, RowCell 79-98).
- Behaviour: the selection starts on the current channel (735-742). OK on a different channel zaps (340-349). Long-press OK or ☰ toggles the favourite with Toast "Added to Favourites — {name}" / "Removed from Favourites — {name}" (332-339, 1015-1022, Open.java:52-55). Back closes it.

### 1.5 Player: Subtitles & Audio panel (both modes)
Right sheet 520 wide by full height, margins 40, SHEET radius 26, scrollable, padding 22 (355-368). Built by `buildTrackRows` (753-856):
- Section header: Medium 13 TEXT3, UPPERCASE, letter-spacing 0.1, padding-left 14, top 4 (first) or 24, bottom 8 (907-912).
- Option row: pill (transparent → white focus) radius 12, padding 18/14. Label Medium 19 one line, with "✓" at the right if selected (920-947). Picking a row runs the action and rebuilds the list after 250 ms, keeping focus.
- Note: Regular 16 TEXT2, padding 14/8 (914-918).
- Order:
  1. **FAVOURITES**: "♡  Add to Favourites" / "♥  In Favourites — remove". For episodes the target is the series: "♡  Add series to Favourites" / "♥  In Favourites — remove series" (761-780).
  2. **SUBTITLES**: "Off" (✓ if off), then each text track by label (✓ selected). If there are none, the note "This stream has no subtitles". Picking saves `sub_lang` ("off" or the track language) (782-801).
  3. **AUDIO**: each audio track, or the note "No audio tracks found". Picking saves `audio_lang` (803-814).
  4. **AUDIO SYNC  ·  {normal | sound 0.3s earlier | sound 0.3s later}** (861-881, 901-905):
     - "Sound is late  —  bring it forward" (−100 ms)
     - "Sound is early  —  hold it back" (+100 ms)
     - "Reset" (✓ when 0)
     - Note: "Press repeatedly in 0.1s steps. Remembered for this channel|series|film." (Exo variant adds " (switches to the VLC player, which can shift the sound).")
     - Clamped to ±5000 ms (858). Stored per channel / per film / per series (Prefs.java:185-196).
  5. **SUBTITLE SIZE**: "Small", "Medium", "Large", "Extra Large" (✓ current). Note with VLC: "With VLC, size changes apply from the next video" (818-828).
  6. **PLAYER** (VOD only): "Android player", "VLC player" (✓ current). Note: "Picture freezing? Try the other player — it's remembered for this video." (830-849).
- Focus on open goes to the selected subtitle row, or the selected audio row (790, 812, 853). Opening it hides the VOD overlay and live banner (746-751). Back closes it.

### 1.6 Player: remote keys
**VOD / episodes** (955-1125, 1292-1312):
- OK tap (on key-up, < 450 ms): play/pause. Resuming shows the overlay with auto-hide. Pausing shows it pinned with the centre icon.
- OK hold ≥ **450 ms** (repeat events): opens Subtitles & Audio.
- ◀ / REWIND: seek −**5 s**. ▶ / FAST_FORWARD: seek +**10 s**. Presses accumulate from the pending target; clamped to [0, duration−1 s]; the bubble shows the total.
- ▲: show overlay. ▼ (first press, not repeat): enter **scrub mode**. If the duration is unknown it just shows the overlay.
- ☰: Subtitles & Audio.
- PLAY_PAUSE toggles (repeats ignored). PLAY plays and shows the overlay. PAUSE pauses.
- Scrub mode (1130-1207):
  - The knob starts at the current position. The overlay is pinned. The hint changes to SCRUB_HINT.
  - ◀ ▶ / RW / FF step `base = max(10 s, duration/120)` times a speed set by repeat count: 0-2 → 1x, 3-7 → 2x, 8-15 → 4x, ≥ 16 → 8x. Clamped to [0, d−1 s].
  - The commit happens **1000 ms** after the last move, or on OK / PLAY_PAUSE. It seeks only if the distance is ≥ 1 s and resumes play if paused.
  - ▲ or Back cancels. ▼ is ignored. ☰ cancels and opens tracks.
- Next-up card showing: ◀ focuses "Watch credits", ▶ focuses "Next Episode", OK (on key-up) activates, Back = Watch credits (961-972, 1299-1302).
- Back order: coach → cancel scrub → dismiss next card → close panel → hide the overlay if it is visible and playing → exit (1292-1312).

**Live** (994-1064):
- OK tap: open the channel list. OK hold ≥ 450 ms: Subtitles & Audio (Favourites first).
- ▲ / CHANNEL_UP: previous channel (index −1). ▼ / CHANNEL_DOWN: next channel (+1). Wraps around. The banner updates immediately; the stream opens **350 ms** after the last press, so fast skipping only tunes the last one (1283-1290).
- ◀ / ▶ / INFO: show the banner. ☰: Subtitles & Audio. PLAY_PAUSE / PLAY / PAUSE: toggle pause.
- Back: close panel → exit.
- **There is no number-key channel entry in Android** (no KEYCODE_0..9 handling anywhere in PlayerActivity). Do not add one for parity.

### 1.7 Player: error and recovery logic
- onError (505-537):
  1. Behind live window: engine.retry(true).
  2. Else up to **2 retries**, each after **1500 ms** with "Reconnecting…".
  3. Then live: switch .ts⇄.m3u8 once.
  4. Then VOD in Automatic mode: try the other engine once.
  5. Then the error card.
- Live onEnded: reconnect (460-462).
- Freeze watchdog (613-639). When `auto_recover` is on and playing: if the frames-rendered count doesn't change for **3 ticks (3 s)** and fps is not < 5:
  - Automatic mode, on Exo, with no saved choice: remember VLC for this item and switch ("Picture froze — switching to VLC player").
  - Otherwise up to 4 recoveries: "Re-syncing video…", then live reloads and VOD re-seeks to the current position.
- Unsupported audio (DTS/TrueHD on Exo) in Automatic mode: remember VLC and switch (493-503).
- Engine choice `wantsVlc` (410-422):
  - Live: VLC unless engine=1 (unless an audio delay is set and VLC isn't broken).
  - VOD: VLC if a delay is set, if engine=2, or if the saved per-item choice says so. Otherwise Exo.

### 1.8 TV Guide / EPG grid (EpgGrid.java, hosted in BrowseActivity Live TV)
- Entry: ▶ from the live channel list (BrowseActivity.java:874-877, 1099-1109). The guide replaces the list row-for-row (same row height and first visible row).
- Layout in guide mode (BrowseActivity.java:1036-1066):
  - The category column folds away to the left.
  - The info panel spans the top at 38% of the height: logo/preview box 16:9 on the left, text on the right with a 32 margin.
  - The guide sits below it with 12 spacing, side padding 48.
  - A bottom hint line 40 high: "OK  Watch      Hold OK  Full programme details      ▲▼  Channels      ◀ ▶  Programmes      Back  Channel list".
  - Layout changes glide over 420 ms (ChangeBounds, Decelerate 2.2). Fades are in 320 ms / out 220 ms.
- Grid drawing (EpgGrid.java:57-69, 242-335):
  - Header height 44. Small text Medium 14 TEXT2: "EEE d MMM   HH:mm" at the left, then "HH:mm" at every half hour, with tick lines SURFACE_HI.
  - Channel column 330 wide; grid starts 8 to its right. Rows are 72 high (or matched to the list row height). Window = **2 hours**, aligned to the half hour.
  - Channel cell: rounded 10, gap 3, SURFACE_HI on the selected row else SURFACE_LO. Number (Medium 14 TEXT2) at x 14. Logo 64x40 at x 64. Name Medium 17 (SemiBold if selected) TEXT, ellipsized.
  - Programme cells: rounded 10, gap 3. The highlighted one (selected row, under the cursor, focused) is FOCUS_BG with ON_FOCUS SemiBold text. On-now programmes are SURFACE_HI, others SURFACE. Title Medium 17 at x+12; hidden if less than 20 wide.
  - Rows without data: "Loading…" or "No information" (small TEXT3; ON_FOCUS2 when highlighted).
  - "Now" line: 2-wide ACCENT `#0A84FF` vertical line from 70% of the header down, with a radius-4 dot. Redrawn every 30 s.
  - Vertical scrolling is animated over 200 ms (Decelerate 2). One row of margin is kept above and below the selection.
- Listings (Guide.java): fetched per visible channel (top−2 … top+vis+4) with `get_short_epg` limit **24**. Cached **30 min**. 3 parallel fetches. `tidy()` drops invalid entries, sorts, removes duplicates and trims overlaps.
- Keys (EpgGrid.java:102-177):
  - ▼ / CH−: next row (stops at the end). ▲ / CH+: previous row; at row 0 it passes up into the top bar.
  - ▶: jump to the next programme (or +30 min). Limit now+24 h. The window shifts by 30 min to keep the cursor in view.
  - ◀: previous programme. When already on the on-now programme it **exits the guide** back to the list.
  - OK tap (on key-up): watch that channel (with the full list as the zap queue). OK hold ≥ 450 ms, ☰ or INFO: programme details dialog.
- The info panel follows the highlight (BrowseActivity.java:1123-1166):
  - Name, plus the programme title or "Loading guide…" / "No guide information".
  - "HH:mm – HH:mm" with " · later" for future programmes. A progress bar if it is on now. The description. The next programme line "HH:mm  Title".
  - Changing channel re-tints the ambient colour and restarts the preview.
- Details dialog (BrowseActivity.java:956-982):
  - Title: the programme title, or the channel name.
  - Message: channel name + "\n" + time range + " · On now, N min left" or " · Starts in N min / H hr M min" + "\n\n" + description. Without a programme: "No guide information for this time."
  - Buttons: "Watch {channel}" and "Close".

### 1.9 Movie detail (MovieActivity.java)
- Full-bleed backdrop, centre-crop, fades in over 500 ms. Then `scrimLeft()` and `pageScrimBottom()` over it. Page BG behind (45-56).
- The backdrop is the poster first, then replaced by `backdrop_path[0]` → `movie_image` → icon (171-175, 190-193).
- Text column: 900 wide, anchored bottom-left, padding 80/80/80/72 (58-66). Children:
  - Title: Bold 48, max 2 lines.
  - Meta: Medium 18 TEXT2, one line, padding 14/18: "{year}  ·  {2 hr 5 min}  ·  {genre}  ·  ★ 7.5". The year is the first 4 characters of releasedate. Durations like "01:45:00" become "1 hr 45 min" (160-166, 195-203).
  - Plot: Regular 19 TEXT, max 5 lines.
  - Credits: Regular 15 TEXT3, max 2 lines, padding-top 14: "Director: X  ·  Cast: Y".
  - Buttons row: padding-top 36, right margin 18 between (79-84, 129-133).
- Buttons in order (95-127):
  1. "▶  Play", or "▶  Resume  H:MM:SS" if there is a saved position.
  2. "↺  Start Over" (only with a saved position; clears it, then plays).
  3. "▶  Trailer" (only if `youtube_trailer` / `trailer` yields an 11-char id; added once info loads with focus kept).
  4. "♡  Favourite" / "♥  In Favourites".
- Initial focus is Play. The buttons rebuild on resume so the label updates after watching (211-215).
- Keys: D-pad between buttons, OK activates, Back exits.

### 1.10 Series detail (SeriesActivity.java)
- Same backdrop and scrims. The page is a vertical stack with padding top 56 / bottom 28 (55-73).
- Info block: 960 wide, weight 1 (fills the space), bottom-aligned, left padding 80 (75-100):
  - Title: Bold 44, max 2 lines.
  - Meta: Medium 18 TEXT2, padding 12/14. "Loading episodes…" → "{year}  ·  {genre}  ·  ★ 8.1". On error: "Couldn't load episodes — …" or "No episodes found for this series".
  - `epLabel`: SemiBold 16 TEXT, hidden until an episode is focused: "Episode {n}  ·  {name}".
  - Plot: Regular 18 TEXT, max 3 lines. Replaced by the focused episode's plot.
  - Buttons: padding-top 26.
- Season pills row: horizontal scroll, padding 76/26/64/4 (102-111, 283-300).
  - Pill text "Season N" or "Specials" for 0. Medium 17, padding 22/11, radius 22, spacing 10.
  - The active season is SURFACE_HI with SemiBold TEXT; others are transparent TEXT2. Focus is a white pill with lift 1.06.
  - **Focusing a pill switches the season immediately**; no OK is needed (290-295, 344-354).
- Episode shelf: horizontal scroll, padding 80/20/64/16, cards spaced 30 (113-123, 356-388).
  - Cards: Cards.LANDSCAPE **300x169** with art = episode `movie_image` or the series cover.
  - Title "{num}.  {name}". Subtitle "{M:SS} left" if partially watched, else the episode duration.
  - Progress bar (5 high, inset 12) for the watched fraction.
  - ▲ from a card goes to the active season pill. The scroll resets to the start on a season change.
- Buttons (150-185):
  1. "▶  Play" (no history), or "▶  Resume S{s} · E{n}" / "▶  Play S{s} · E{n}" for the **most recently watched episode from history**. Without history it plays the first episode of the first season.
  2. "▶  Trailer" (if any).
  3. "♡  Favourite" / "♥  In Favourites".
- Initial season: the one containing the last-watched episode, else the first (301-307).
- ☰ anywhere toggles the series favourite with a toast (417-425).
- Episode titles fall back to the series name. Seasons come from `episodes` as an object (keys = season) or an array (index+1). The `season` field overrides (256-275, 311-342).

### 1.11 Trailer (TrailerActivity.java)
- The id is parsed from a raw 11-char id, `?v=`, or the last path segment (26-39). If there is none: Toast "No trailer available".
- It first tries the YouTube apps (`com.amazon.firetv.youtube`, `com.google.android.youtube.tv`, `com.google.android.youtube`). Otherwise it opens a full-screen black WebView with the `https://www.youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&modestbranding=1&playsinline=1` iframe (41-86).
- **No API key is needed.** Keep screen on. Back exits.

### 1.12 Search (SearchActivity.java)
- Ambient SEARCH tint `#4A2A80`. Scrollable column with the top bar (TopBar.SEARCH) at the top, bottom padding 48 (54-62).
- Search box (64-71):
  - `input()` with hint "Channels, movies and series". Text 24, centred text, **820 wide**, centred, top margin 28.
  - IME action "Search" (searches and closes the keyboard, 121-132).
- Chips "All", "Live TV", "Movies", "Series" (79-96, 189-196):
  - Default **All**. Medium 18, padding 24/11, margin 6 each side, centred row, padding 20 top / 4 bottom.
  - The selected chip is a SURFACE_HI pill with SemiBold TEXT; others are TEXT2. Focus is white with lift 1.06. OK selects.
- Status line: Regular 17 TEXT2, centred, padding-top 18. Strings (168, 223-233):
  - "Type to search everything"
  - "Getting your library ready…"
  - "Searching…"
  - `No results for "q"`
  - blank when there are results.
- Results:
  - Up to three sections in order Channels, Movies, Series.
  - Under **All**: each is a horizontal shelf `Cards.shelf`, heading "Channels  ·  12" ("+" when capped). Max **40** per section.
  - A specific chip, or All with only one section having hits, shows a full-width grid `Cards.grid` of max **120** (239-291).
  - Card shapes: channels are CHANNEL 220x124; movies/series are POSTER 160x240.
- Matching (247-251):
  - Query lower-cased; **minimum 2 characters**; debounce **300 ms**.
  - `Match.rank` ignores spaces, punctuation and accents. Words match in any order. Best matches first.
  - Hidden countries/languages are excluded (`Filters.searchItems`).
  - Each section fills as soon as its library is ready. Stale results are dropped.
- Keys:
  - OK on a card opens it (Open.item: channel → player with the hit list as queue; movie → MovieActivity; series → SeriesActivity).
  - ☰ / hold OK on a card toggles the favourite with a toast.
  - Back while typing closes the keyboard and focuses the first result, else the Search tab (293-317). Back otherwise is TopBar.back.
  - Re-pressing the Search tab focuses the box and opens the keyboard (332-337).
- Coach steps: "Search everything" / "Narrow it down" (135-137).

### 1.13 Settings (SettingsActivity.java)
- Ambient SETTINGS tint `#3A3F52`. Scroll, TopBar.SETTINGS at the top. The list is **900 wide**, centred, side padding 16, bottom margin 60 (36-56). There is no "Settings" h1; the top bar carries the title.
- Section header: Medium 14 TEXT3, UPPERCASE, letter-spacing 0.1, padding 22/34/0/10 (363-368).
- Row: horizontal, padding 22/18. Label Medium 19 TEXT on the left; value Regular 18 TEXT2 right-aligned, max 2 lines, left margin 24 (370-404). The whole row is the focus target and OK target.
  - Actionable rows: pill SURFACE radius 12; on focus white with ON_FOCUS label and ON_FOCUS2 value, lift **1.02**.
  - Info rows: SURFACE_LO rounded 12, not focusable.
  - Row spacing 6.
- Values cycle on OK; there are no separate buttons. The first actionable row gets the initial focus.

Sections and rows in exact order (61-236):

| # | Section | Row label | Value text / options (cycle order) | Default | Action |
|---|---|---|---|---|---|
| 1 | ACCOUNTS | {account label} (one per account) | "✓  In use" (current, info row) / "Switch" | — | switch account → restart Home |
| 2 | | Subscription | "Checking…" → e.g. "Active  ·  Expires: 3 Mar 2027  ·  Connections: 1/2" or "Offline — {msg}" | — | info row (406-416, XtreamApi.java:70-88) |
| 3 | | Add Account | "" | — | Login (add) |
| 4 | | Edit This Account | "" | — | Login (switch/edit) |
| 5 | | Remove This Account | "" | — | dialog "Remove {label}?" / "Its favourites and watch history will be deleted from this device." / Remove · Cancel |
| 6 | APPEARANCE | Theme | "Dark" / "Light" | Dark | toggle and restart Home (re-themes everything) |
| 7 | | Live TV Preview | "Off" → "On (muted)" → "On with sound" | On with sound (2) | cycle |
| 8 | HIDE WHAT YOU DON'T WATCH | Countries & Languages | "Showing everything" / "N hidden" | — | FilterSettings dialog |
| 9 | | Hidden Categories | "None" / "See everything that's hidden" / "N hidden by you" (+" · more by filters") | — | FilterSettings dialog |
| 10-18 | CUSTOMISE HOME SCREEN | Continue Watching, Recent Channels, Favourite Channels, Favourite Movies, Favourite Series, Top 10 Movies in the UK, Top 10 Series in the UK, Recently Added Movies, Recently Added Series | "On" / "Off" | On | toggle |
| 19 | SUBTITLES | Size | Small → Medium → Large → Extra Large | Medium (1) | cycle + sample |
| 20 | | Colour | White → Yellow → Cyan → Green → Pink → Orange (`#FFF`, `#FFE14D`, `#5AE0FF`, `#6BEA7A`, `#FF8AD8`, `#FFA94D`) | White | cycle + sample |
| 21 | | Background | On / Off | Off | toggle + sample |
| 22 | | Background Opacity | 25% → 50% → 75% → 100% (α 0x40/0x80/0xBF/0xFF black) | 75% (2) | cycle. If Background is off, Toast "Turn Background on to see this" |
| — | | *(sample frame)* | 170-high rounded-12 frame with TL→BR gradient `#3B5B8C`→`#6C4A7E`→`#B0705A`. Text "This is how your subtitles will look." SemiBold, sizes 19/23/28/34, bottom 22. Shadow 4 when there is no background | | (324-357) |
| 23 | PLAYBACK | Video Player | "Automatic — VLC for Live TV" → "Android player for everything" → "VLC for everything"; or "Android player (VLC crashed — select to retry)" | Automatic (0) | cycle / reset vlc_broken |
| 24 | | Last Error Report *(only if a crash was saved)* | "View" | — | dialog "Last error report" (monospace 12) OK / Delete report |
| 25 | | Remembered Player Choices | "None" / "N  ·  Reset" | — | clear; Toast "Everything will use the default player again" |
| 26 | | Live Stream Format | "MPEG-TS" ⇄ "HLS" | MPEG-TS (ts) | toggle |
| 27 | | Fix Frozen Video Automatically | On / Off | On | toggle |
| 28 | | User Agent | current UA | `XtreamPlayer/1.0 (Linux; Android; Fire TV)` | dialog "User Agent", message "Some providers only allow certain apps. Try IPTVSmartersPlayer or VLC/3.0.20 if streams fail.", text field, buttons Save / Default / Cancel |
| 29 | LIBRARY | Refresh Automatically | "Every 12 hours" → "Once a day" → "Every 6 hours" → "Every time the app opens" → "Only when I ask" (12, 24, 6, 0, −1) | Every 12 hours | cycle |
| 30 | | Refresh Now | "Not yet" / "Updated today at HH:mm" / "Updated d MMM, HH:mm"; while running "Updating…"; on error "Failed — {msg}" | — | refresh all lists |
| 31 | | Clear Watch History | "" | — | Toast "Watch history cleared" (clears pos_/dur_/hist_ of the current account) |
| 32 | | Show Tutorial | "Quick tour of the basics" | — | reset coach, restart Home |
| 33 | ABOUT | Version | "YM Player {versionName}" | — | info row |
| 34 | | Check for Updates | "Get the latest version" | — | Updater.check(manual) |
| — | | footer | "Developed by Yousuf Miah" Medium 16 TEXT2, centred, padding 22/10 | | |

Back → TopBar.back (444-447).

### 1.14 Login (LoginActivity.java)
- If signed in (and not add/switch): jump straight to Home, or to Setup if the library isn't saved (52-60).
- Background: Ambient HOME `#2A2F7A` tinted gradient (64).
- Two panels side by side, centred vertically and horizontally (72-81):
  - **Form card**: 620 wide, SURFACE_LO radius 28, padding 44.
  - **Phone card**: 440 wide, left margin 36, SURFACE_LO radius 28, padding 40.
- Form card contents (83-115):
  - Title "YM Player" (or "Add Account"), Bold 40.
  - Subtitle Regular 15 TEXT2, padding 6/20: "Sign in with the details from your TV provider. You can also paste a full get.php / M3U link into the server box."
  - Inputs, 12 apart:
    1. "Account name (optional, e.g. Home or Sports)"
    2. "Server URL  (e.g. http://example.com:8080)"
    3. "Username"
    4. "Password" (**visible-password** input type, so it is not masked)
  - Pre-filled with the current account when editing.
  - Button "Log in" / "Add Account", full width, top margin 8.
  - Status: Regular 15, padding-top 14.
- Phone card contents (121-158):
  - "Use your phone" Bold 28, centred.
  - Regular 15 TEXT2: "Scan with your phone's camera and type your details there — much quicker than the remote. Your phone needs to be on the same Wi-Fi as this TV."
  - White radius-20 box with padding 14 around a **250x250** QR code (dark `#0B0B0F` on white).
  - "Or open  http://ip:port/?t=token" Regular 14 TEXT3, or "Connect this TV to your home network to use this."
  - Phone status Medium 16 TEXT: "Details received from your phone…" / "Signed in from your phone ✓" / "That didn't work — see the details on the left."
- Initial focus: Server (Name when adding) (118).
- Attempt (231-303):
  - A pasted URL with username=/password= fills the user and password fields.
  - Validation message (red `#FF7A7A`): "Please fill in the server, username and password."
  - Then "Connecting…" and the button is disabled.
  - It tries every candidate base (as typed, host-only, http⇄https) times user agents (saved, "IPTVSmartersPlayer", "okhttp/4.9.2", "VLC/3.0.20 LibVLC/3.0.20", Chrome-on-AFTMM). Unreachable-host errors skip the remaining agents for that base. A working agent is saved to the account (305-360).
  - Errors:
    - "Couldn't log in: {msg}\nLast address tried: {url}/player_api.php\nCheck the server address with your provider — it should be just http://host:port"
    - "The server rejected the login — check your username and password (account status: X)."
  - On success: save the account and make it current, then go to **SetupActivity** (clear task).

### 1.15 Setup / library download (SetupActivity.java)
- Ambient HOME. A 720-wide centred column (47-52).
- Contents top to bottom:
  - Logo 110x110 (asset logo.png).
  - "Getting everything ready" Bold 36, centred, padding 26/8.
  - "This only happens when you add a playlist. After this, everything opens instantly." Regular 17 TEXT2, bottom 30.
  - A card (SURFACE_LO radius 22, padding 10) with 3 rows: **Live TV, Movies, Series** (96-118). Each row has:
    - A 34x34 icon slot (right margin 18) holding a spinner, or "✓" `#34C759` / "✕" RED (Bold 22).
    - The name in SemiBold 21.
    - A count at the right, Medium 17. It reads "Waiting" (TEXT3), "Waiting for your provider…", "12,345 channels so far…" (updated every 300 ms), "12,345 channels" or "Didn't load".
  - Status line Regular 16 TEXT2: "Couldn't download Movies: {msg}" or "All set" (then Home after **700 ms**).
  - Actions:
    - After Live TV finishes while the others are still running: button "Start Watching — Movies & Series will finish in the background" (focused).
    - On failure: "Try Again" (failed types only) and "Continue Anyway", spaced 10.
- Back is ignored (243-246).

### 1.16 Phone link (PhoneLink.java)
- While Login is visible, the TV runs an HTTP server on the LAN on the first free port in **8642-8661** (60-78).
- One-time 8-character token from `abcdefghjkmnpqrstuvwxyz23456789`. Wrong token → 403 "This code has expired" page.
- GET `/?t=` serves a mobile form (dark gradient, card, "YM" gradient logo):
  - Heading "Add a playlist", "Your details go straight to your TV over your home Wi-Fi."
  - Fields "Account name (optional)", "Server URL or full M3U link", "Username", "Password".
  - Button "Add to TV". Footer "Developed by Yousuf Miah" (227-248).
- POST `/add`: the TV fills the form and logs in. The phone waits up to 40 s and shows one of:
  - "You're in ✓" + message + "You can close this page."
  - "Couldn't sign in" + message + "Try again" link
  - "Still checking…"
  (164-185)
- TV-side replies:
  - "Added {label}. Your TV is loading it now."
  - "Your TV is still checking the last details — try again in a moment."
  - "Please fill in the server, username and password (or paste a full M3U link)."
  - "Couldn't reach that server: …"
  - "The server rejected the username or password."
  (LoginActivity.java:166-177, 251-293)
- **Direction: phone → TV (credential entry).** It does not export accounts.

### 1.17 Ambient (Ambient.java)
- This is **not a screensaver.** Every screen's window background is a vertical 4-stop gradient: tint → mix(tint, BG, .45) → mix(tint, BG, .85) → BG (Ambient.java:104-106).
- Resting tints per section (21-22): HOME `#2A2F7A`, LIVE `#0F5C66`, MOVIES `#6A1F4A`, SERIES `#1F4E8C`, SEARCH `#4A2A80`, SETTINGS `#3A3F52`.
- Every tint goes through `tone()` (109-124):
  - HSV with saturation clamped to max(s·1.25, .35) within [.35, .85] and value **.46** (dark theme).
  - Greys (s < .12) become slate blue (hue 228, s .30).
  - Light theme: s·.55 clamped [.10, .32], value .97.
- `tint(url)` fades to the artwork's average colour over **700 ms** (68-80, 91-102). The colour is handed from screen to screen so navigation cross-fades (37-65).
- Used by Login/Setup (HOME), Search, Settings, and the browse screens (focused artwork tints the background).

### 1.18 Updater (Updater.java)
- On launch at most every **3 h**, and manually from Settings: GitHub `releases/latest` of YousufMiahh/XtreamPlayer (38-125).
- Dialog "Update available": "{name} is ready to install. Your accounts, favourites and history stay as they are." + "What's new" (truncated to 700 characters). Buttons "Update now" / "Later". "Later" suppresses that version for 24 h.
- Download dialog with a progress bar and "x.x MB of y.y MB", then the system installer.
- Manual-check toasts: "Checking for updates…", "You're up to date (YM Player 1.0.N)", "Couldn't check for updates — try again later".

---

## 2. FEATURES IN ANDROID MISSING FROM TIZEN

1. **TV Guide / EPG grid**, entirely absent (EpgGrid.java:1-342, Guide.java:1-88, BrowseActivity.java:1099-1182). This covers the 2-hour timeline, half-hour header, "now" line, programme cells, guide-mode layout and the 24-programme per-channel lazy fetch with 30-min cache.
2. Guide programme-details dialog with "Watch {channel}" / "Close" (BrowseActivity.java:956-982).
3. Guide bottom hint line and the panel hints "▶  TV guide      Hold OK  Favourite" (BrowseActivity.java:947-953, 1049).
4. Live **channel list overlay** in the player: "Channels" sheet with number, logo, ▶/♥ marks, OK to zap (PlayerActivity.java:307-353, 735-742).
5. Favourite toggle from inside the player: hold OK / ☰ in the channel list, plus the Favourites row in the track panel, with toasts (PlayerActivity.java:332-339, 770-780, 1015-1022; Open.java:52-55).
6. **Subtitles & Audio panel** (subtitle track picker incl. "Off", audio track picker) (PlayerActivity.java:746-856).
7. Persisting chosen subtitle/audio language (`sub_lang`, `audio_lang`) when picking a track, and applying preferred languages at start (PlayerActivity.java:787-809; ExoEngine.java:42-47).
8. **Audio Sync** rows: ±100 ms steps, ±5 s clamp, Reset, per channel/film/series memory (PlayerActivity.java:858-905; Prefs.java:185-196).
9. Subtitle Size picker inside the player (PlayerActivity.java:818-828).
10. Subtitle rendering itself, with size / colour / background / opacity applied (ExoEngine.java:167-179; VlcHolder.java:68-79). Tizen draws no subtitles at all.
11. Player engine choice rows "Android player / VLC player" and the per-item remembered choice (PlayerActivity.java:830-849; Prefs.java:229-257). (Single engine on Tizen; see §4.)
12. **Scrub mode** on ▼: knob, time card over the knob with ± delta, hold-to-accelerate 1x/2x/4x/8x, auto-commit after 1 s, SCRUB_HINT (PlayerActivity.java:1127-1207; SeekBarView.java:41-86).
13. Seek **burst bubble** "+30 sec" / "−1:20", accumulating within 1200 ms (PlayerActivity.java:192-200, 1267-1281).
14. **Next Episode card** with "Watch credits" and a 10 s fill-countdown "Next Episode" button (PlayerActivity.java:1212-1256; NextUpCard.java:1-161).
15. Centre play/pause icon (120 circle) shown while paused (PlayerActivity.java:247-250, 474-487, 1315-1347).
16. VOD hint line `VOD_HINT` (PlayerActivity.java:37-38, 232-235).
17. Episode subtitle line "{Series}  ·  Episode N" above the title (PlayerActivity.java:185, 569-571).
18. Remaining-time display "−H:MM:SS" on the right, and the buffered segment on the bar (PlayerActivity.java:665-678).
19. Live banner **channel logo box** 220x124 (PlayerActivity.java:261-270).
20. Live banner **favourite heart** "  ♥" after the name (PlayerActivity.java:684).
21. Live banner hint line "▲▼  Change channel      OK  Channel list      Hold OK  Favourite, subtitles & audio" (PlayerActivity.java:299-302).
22. Live banner "No guide information" fallback and the "Next   HH:mm   Title" format (PlayerActivity.java:698-713).
23. Buffering spinner (PlayerActivity.java:141-144, 489-491).
24. **Status pill** messages ("Reconnecting…" etc.) top-right with 2.5 s auto-hide (PlayerActivity.java:159-165, 718-723).
25. Error card with "OK  Try again      Back  Exit      ▲▼  Other channel", and OK-to-retry (PlayerActivity.java:533-536, 1027-1031).
26. Retry ladder: 2 retries at 1.5 s, then alternate live format, then the other engine (PlayerActivity.java:505-537). Tizen does only one format flip.
27. Live auto-reconnect on stream end (PlayerActivity.java:460-462).
28. **Frozen-picture watchdog** with up to 4 "Re-syncing video…" recoveries (PlayerActivity.java:613-639).
29. Zap debounce: the banner updates at once and the stream opens 350 ms after the last press (PlayerActivity.java:1283-1290).
30. Play/Pause, Play, Pause, Rewind and Fast-forward media keys in both players (PlayerActivity.java:1055-1060, 1093-1112).
31. ▲ shows the VOD overlay. Pause keeps it pinned (PlayerActivity.java:1113-1115, 477-479).
32. INFO key shows the live banner (PlayerActivity.java:1049).
33. Long-press OK (≥ 450 ms) handling in the player and guide (PlayerActivity.java:974-1010; EpgGrid.java:147-177).
34. Layered Back in the player: cancel scrub → dismiss next card → close panel → hide overlay → exit (PlayerActivity.java:1292-1312).
35. First-run coach cards for the player (PlayerActivity.java:379-383).
36. Resume toast "Resuming from H:MM:SS" and the 10 s minimum resume threshold (PlayerActivity.java:554-560).
37. Position-save rule: clear when within 60 s of the end, save only if > 10 s (PlayerActivity.java:593-599).
38. Movie detail **full-bleed backdrop** from `backdrop_path`, with left and bottom page scrims (MovieActivity.java:45-56, 171-175).
39. Movie meta line "year  ·  duration  ·  genre  ·  ★ rating" (MovieActivity.java:160-166, 195-203).
40. Movie credits line "Director: …  ·  Cast: …" (MovieActivity.java:72-73, 167-170).
41. **"▶  Trailer"** button on movie and series pages, plus the YouTube app / youtube-nocookie embed player (MovieActivity.java:110-116, 176-183; SeriesActivity.java:168-174; TrailerActivity.java). Android needs no API key; Tizen gates trailers behind `hasYoutube()` (keys.js:1-10).
42. "↺  Start Over" button label and the "▶  Resume  H:MM:SS" combined primary button (MovieActivity.java:98-109).
43. Detail buttons refresh on return from the player (MovieActivity.java:211-215; SeriesActivity.java:404-415).
44. Series page backdrop, meta line (year, genre, rating) and "Loading episodes…" / error texts (SeriesActivity.java:218-254, 280).
45. Series **Favourite button** and ☰ favourite toggle (SeriesActivity.java:175-183, 417-425).
46. Series episode **landscape cards** (300x169 artwork, "N.  title", "M:SS left" or duration, progress bar) (SeriesActivity.java:356-388).
47. Focused-episode label "Episode N  ·  name", with the plot swapped to the episode's (SeriesActivity.java:369-378).
48. Series primary button using the **last watched episode from history** ("▶  Resume S1 · E3" / "▶  Play S1 · E4") (SeriesActivity.java:143-166, 193-198).
49. Initial season = the season of the last-watched episode (SeriesActivity.java:301-307).
50. "Specials" naming for season 0 (SeriesActivity.java:284).
51. Search **"All"** filter showing all three sections at once (SearchActivity.java:41-44, 206).
52. Search fuzzy ranking via `Match.rank`: punctuation, spaces and accents ignored, words in any order, best first (SearchActivity.java:247-251).
53. Search results as **card shelves / grids with headings** "Movies  ·  40+", and auto-grid when only one section hits (SearchActivity.java:258-288).
54. Search status texts "Type to search everything", "Getting your library ready…", "Searching…", `No results for "q"` (SearchActivity.java:168, 223-233).
55. Search: Back while typing focuses the first result. Hidden-country filter applied (SearchActivity.java:293-317, 250).
56. Settings: Subscription status row (SettingsActivity.java:71, 406-416).
57. Settings: "Edit This Account" row (SettingsActivity.java:77-81).
58. Settings: Remove-account **confirmation dialog** (SettingsActivity.java:305-319).
59. Settings: "Hide What You Don't Watch" section (Countries & Languages, Hidden Categories) (SettingsActivity.java:102-108).
60. Settings: subtitle **sample preview frame** (SettingsActivity.java:321-357).
61. Settings: Subtitle size "Extra Large" (4th size) (SettingsActivity.java:22; PlayerActivity.java:40).
62. Settings: "Video Player" row (SettingsActivity.java:156-166).
63. Settings: "Last Error Report" row and dialog (SettingsActivity.java:167-172, 238-253).
64. Settings: "Remembered Player Choices" row (SettingsActivity.java:173-179).
65. Settings: **"Fix Frozen Video Automatically"** toggle. Tizen reads `auto_recover` but never exposes it (SettingsActivity.java:186-191; Tizen store.js:140).
66. Settings: User Agent **dialog** with the hint text and a "Default" button (SettingsActivity.java:418-442).
67. Settings: "Refresh Now" with the last-updated time (SettingsActivity.java:205-207, 266-289).
68. Settings: "Clear Watch History" (SettingsActivity.java:208-213; Prefs.java:437-447). Tizen store.js has no clearHistory.
69. Settings: "Show Tutorial" (SettingsActivity.java:215-220).
70. Settings: About section with Version, Check for Updates and the "Developed by Yousuf Miah" footer (SettingsActivity.java:222-235).
71. Settings: theme switch actually re-themes the app (light palette) and restarts Home (SettingsActivity.java:89-94; Ui.java:39-55). Tizen stores `dark` but nothing reads it.
72. Login: **Account name** field (LoginActivity.java:89, 284).
73. Login subtitle/help text (LoginActivity.java:84-87).
74. Login "Use your phone" QR panel and the LAN credential-entry server (LoginActivity.java:121-213; PhoneLink.java).
75. Login user-agent fallback list and candidate-base retry (as typed / host-only / http⇄https) (LoginActivity.java:27-33, 305-360).
76. Login "Connecting…" state with the button disabled, plus detailed error texts (LoginActivity.java:257-282).
77. Login auto-forward when already signed in (LoginActivity.java:52-60).
78. Post-login **library download screen** "Getting everything ready" (SetupActivity.java). Tizen's `setup` view is an accounts list.
79. "Add Account" title variant when adding (LoginActivity.java:83, 105).
80. **Ambient tinted backgrounds**: per-section tints, artwork-driven colour fades, cross-screen handoff (Ambient.java:21-124).
81. Page gradient `screenBackground()` BG_TOP→BG (Ui.java:139-141). Tizen is flat `#0B0B0F` (theme.css:7).
82. In-app updater dialogs (Updater.java). On Tizen this is N/A for store installs; show the version only, or check a release feed and point the user to it.
83. Remember VLC on unsupported audio (PlayerActivity.java:493-503). N/A on a single engine, but the user needs feedback when audio is unsupported.

## 3. THINGS TIZEN DOES DIFFERENTLY

**Global look**
1. **Focus style.** Tizen: blue `#0A84FF` 3px border plus a 4px blue glow on every focusable (browse.css:16, 37, 47, 53; login.css:6; search.css:6; settings.css:8). Android: a solid white pill with near-black text and a 1.02-1.06 scale lift over 180 ms, with no outline (Ui.java:160-174, 252-269). **Must change:** replace every `:focus` rule with `background:#fff; color:#0B0B0F; transform:scale(1.06); transition:180ms cubic-bezier(.2,.8,.2,1)`, and use a 4-unit (5.6px) white ring for artwork.
2. Unfocused surfaces. Tizen uses opaque `#1b1b22` / `#1c1c22`. Android uses translucent `rgba(255,255,255,.10/.18/.07)` over a tinted gradient (Ui.java:43). Change to the SURFACE tokens.
3. Background. Tizen is flat `--bg:#0B0B0F` (theme.css:7). Android is BG `#0A0B12` with a BG_TOP `#1C2040` gradient and Ambient tints (Ui.java:42; Ambient.java:104). Change to match.
4. Type scale. Tizen sizes are arbitrary (e.g. h1 56px, buttons 28px, settings 22px). Android sizes ×1.4 give: button 25.2px SemiBold, input 26.6px Medium, settings label 26.6px / value 25.2px, detail title 67.2px. Change to Android units ×1.4.
5. Ambient. Tizen `ambient` is a Ken-Burns artwork **screensaver** that exits on any key and is reachable from no route (ambient.js:1-64; extras.css:1-4). Android "Ambient" is the tinted background system with no screensaver (Ambient.java). Remove or repurpose; implement tints.

**Player: live**
6. Banner layout. Tizen: a floating rounded box `rgba(11,11,15,.82)` inset 80px, text 28px, bar in accent blue (browse.css:23-27; player-live.js:55-58). Android: a full-width bottom gradient scrim, logo box on the left, number + name Bold 32, now title SemiBold 21, time and a 360x5 white bar, next line, hint (PlayerActivity.java:253-305). Rebuild to match.
7. Banner text format. Tizen puts "HH:mm – HH:mm  Title" on one line for now and next, and puts the number in the same text as the name (player-live.js:22, 30-32). Android: number in W2 next to the name; title on its own line; time beside the bar; "Next   HH:mm   Title" (PlayerActivity.java:683-713).
8. Banner auto-hide. Tizen 5000 ms (player-live.js:8). Android 6000 ms (PlayerActivity.java:692).
9. EPG fetch. Tizen fetches limit 2 (player-live.js:28). Android fetches limit 6 (XtreamApi.java:172). Minor; keep 6 for parity of data.
10. OK key. Tizen: OK toggles the info banner (player-live.js:75-79). Android: OK opens the channel list; hold OK opens Subtitles & Audio (PlayerActivity.java:994-1010).
11. ◀ / ▶. Tizen toggles the banner (it hides it if shown). Android always shows / refreshes the banner (PlayerActivity.java:1047-1051).
12. Channel-key direction. Tizen: CH+ → next (+1), CH− → previous (player-live.js:73-74). Android: CHANNEL_UP → −1 (same as ▲), CHANNEL_DOWN → +1 (PlayerActivity.java:1035-1042). Swap CH+/CH− to match Android (▲ and CH+ = previous in list order).
13. Zap timing. Tizen stops and reopens AVPlay on every press (player-live.js:43-48). Android debounces 350 ms with the banner updating immediately (PlayerActivity.java:1283-1290).
14. Error text. Tizen shows a static "Channel unavailable" at top 80px, 36px (player-live.js:56; browse.css:28). Android shows a centred SHEET card with the reason and key hints, and OK retries (PlayerActivity.java:151-157, 533-536).
15. Live error recovery. Tizen flips the format once and only if `auto_recover` is on (player.js:58-67). Android always retries 2x, then flips the format regardless of auto_recover; `auto_recover` controls only the freeze watchdog (PlayerActivity.java:505-537, 613-614).
16. Tizen's live onerror handler doesn't distinguish stream end. Android reconnects on live end (PlayerActivity.java:460-462). Tizen `onCompleted` emits 'ended', which live ignores (player.js:69-77).

**Player: VOD**
17. Seek steps. Tizen ◀ 10 s / ▶ 30 s (player-vod.js:12-13). Android ◀ 5 s / ▶ 10 s (PlayerActivity.java:36). Change to 5000 / 10000.
18. Seek accumulation. Tizen adds to the last `pos` from `timeupdate`, so rapid presses can collapse (player-vod.js:62-66). Android accumulates from the pending target `seekTarget`, clamps to duration−1 s, and shows the bubble (PlayerActivity.java:1267-1281).
19. OK key. Tizen: the first OK only shows the controls, the second toggles pause (player-vod.js:119-123). Android: OK always toggles pause (on key-up); hold opens tracks (PlayerActivity.java:975-993).
20. Controls layout. Tizen uses the same floating box: "Parent — Title", a blue bar, and "▶ 1:23 / 45:00" text (player-vod.js:35, 25-29, 77-78). Android: a full-width scrim with the subtitle line, Bold 34 title, white 7-high bar, left elapsed / right "−remaining", and the hint (PlayerActivity.java:177-236). Rebuild.
21. Pause glyph. Tizen shows a small text "❚❚/▶" glyph inside the box (player-vod.js:29). Android shows a 120-unit centred circular icon only when paused (PlayerActivity.java:247-250).
22. Auto-hide. Tizen 5000 ms even while paused (player-vod.js:14, 38). Android 4000 ms only while playing; it stays up when paused (PlayerActivity.java:484, 662).
23. Resume. Tizen shows a "Resume from H:MM:SS?" prompt with "Resume" / "Start over" buttons when no startMs is given (player-vod.js:72-76, 105-108; browse.css:54-55). Android never prompts in the player: it resumes automatically (> 10 s) with a toast, and the choice is made on the detail page (PlayerActivity.java:554-560). Remove the prompt; auto-resume.
24. Resume threshold. Tizen resumes any position > 0 (player-vod.js:106; movie-detail.js:37). Android needs > 10 000 ms to resume, and treats the last 60 s as finished (PlayerActivity.java:556, 597).
25. Auto-advance queue. Tizen's queue = all episodes of all seasons flattened, so it crosses seasons (series-detail.js:41-46). Android's queue = the current season's list only (SeriesActivity.java:209, 381).
26. End-of-episode. Tizen advances immediately on `ended` (player-vod.js:51-59, 87). Android shows the Next-up card in the last 30 s with a 10 s countdown, and on a natural end advances (PlayerActivity.java:459-472, 1212-1232).
27. Back. Tizen Back always leaves the player at once (app.js `back` → router.back; player-vod has no back handler). Android uses the layered Back (PlayerActivity.java:1292-1312).
28. VOD title format. Tizen uses "Series — S1E3 · Title" (player-vod.js:35; series-detail.js:24). Android uses the subtitle line "Series  ·  Episode 3" and the title = episode title (PlayerActivity.java:568-571).
29. Error. Tizen shows "Playback failed" static text (player-vod.js:73). Android shows the card with reason and OK-to-retry (PlayerActivity.java:533-536).
30. Position saving. Tizen saves any pos > 0 on stop and never clears near the end except on completion (player.js:93-106). Android clears if within 60 s of the end and saves only if > 10 s (PlayerActivity.java:593-599).

**Movie detail**
31. Layout. Tizen: a 400px poster on the left plus a body, flex with 80 padding (browse.css:39-45; movie-detail.js:22-42). Android: a full-bleed backdrop with scrims and a 900-wide bottom-left text column, no poster (MovieActivity.java:45-84). Rebuild.
32. Meta. Tizen shows `★ ${item.info}`, but item.info is already "★ 7.5", which renders "★ ★ 7.5". After the info load it shows the raw rating `★ ${info.rating}` unformatted (movie-detail.js:29, 73-74). Android: "year  ·  duration  ·  genre  ·  ★ 7.5" (one decimal) (MovieActivity.java:160-166).
33. Buttons. Tizen: "Resume from H:MM:SS", "Play from start" / "Play", "★ Favourited" / "☆ Favourite" (movie-detail.js:37-39, 56). Android: "▶  Resume  H:MM:SS" / "▶  Play", "↺  Start Over", "▶  Trailer", "♥  In Favourites" / "♡  Favourite" (MovieActivity.java:98-137). Change the labels and order.
34. Image. Tizen uses `movie_image || cover_big` as the poster (movie-detail.js:75). Android uses `backdrop_path[0]`, then `movie_image`, then the icon, as the backdrop, with a 500 ms fade-in (MovieActivity.java:171-175, 190-193).
35. Movie playback queue: same single item; fine. Tizen's movie `ext` is never filled from `movie_data.container_extension` when the list lacks it. Android fills it (MovieActivity.java:184-185).

**Series detail**
36. Layout. Tizen uses the Live-style left rail (h1 36px, plot 20px, "Play next" button, season buttons styled `.cat`) and a vertical episode list of text rows (series-detail.js:72-74; browse.css:48-53). Android: a backdrop page with the info block, a **horizontal season pill row** and a **horizontal episode card shelf** (SeriesActivity.java:68-123). Rebuild.
37. Season change. Tizen needs OK on a season button and then moves focus into the list (series-detail.js:90). Android switches the season on focus alone (SeriesActivity.java:290-295).
38. Primary button. Tizen "Play next" plays the first episode with any saved position in season order, else the first (series-detail.js:82-87). Android uses the most recent history episode and labels "▶  Resume S1 · E3" / "▶  Play …" / "▶  Play" (SeriesActivity.java:150-166).
39. Episode row. Tizen shows "S1E3 · Title" plus "▶ 12:00 / 45:00" when resumable (series-detail.js:24, 58-61). Android shows "3.  Title" plus "33:00 left" or the duration, with a progress bar (SeriesActivity.java:363-367).
40. Season labels. Tizen uses "Season {key}", including 0 (series-detail.js:121). Android shows "Specials" for 0 (SeriesActivity.java:284).
41. Episode sort. Tizen sorts by episode_num numerically (series-detail.js:19). Android keeps the provider order (SeriesActivity.java:311-342). Minor; keep provider order to match.
42. Back. Tizen: Back from an episode focuses the season button (series-detail.js:98-103). Android: Back exits the page (default); ▲ from a card goes to the season pill (SeriesActivity.java:368).

**Search**
43. Filter set and default. Tizen has 3 toggle buttons "Live" / "Movies" / "Series", default Live, inline right of the box (search.js:14, 70-75; search.css:2-5). Android has 4 chips "All" / "Live TV" / "Movies" / "Series", default All, centred below the box (SearchActivity.java:44, 73-96).
44. Box. Tizen: placeholder "Search", flex-1 full width, 32px left-aligned (search.js:68; search.css:3). Android: "Channels, movies and series", 820 wide (1148px), centred, 24 (33.6px) centred text, top margin 28 (SearchActivity.java:64-71).
45. Matching. Tizen uses `includes()` on lower-case, 1-char minimum, debounce 120 ms, max 200 (search.js:12-13, 46-49). Android uses Match.rank, 2-char minimum, debounce 300 ms, max 40 / 120 (SearchActivity.java:30, 45, 118, 217, 250). Change to match.
46. Results. Tizen shows a vertical list of rows (96x64 art + name) (search.js:32-41; search.css:7-12). Android shows card shelves / grids per section with headings (SearchActivity.java:258-275).
47. Messages. Tizen: "Type to search" / "No results" (search.js:46, 50). Android: see §1.12.
48. Tizen Search has no top bar / tabs. Android's is inside the TopBar (SearchActivity.java:62). (TopBar is scope A.)

**Settings**
49. Structure. Tizen: an h1 "Settings", sections Playback, Subtitles, Customise Home, Theme, Accounts, max-width 1100, left-aligned (settings.js:15-108; settings.css:1). Android: no h1 (TopBar), list 900 wide (1260px) centred, sections ACCOUNTS, APPEARANCE, HIDE WHAT YOU DON'T WATCH, CUSTOMISE HOME SCREEN, SUBTITLES, PLAYBACK, LIBRARY, ABOUT (SettingsActivity.java:61-236). Reorder.
50. Row widget. Tizen uses a label plus a separate 200px-min button or text input on the right (settings.js:42-49, 75-86; settings.css:4-8). Android: the whole row is a pill, with the value as right-aligned grey text, cycling on OK (SettingsActivity.java:370-404). Change.
51. Section headers. Tizen h2 24px `#9a9aa5` SemiBold, mixed case (settings.css:3). Android Medium 14 (19.6px) TEXT3, UPPERCASE, letter-spacing .1em (SettingsActivity.java:363-368).
52. Subtitle colours. Tizen: White, Yellow, Green, Cyan, Blue, Red (settings.js:7). Android: White, Yellow, Cyan, Green, Pink, Orange with exact hexes (PlayerActivity.java:41-42). Fix the names and order.
53. Subtitle sizes. Tizen has 3: Small/Medium/Large (settings.js:8). Android has 4, adding Extra Large (SettingsActivity.java:22).
54. Preview labels. Tizen "Off" / "Muted" / "With sound", title "Preview mode", under Playback (settings.js:10, 19-20). Android "Off" / "On (muted)" / "On with sound", label "Live TV Preview", under APPEARANCE (SettingsActivity.java:95-100, 256).
55. Refresh. Tizen: title "Auto-refresh library" under Playback; cycle −1, 0, 6, 12, 24; labels "Manual", "Every launch", "Every 6 hours", "Every 12 hours", "Every 24 hours" (settings.js:11, 21-22). Android: "Refresh Automatically" under LIBRARY; cycle 12 → 24 → 6 → 0 → −1; labels "Every 12 hours", "Once a day", "Every 6 hours", "Every time the app opens", "Only when I ask" (SettingsActivity.java:197-204, 257-264).
56. Live format. Tizen "Live stream format", "TS" / "HLS" (settings.js:17-18). Android "Live Stream Format", "MPEG-TS" / "HLS" (SettingsActivity.java:180-185, 359-361).
57. Label casing. Tizen uses sentence case ("Background opacity", "User-agent"). Android uses Title Case ("Background Opacity", "User Agent") (SettingsActivity.java:143, 192).
58. Tizen-only rows. "Subtitle language" and "Audio language" free-text inputs (settings.js:36-40) don't exist in Android Settings; Android sets these by picking a track in the player (PlayerActivity.java:787-809). Remove them and add the player track panel.
59. Theme row. Tizen: section "Theme", row "Dark theme" On/Off (settings.js:98-102). Android: APPEARANCE → "Theme", Dark/Light (SettingsActivity.java:89-94).
60. Customise Home. Tizen: section "Customise Home". It hides the Top 10 rows without a TMDB key, and the names are "Top 10 Movies" / "Top 10 Series" (settings.js:89-96; store.js:11-12). Android: "Customise Home Screen", always 9 rows, "Top 10 Movies in the UK" / "Top 10 Series in the UK" (Prefs.java:364-368; SettingsActivity.java:110-119).
61. Accounts. Tizen: a row per account with "(current)" suffix and "Use" / "Remove" buttons, and "Add account" at the end, removing without confirmation (setup.js:18-56). Android: a row per account valued "✓  In use" / "Switch", then Subscription, Add Account, Edit This Account, Remove This Account (with a dialog) (SettingsActivity.java:63-86).
62. Account label. Tizen "user@host" (setup.js:11). Android "user @ host" with spaces, host = server minus the scheme, port kept (Prefs.java:36-40).
63. Switching account. Tizen re-renders in place (setup.js:46-50). Android restarts at Home (SettingsActivity.java:291-303).

**Login / Setup / Phone link**
64. Login layout. Tizen: a single 720px column, h1 56px, labelled inputs (label above), "Log in" (primary blue) + "Accounts" buttons, red error (login.css:1-12; login.js:83-102). Android: two side-by-side rounded cards (form 620 + phone 440), placeholder-style inputs, full-width "Log in" pill, no "Accounts" button (LoginActivity.java:62-119). Rebuild.
65. Password field. Tizen masks it (`type=password`) (login.js:12). Android shows it visibly (TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) (LoginActivity.java:93).
66. User agent. Tizen has a "User agent (optional)" field on the login form (login.js:13). Android has no UA field on login; it auto-tries the UA list, and UA lives in Settings (LoginActivity.java:27-33).
67. Server placeholder. Tizen label "Server or M3U link" (login.js:10). Android "Server URL  (e.g. http://example.com:8080)" plus the subtitle about pasting get.php/M3U (LoginActivity.java:84-91).
68. Link parsing. Tizen splits a pasted link on input (login.js:34-41). Android does it on submit and only fills empty user/pass (LoginActivity.java:236-246). Minor.
69. Messages. Tizen: "Enter server, username and password." and "Login failed: {msg}" (login.js:48, 68). Android: "Please fill in the server, username and password.", "Connecting…", and the detailed failure texts (LoginActivity.java:250-282).
70. After login. Tizen goes to Home (login.js:74). Android goes to the Setup download screen (LoginActivity.java:296-300).
71. Setup screen. Tizen `setup` = "Accounts" manager (setup.js:63-85). Android Setup = library download progress (SetupActivity.java). Rename the Tizen accounts list (move it into Settings) and build the download screen.
72. Phone link direction. Tizen `phonelink` encodes the *current* account's get.php URL as a 480px QR, to export to a phone; it is not reachable from any route (phonelink.js:5-37; extras.css:5-6). Android receives credentials *from* the phone via a LAN form (PhoneLink.java). Must reverse. A Tizen web app cannot open a listening TCP socket, so this needs a Tizen service app or a relay (see §4 note).
73. Splash. Tizen shows a plain "YM Player" h1 for 600 ms, then goes to Home or Login (app.js:23-35). Android goes to Home or Setup depending on whether the library is cached (LoginActivity.java:52-60). (Splash itself is scope A.)

## 4. ENGINE NOTES (Android ExoPlayer/VLC feature → Tizen AVPlay)

| Android behaviour | Where | AVPlay equivalent | Verdict |
|---|---|---|---|
| List audio tracks with labels (label, or language display name, else "Audio N"; plus codec "Dolby Digital+ / Dolby Digital / DTS / AAC" and channels "7.1 / 5.1 / Stereo / Mono", joined by "  ·  ") | ExoEngine.java:109-130, 201-228 | `getTotalTrackInfo()` → entries `{type:'AUDIO', index, extra_info}`. `extra_info` is a JSON string with `language`, `fourCC`, `channels`, `bit_rate`. The label can be built the same way. `getCurrentStreamInfo()` gives the selected track. | **Can** |
| Select an audio track | ExoEngine.java:142-151 | `setSelectTrack('AUDIO', index)` (in READY/PLAYING/PAUSED) | **Can** |
| List and select embedded subtitle tracks | ExoEngine.java:109-165; VlcEngine.java:187-211 | `getTotalTrackInfo()` type `'TEXT'` (extra_info has `track_lang`, `subtitle_type`); `setSelectTrack('TEXT', index)`. Depends on the container (works for MKV/MP4 embedded and HLS WebVTT on most models; MPEG-TS DVB-sub/teletext support varies by model). | **Partly** |
| Subtitles Off | ExoEngine.java:153-157 | `setSilentSubtitle(true)` and stop drawing | **Can** |
| Subtitle rendering + style (size 4.5/5.6/6.8/8.5% of height, 6 colours, drop shadow or background at 25-100% opacity, bottom padding 7%, SemiBold) | ExoEngine.java:167-179; PlayerActivity.java:40-44 | AVPlay does not draw subtitles on the video plane. The app receives `onsubtitlechange(duration, text, type, attrs)` and must render the text in an HTML overlay. Styling is therefore fully in CSS: font-size = SUB_SIZES × 1080px, colour, `text-shadow` vs `background: rgba(0,0,0,α)`, bottom 7%. | **Can** (must implement the renderer) |
| Preferred subtitle/audio language at start, "off" honoured | ExoEngine.java:42-47; VlcEngine.java:216-218 | After `prepareAsync` success: read `getTotalTrackInfo()`, `setSelectTrack` for the matching language, `setSilentSubtitle(true)` for "off" | **Can** |
| Audio delay ±5 s in 100 ms steps | VlcEngine.java:135-138; PlayerActivity.java:858-899 | No AVPlay API to offset audio against video. There is no supported streaming property for it. | **Cannot.** Hide the Audio Sync section on Tizen, or show it disabled with a note. |
| Engine switch Exo⇄VLC, per-item remembered choice, "Video Player" setting, "Remembered Player Choices" | PlayerActivity.java:410-450, 830-849; Prefs.java:222-264 | Single engine | **Cannot** (N/A). Drop the PLAYER panel section, the Video Player row and Remembered Player Choices, or keep inert rows. Map the engine-fallback rung of the retry ladder to "close + reopen". |
| Freeze detection by frames-rendered counter + fps | ExoEngine.java:181-192; PlayerActivity.java:613-639 | No frame counter. Proxy: `oncurrentplaytime` stops advancing for 3 s while `getState()==='PLAYING'` and not inside `onbufferingstart`…`onbufferingcomplete`. | **Partly** (heuristic) |
| Auto-recover: live reload, VOD re-seek to the same position, max 4 | PlayerActivity.java:634-638 | `stop()`/`close()`/`open()`/`prepareAsync()` for live; `seekTo(getCurrentTime())` for VOD | **Can** |
| Retry on error ×2 at 1.5 s, behind-live-window reset | PlayerActivity.java:505-518; ExoEngine.java:94-97 | `onerror` / prepare-error callback → close and reopen after 1500 ms | **Can** |
| Live .ts⇄.m3u8 fallback | PlayerActivity.java:519-525 | Already done once (player.js:58-67) | **Can** (already partly) |
| Detect unsupported audio (DTS on Exo) → switch to VLC | ExoEngine.java:132-140; PlayerActivity.java:493-503 | `getTotalTrackInfo` fourCC shows DTS/TrueHD, but there is no second decoder. Many Samsung models do not decode DTS. | **Partly**: can detect and warn ("This sound format isn't supported by this TV") and offer another audio track; cannot fix it. |
| Buffering spinner | Engine.Listener.onBuffering | `onbufferingstart` / `onbufferingprogress(%)` / `onbufferingcomplete` | **Can** |
| Buffered position on the seek bar | ExoEngine.java:106 | No buffered-position API (VLC on Android also returns the position) | **Cannot** (omit the buffered segment, like Android on VLC) |
| Duration / position / seek | Engine | `getDuration()`, `getCurrentTime()`, `seekTo(ms, ok, err)`; `jumpForward` / `jumpBackward` also exist | **Can** |
| Start-time resume | ExoEngine.java:89; VlcEngine.java:105 | `seekTo` after prepare (done, player.js:51) | **Can** |
| Aspect mode | Android has no user aspect modes. Exo PlayerView default fit; VLC `SURFACE_BEST_FIT` (VlcEngine.java:86) | `setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX')` (or AUTO_ASPECT_RATIO) | **Can.** Set LETTER_BOX for parity (Tizen currently never calls it). Do not add an aspect menu. |
| Playback speed | Android has none | `setSpeed` exists; Tizen exposes `setRate` (player.js:90), unused | N/A; do not expose |
| User agent | PlayerFactory.java:28-32; VlcEngine.java:100 | `setStreamingProperty('USER_AGENT', ua)` after `open()`, before prepare (done, player.js:49) | **Can** |
| Fast-start preview buffer (300 ms) for the Live TV preview | PlayerFactory.java:39-43 | `setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', n)` / `setTimeoutForBuffering` | **Partly** (preview is scope A) |
| Keep the screen on | PlayerActivity.java:124 | `webapis.appcommon.setScreenSaver(SCREEN_SAVER_OFF)` during playback | **Can** (not done) |
| Volume / mute for preview | Engine.setVolume | AVPlay has no per-player volume; `tvaudiocontrol.setMute` is global | **Partly** (scope A preview "muted" mode) |

Other notes:
- **Long-press OK on Tizen.** Keydown auto-repeats with `e.repeat` and keyup fires, so the Android 450 ms hold logic ports directly. It needs a `keyup` listener in app.js, which is missing today. Register `MediaPlayPause` (10252), `MediaPlay` (415), `MediaPause` (19), `MediaRewind` (412), `MediaFastForward` (417), `ChannelUp` (427), `ChannelDown` (428) and `Info` (457). nav.js:9-10 registers most of them but not Info, and the player views ignore them.
- `KEY_MENU = 10133` (search.js:11 etc.) should be verified on a device. Samsung Smart Remotes generally lack a Menu key, so every ☰ action must also work by holding OK, exactly as Android's non-Fire-TV path does (Ui.java:64-70).
- **Phone link on Tizen.** A web app has no listening-socket API. Parity needs one of: (a) a Tizen web service app with a native HTTP server (partner privilege), or (b) a tiny relay where the TV polls a one-time code. Otherwise show the Android form fields only on the TV.
- **Trailers.** The Android embed needs no key: youtube-nocookie iframe in a full-screen overlay, or `tizen.application.launchAppControl` for the YouTube app (`111299001912`). Tizen's `hasYoutube()` gate (keys.js) is unnecessary.

## 5. SETTINGS / PREFS PARITY TABLE

| Prefs key | Android default | Android UI that exposes it | In js/store.js? | Exposed in Tizen UI? |
|---|---|---|---|---|
| `accounts` (JSON list id/name/server/user/pass/ua/ok) | `[]` | Login, Settings ACCOUNTS (Prefs.java:65-112) | Yes (store.js:36-74) | Partly: Settings/Setup list. The **name** field is never edited (login.js has no name input). |
| `current` | first account | Settings → Switch (Prefs.java:94-102) | Yes (store.js:56-63) | Yes ("Use") |
| legacy `server` / `user` / `pass` / `ua` / `ok` | — | migration only (Prefs.java:72-83) | Yes (store.js:39-49) | — |
| account `ua` | "" → DEFAULT_UA `XtreamPlayer/1.0 (Linux; Android; Fire TV)` | Settings → User Agent dialog (Prefs.java:22, 161-172) | Yes (store.js:5, 108-118) | Yes, as a raw text input; no Default button or hint. Also on the login form. |
| `live_format` | `ts` | Settings → Live Stream Format "MPEG-TS"/"HLS" (Prefs.java:177-178) | Yes (store.js:122-123) | Yes, but labelled "TS" |
| `sub_size` | 1 (Medium); 0-3 | Settings → Size; player SUBTITLE SIZE (Prefs.java:198-199) | Yes (store.js:125-126) | Yes, but only 0-2 |
| `sub_color` | 0 (White); 0-5 | Settings → Colour (Prefs.java:201-202) | Yes (store.js:127-128) | Yes, but with wrong names/order (settings.js:7) |
| `sub_bg` | false | Settings → Background (Prefs.java:204-205) | Yes (store.js:129-130) | Yes |
| `sub_bg_opacity` | 2 (75%) | Settings → Background Opacity (Prefs.java:208-209) | Yes (store.js:132-133) | Yes |
| `sub_lang` | "" ("off" = no subs) | set by picking in the player (PlayerActivity.java:787, 796) | Yes (store.js:135-136) | As a free-text input (not in Android); never applied by player.js |
| `audio_lang` | "" | set by picking in the player (PlayerActivity.java:809) | Yes (store.js:137-138) | As a free-text input (not in Android); never applied |
| `{ns}adelay_{type}_{id}` / `{ns}adelay_series_{parentId}` | 0 (removed when 0) | Player → AUDIO SYNC (Prefs.java:185-196) | **No** | No (cannot work on AVPlay; §4) |
| `auto_recover` | true | Settings → Fix Frozen Video Automatically (Prefs.java:218-219) | Yes (store.js:140-141) | **No** (read only by player.js:60) |
| `engine` | 0 (Automatic); 0-2 | Settings → Video Player (Prefs.java:222-223) | **No** | No (N/A) |
| `{ns}vlc_items` / `{ns}exo_items` (string sets, also `series:{id}`) | empty | Player → PLAYER rows; Settings → Remembered Player Choices (Prefs.java:229-257) | **No** | No (N/A) |
| `vlc_broken` / `vlc_broken_notice` / `vlc_in_flight` / `vlc_crashes` | false / false / false / 0 | Settings → Video Player retry text (Prefs.java:264-272; VlcHolder.java:48; VlcEngine.java:45) | **No** | No (N/A) |
| `dark` | true | Settings → Theme Dark/Light (Prefs.java:274-275) | Yes (store.js:142-143) | Toggle exists ("Dark theme"), but nothing applies a light theme |
| `preview` | 2 (On with sound) | Settings → Live TV Preview (Prefs.java:278-279) | Yes (store.js:145-146) | Yes, with different labels |
| `refresh_hours` | 12 (cycle 12, 24, 6, 0, −1) | Settings → Refresh Automatically (Prefs.java:282-283) | Yes (store.js:148-149) | Yes, with different order/labels |
| `{ns}lib_time` | 0 | Settings → Refresh Now value (Prefs.java:285-286) | Yes (store.js:151-152) | **No** (no Refresh Now row) |
| `home_{key}` (9 keys) | true | Settings → Customise Home Screen (Prefs.java:364-372) | Yes (store.js:6-13, 188-189) | Yes; Top 10 rows hidden without TMDB, names differ |
| `{ns}fav_{type}` | `[]` | detail pages Favourite button; player Favourites row; ☰/hold OK (Prefs.java:293-336) | Yes (store.js:156-171) | Partly: movie detail and search only. No series-detail button, no player toggle. |
| `{ns}favcat_{type}` | `[]` | browse screens (scope A) (Prefs.java:340-359) | Yes (store.js:173-184) | (scope A) |
| `{ns}pos_{key}` | 0 | written by the player (resume rules 10 s / end−60 s); read by detail buttons (Prefs.java:376-381) | Yes (store.js:193-197) | Yes, but with different thresholds (§3 #24, #30) |
| `{ns}dur_{key}` | 0 | written by the player; episode "M:SS left" (Prefs.java:383-387) | Yes (store.js:199-202) | Yes |
| `{ns}hist_live` / `{ns}hist_vod` (max 40) | `[]` | player addHistory; series "Resume S·E"; Settings → Clear Watch History (Prefs.java:391-447) | Yes, add/get (store.js:206-214); **no clearHistory** | No clear row; series detail ignores history |
| Filters (hidden tags / categories) | none hidden | Settings → Hide What You Don't Watch (FilterSettings.java:24-35) | **No** | No |
| Coach "seen" flags | unseen | Settings → Show Tutorial (Coach) | **No** | No |
| `updater` prefs `checked` / `later` / `later_at` | 0 | Updater dialogs (Updater.java:66-86, 143) | **No** | No (N/A for store installs) |
