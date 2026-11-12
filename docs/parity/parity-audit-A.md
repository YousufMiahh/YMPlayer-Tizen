# Parity audit A: app shell, Home and Browse (Android YM Player vs Tizen port)

Android root: `XtreamPlayer/app/src/main/java/com/xtreamplayer/tv/` (paths below are relative to it)
Tizen root: `/home/claude/YMPlayer-Tizen/`
Android is the source of truth. All Android file:line references are real line numbers in the named file.

---

## 1. ANDROID DESIGN SYSTEM

### 1.0 Units / density (read this first)
- `Ui.unit()` (Ui.java:103-110): `unit = min(screenW/1920, screenH/1080) * 1.4`. Every `Ui.dp(v)` and `Ui.sp(v)` is `v * unit` **real pixels**.
- On a 1920x1080 panel, **1 design unit = 1.4 px**. The Tizen app uses `<meta name="viewport" content="width=1920">` (index.html:5), so 1 CSS px = 1 panel px. **Every Android number below must be multiplied by 1.4 to get Tizen CSS px.** The px value is shown in brackets.
- Fire TV lays out at 960x540 dp, which is why Android uses its own unit and not Android dp. Do not use 2x or 1.5x.
- Text: `Ui.text()` sets `lineSpacing(0, 1.15)` and `includeFontPadding=false` (Ui.java:176-186), so CSS `line-height: 1.15`. `Ui.title()` is Inter Bold with `letterSpacing -0.02em` (Ui.java:194-199).
- Fonts are Inter Regular/Medium/SemiBold/Bold from assets (Ui.java:78-82). Tizen already ships the same TTFs (css/theme.css:1-4).

### 1.1 Colours (Ui.java:27-55)
| Token | Dark (default) | Light |
|---|---|---|
| BG | `#0A0B12` | `#F2F2F7` |
| BG_TOP | `#1C2040` | `#FFFFFF` |
| SURFACE | `#FFFFFF` @ 0x1A (10%) | `#000000` @ 0x12 (7%) |
| SURFACE_HI | white @ 0x2E (18%) | black @ 0x21 (13%) |
| SURFACE_LO | white @ 0x12 (7%) | black @ 0x0A (4%) |
| SHEET | `#1C1C22` @ 0xF2 | `#F7F7FA` @ 0xF5 |
| TEXT | `#FFFFFF` | `#000000` |
| TEXT2 | `#EBEBF5` @ 0x99 (60%) | `#3C3C43` @ 0x99 |
| TEXT3 | `#EBEBF5` @ 0x4D (30%) | `#3C3C43` @ 0x5C (36%) |
| FOCUS_BG | `#FFFFFF` | `#1D1D1F` |
| ON_FOCUS | `#0B0B0F` | `#FFFFFF` |
| ON_FOCUS2 | `#0B0B0F` @ 0xB3 (70%) | `#FFFFFF` @ 0xB3 |
| ACCENT (both) | `#0A84FF` (used only for the EPG "now" line, EpgGrid.java:~329) | |
| RED | `#FF453A` | |
| W1/W2/W3 (over video) | `#FFFFFF`, `#EBEBF5`@60%, `#EBEBF5`@40% | |
- Card focus ring: 4 units [5.6px] stroke, white in dark, FOCUS_BG in light (Ui.java:131-137).
- Progress bar: track white @ 0x59 (35%), fill solid white, radius 3 [4.2px] (Cards.java:93-105).
- Channel-logo backing in the Live info panel: `#24252C` dark / `#E6E6EB` light (BrowseActivity.java:272).
- Theme is chosen by `Prefs.darkTheme()` (default dark) and applied app-wide in `Ui.init` (Ui.java:74-76).

### 1.2 Background treatment: Ambient (Ambient.java, used by every screen in scope)
- The window background is a **4-stop vertical gradient**: `[tone, mix(tone,BG,0.45), mix(tone,BG,0.85), BG]` (Ambient.java:104-106). There is no blur and no backdrop image. It is a colour glow only.
- Resting tone per section (Ambient.java:21-22): HOME `#2A2F7A`, LIVE `#0F5C66`, MOVIES `#6A1F4A`, SERIES `#1F4E8C`, SEARCH `#4A2A80`, SETTINGS `#3A3F52`.
- `tone()` (Ambient.java:109-124): if the colour's saturation is below 0.12, use hue 228 and saturation 0.30. Dark theme: S = clamp(max(S*1.25, 0.35), 0.35, 0.85), V = 0.46. Light theme: S = clamp(S*0.55, 0.10, 0.32), V = 0.97.
- **Focusing any card or row re-tints the background** to the dominant colour of its artwork (`Ambient.tint`, called from Cards.java:85 and BrowseActivity.java:415, 1158). The tint is an ARGB cross-fade over **700 ms** (Ambient.java:91-101).
- Dominant colour (ImageLoader.java:56-86): the image is scaled to 12x12. Pixels with alpha < 128 are skipped. Pixels with S < 0.18 or V < 0.12 are skipped. The rest are weighted by S*V. If nothing is left, it falls back to the plain average, then to `#3A3F52`. Results are cached in an LRU of 600.
- Hand-off: when you switch section, the new screen starts from the previous screen's current colour and fades to its own (Ambient.java:34-65; TopBar.go/back call `handOff`).

### 1.3 Motion
- Generic focus lift `Ui.animateFocus` (Ui.java:265-269): scale to S plus translationZ 14 [~20px shadow], **180 ms, DecelerateInterpolator(1.6)**. Scale values: home cards 1.08 (Cards.java:83), grid posters 1.09 (Adapters.java:199-201), buttons 1.06 (Ui.java:230).
- Top-bar highlight glide: 280 ms, Decelerate(2). Appears with alpha 0→1 and scale 0.92→1 in 180 ms. Disappears with alpha→0 and scale→0.92 in 160 ms (TopBar.java:242-284, 145-159).
- Section switch: the page fades in and slides 64 [90px] from the side you moved towards. **420 ms, start delay 60 ms, Decelerate(2)** (TopBar.java:334-346). The bar itself does not move.
- List-row highlight ("Glider"): one white pill behind the list glides **240 ms Decelerate(2)**. Fades in/out in 140 ms (Glider.java:206-253). Used on the category list (Movies/Series/Live) and the channel list (Live).
- Row cell without a glider: the background fades in, alpha 60→255 over 160 ms (Adapters.java:131-146).
- Category change: the content area fades in and slides 56 [78px] in Y in the direction you moved through the list, 380 ms Decelerate(2). The header slides half that distance in 320 ms. The count fades in after 80 ms (BrowseActivity.java:679-696).
- Live layout morph: ChangeBounds 420 ms Decelerate(2.2). Fade-ins 320 ms, fade-outs 220 ms (BrowseActivity.java:999-1015, 1083-1096).
- Category hint fades with alpha 0↔1 in 180 ms when the category list gains/loses focus (BrowseActivity.java:119).

### 1.4 Components (units, with [px at 1920x1080])
**Buttons** (Ui.java:214-232): semibold 18 [25.2px]. Pill background SURFACE_HI, radius 12 [16.8]. Focused: FOCUS_BG background and ON_FOCUS text. Padding 28x14 [39x19.6]. Lift 1.06.
**Inputs** (Ui.java:234-248): medium 19 [26.6]. Pill background SURFACE, radius 12. Padding L20/R16/V16 [28/22/22]. Hint colour TEXT3. Focused: white pill with dark text.

**Top bar** (TopBar.java:59-212):
- Bar padding L/R 64 [90], top 28 [39], bottom 8 [11].
- Left: brand text **"YM"**, Inter Bold 22 [30.8], TEXT, vertically centred (TopBar.java:65-67).
- Centre: a rounded track, background SURFACE_LO, radius 28 [39], padding 6 [8.4] (TopBar.java:70-73). It holds a gliding pill (FOCUS_BG, radius 22 [30.8], elevation 6) and the tab labels drawn above it.
- Tabs **"Home", "Live TV", "Movies", "Series", "Search", "Settings"** (TopBar.java:30-33). Each tab is medium 17 [23.8], padding 22x11 [31x15], side margins 2 [3] (TopBar.java:93-104, 130-132).
  - Current tab: semibold, TEXT colour, with a soft SURFACE_HI pill (radius 22) when not focused.
  - Other tabs: medium, TEXT2.
  - Focused tab: ON_FOCUS text over the gliding white pill.
- Right: clock "HH:mm" (UK locale, 24 h), medium 20 [28], TEXT2, refreshed every 15 s (TopBar.java:198-210).

**Home shelf** (Cards.java:165-230):
- Title: Inter SemiBold 22 [30.8], TEXT2, padding L64 [90] / T18 [25] / B6 [8.4] (Cards.java:171-174).
- Horizontal scroller, no scrollbar, clipping off so focused cards can grow past the edges.
- Row padding L/R 64 [90], T/B 22 [31] (Cards.java:185-186). Gap between cards 32 [44.8] (Cards.java:204).

**Home card** (Cards.java:32-90):
| Shape | Size (units) | px | Ratio | Image fit |
|---|---|---|---|---|
| POSTER (movies/series) | 160x240 | 224x336 | 2:3 | cover |
| CHANNEL (live) | 220x124 | 308x174 | ~16:9 | contain, inner padding 22 [31] |
| LANDSCAPE (Continue Watching) | 300x169 | 420x237 | 16:9 | cover |
- Art box: background SURFACE, radius 14 [19.6], clipped, elevation 3 (Cards.java:45-47).
- Missing image on CHANNEL/LANDSCAPE: initials (first letter of the first two words, uppercase), Bold 30 [42], TEXT3, centred (Cards.java:57-62, 280-288). POSTER shows an empty surface.
- Progress (LANDSCAPE only): bar 5 [7] high, inset 12 [17] from the left, right and bottom (Cards.java:63-68).
- Title: medium 16 [22.4], one line with ellipsis, TEXT2, padding T12 [17] L2 [3] (Cards.java:74-76).
- Subtitle (optional): regular 14 [19.6], TEXT3, padding T4 [5.6] (Cards.java:77-79).
- Focused: scale 1.08, 14-unit shadow, 4-unit white ring over the art (radius 14). Title turns TEXT, subtitle turns TEXT2. Background tints to the artwork (Cards.java:81-89).

**List row (RowCell)** (Adapters.java:71-161):
- Padding horizontal 18 [25.2], vertical 14 [19.6].
- Optional number: medium 16 [22.4], min width 44 [61.6], TEXT2.
- Optional logo box: 72x44 [101x62], SURFACE background, radius 8 [11.2], contain, inner padding 5 [7], right margin 16 [22.4].
- Title: medium 19 [26.6], TEXT, one line. Subtitle: 14 [19.6], TEXT2, top padding 4. Trailing text: medium 16 [22.4], TEXT2, left padding 10 [14].
- States:
  - hot (focused): FOCUS_BG radius 12 [16.8] (or clear while the glider pill is behind it). Title ON_FOCUS semibold, sub/num ON_FOCUS2, trail ON_FOCUS.
  - active (current category or playing channel): SURFACE_HI radius 12, title semibold.
- Row gap (list divider): 2 [2.8].

**Poster grid cell** (Adapters.java:164-208, 281-301):
- Cell padding 12 [16.8]. Image **150x225 [210x315]**, cover, SURFACE background, radius 12 [16.8], elevation 2.
- Title: regular 15 [21], TEXT2, **up to 2 lines**, centred, top padding 10 [14]. Favourites are prefixed **"♥ "** (Adapters.java:296).
- Focused: 4-unit white ring (radius 12), title TEXT semibold, scale **1.09**, 14 z-lift.
- Grid: `AUTO_FIT`, column width 178 [249], `STRETCH_SPACING_UNIFORM`, vertical spacing 10 [14], padding T10 [14] B30 [42] (BrowseActivity.java:195-201).

**Live info panel** (BrowseActivity.java:260-325):
- Width 400 [560], left margin 36 [50]. Background SURFACE, radius 22 [30.8], padding 28 [39].
- Preview/logo box: full width, height 194 [272], background SURFACE_LO, radius 16 [22.4], clipped. Logo is contained with padding 26 [36] over `#24252C`.
- Channel name: Bold 26 [36.4], 2 lines, padding T22 [31] B20 [28].
- "NOW": medium 13 [18.2], TEXT3, letter-spacing 0.12em. Now title: semibold 20 [28], 2 lines, padding T6 B8.
- Time row: time range (medium 15 [21], TEXT2) plus a progress bar 4 [5.6] high, left margin 14, filling the rest.
- Description: 15 [21], TEXT2, 4 lines, padding T12 [17] B22 [31].
- "UP NEXT": medium 13 [18.2], TEXT3, spacing 0.12. Next: medium 17 [23.8], TEXT2, 2 lines.
- Spacer, then a hint at the bottom: 14 [19.6], TEXT3.

**Coach overlay** (Coach.java:243-301, 399-407):
- Dim layer `#000000` @ 0xD9 (85%) with a rounded "hole" cut over the target. Hole padding 10 [14], radius 18 [25], with a 3 [4.2] white ring.
- Caption card: width 620 [868]. Background `#1C1C22` dark / `#FFFFFF` light, radius 22 [31], padding 28 [39], elevation 12.
- Card content: counter "TIP 1 OF 3" (medium 14 [19.6], TEXT3, letter-spacing 0.08); title Bold 26 [36.4] (padding T6 B8); body 18 [25.2] with line spacing 1.3; hint medium 15 [21], TEXT2, top padding 18.
- Motion: overlay fades in 250 ms and out 200 ms. The hole morphs over 380 ms. The card fades in and rises 12 [17] over 280 ms after a 120 ms delay.
- Placement: below the hole if it fits, else above, else beside it. The card is always kept on screen.

**Splash** (SplashActivity.java:39-73):
- Centred column: logo.png 190x190 [266], elevation 18.
- "YM Player": Bold 40 [56], padding T30 [42] B8 [11].
- "Developed by Yousuf Miah": medium 18 [25.2], TEXT2.

**Next-up card** (NextUpCard.java; used by the player, listed for completeness):
- "Watch credits": semibold 20 [28], height 60 [84], padding 28 [39]. Background white @ 35%, white when focused with black text. Radius 6 [8.4].
- "▶ Next Episode" fill button: 250x60 [350x84], left margin 16. Background white @ 35%; a white fill sweeps across over 10 s (linear). The label is black over the filled part and white over the rest. 3 [4.2] white ring when focused. Scale 1.05 on focus over 150 ms.
- The countdown pauses with the video. When it ends, the next episode plays.

### 1.5 Light vs dark
Only the tokens in 1.1 change, plus the Ambient `tone()` branch and the Coach card colour. Layout is the same in both themes.

---

## 2. ANDROID SCREEN-BY-SCREEN SPEC

### 2.1 Splash (SplashActivity.java)
1. Background: Ambient HOME gradient. A centred column: logo → "YM Player" → "Developed by Yousuf Miah".
2. Animation:
   - logo: alpha 0→1, scale 0.86→1, 520 ms, Decelerate(2)
   - name: alpha 0→1, translateY 14 [19.6]→0, 180 ms delay, 450 ms
   - credit: alpha 0→1, 380 ms delay, 450 ms (lines 64-73)
3. While the splash shows: if there is an account and a saved library, it warms the Live streams and all three category lists from disk (lines 77-97).
4. It leaves after the later of 1400 ms and the library warm-up, but never later than 6000 ms (lines 19, 98-104). It goes to LoginActivity with a fade (LoginActivity forwards to Home if signed in, or to Setup if the library isn't ready, LoginActivity.java:56). The splash is finished, so it is **not on the back stack**.
5. Back is ignored on the splash (lines 108-110).

### 2.2 App shell / top bar navigation (TopBar.java)
- Every section screen (Home, Live TV, Movies, Series, Search, Settings) has the same top bar at the top. Content sits below it.
- **Hover-to-open:** resting on a tab for **450 ms** opens that section. Settings is the exception and needs OK (TopBar.java:116-129).
- **OK on a tab** opens it. OK on the tab you are already on calls `onTabReselected` (TopBar.java:106-114). Browse uses this to jump to the top category (Search) (BrowseActivity.java:558-566). Search uses it to open the keyboard.
- **Up from the page** always lands on the **current section's tab**, never the tab that happens to be above (TabRow.addFocusables, TopBar.java:218-239).
- **Down from the bar:** on Browse it goes to the top of the categories (Search) (BrowseActivity.java:869-873). On Home it uses normal focus search to reach the first row.
- Stack model: Home is always at the bottom. Going to a non-Home section from Home pushes it. Going from one non-Home section to another replaces the current screen. Going to Home finishes the current screen (TopBar.java:354-378). **Back from any section returns to Home** with a slide in from the left (TopBar.java:325-331). Back on Home exits the app (HomeActivity has no onBackPressed override).
- The highlight glides between tabs. When moving by hover it carries on from where it was on the previous screen (`lastX/lastW`, `glideHandoff`). It fades out when focus leaves the bar. A sync pass after 320 ms keeps the pill under the focused tab (TopBar.java:145-196).
- Page transition: see 1.3. When coming back to Home, `onHomeResumed` animates Home's rows in and refocuses the Home tab if you came by hover (TopBar.java:310-322).

### 2.3 Home (HomeActivity.java)
**Element tree (top to bottom), one vertical ScrollView, bottom padding 48 [67]:**
1. Top bar (current = Home).
2. Local rows (built synchronously from saved data), in this order (HomeActivity.java:272-285):
   1. **"Continue Watching"**: LANDSCAPE cards. Source: `prefs.continueWatching()`, i.e. VOD history (movies and episodes, newest first, max 40) with a saved position > 0 (Prefs.java:413-417).
      - The title carries a hint in TEXT3 at 15/22 size after a 6-space gap: Fire TV shows **"☰  to remove from list"** with a drawn three-line glyph; other remotes show **"Hold OK to remove from list"** (Cards.java:236-261).
      - Card subtitle for episodes: `"<series name>  ·  <N> left"`. For movies: `"<N> left"`. N comes from `SeriesActivity.fmt(dur-pos)`. An episode with no image uses the series image (Cards.java:191-201).
      - The progress bar shows pos/dur.
   2. **"Recent Channels"**: CHANNEL cards, `history(true)` limited to **20** (line 280).
   3. **"Favourite Channels"**: CHANNEL cards, `favs(live)`, in the order they were added.
   4. **"Favourite Movies"**: POSTER.
   5. **"Favourite Series"**: POSTER.
3. Remote rows (async) (HomeActivity.java:287-294):
   1. **"Top 10 Movies on Netflix UK"**: POSTER, matched to your library (see 5.4).
   2. **"Top 10 Series on Netflix UK"**: POSTER.
   3. **"Recently Added Movies"**: POSTER. Takes the newest 300 by `added`, removes hidden categories and countries, keeps 24 (lines 312-315).
   4. **"Recently Added Series"**: same rule.
   - Each row shows only when its Settings toggle is on (`homeShows(key)`, all on by default, keys in Prefs.java:364-365) and it is not empty.
4. Empty/status text: 18 [25.2], TEXT2, centred, top padding 80 [112]:
   - First run with no saved library: **"Getting your channels, movies and series ready…\nThis only takes a while the first time."** (line 149)
   - Nothing to show: **"Welcome to YM Player\nPick Live TV, Movies or Series above to get started."** (line 303)

**Behaviour:**
- On open, focus goes to the **first card of the first row**, not the top bar (lines 389-400). After async rows load, focus moves to the first card only if nothing was focused or focus was inside the remote rows.
- Pick (OK) goes through `Open.item` (Open.java:12-42):
  - Movie → Movie details screen. This includes Continue Watching movies: they open the **details** screen, not the player.
  - Series → Series screen.
  - Episode (Continue Watching) → player directly with a one-item queue.
  - Live → full-screen player with a zap queue. The queue is the Recent list if the channel is in it, otherwise the Favourite Channels list (lines 193-204). Index is found by key.
- **Long OK / ☰ (Menu)** on a card:
  - Continue Watching: dialog **"Remove from Continue Watching?"**. Message is the item name (or `"Series · Episode"`). Buttons **"Remove"** / **"Cancel"**, with **Cancel focused by default**. Remove clears the resume position (lines 215-235).
  - Any other row: toggle favourite. Episodes are ignored. Toast: **"Added to Favourites — <name>"** / **"Removed from Favourites — <name>"** (Open.java:47-50). Rows rebuild, and focus stays on the same shelf (by title) and index, or the shelf that moved into its place (lines 238-270).
- Resume: local and remote rows rebuild (history and favourites may have changed). Focus resets to the first card if it was inside the local rows.
- Library: see 5.1. `Repo.onUpdated` reloads Recently Added and Top 10 when a background refresh finishes (lines 138-172).
- Top 10: checked when Home starts and then **hourly while Home is visible** (lines 24-30, 376-387). Rows only rebuild if the matched list changed (signature compare, lines 356-373).
- Coach: 1.5 s after opening, `Coach.offer` runs (first launch only). It shows dialog **"Welcome to YM Player"** / *"Would you like a quick tour of the basics? It takes about a minute, and you can skip it at any time with Back.\n\nYou can always watch it later from Settings."* with buttons **"Show me"** / **"No thanks"** (Coach.java:51-69). The Home tour has 3 steps (HomeActivity.java:91-102):
  1. top bar, "Getting around": "Move along the top bar to switch between Home, Live TV, Movies, Series, Search and Settings. Just pause on one and it opens."
  2. first row, "Your Home screen": "Continue Watching, Recent Channels, your favourites and the UK Top 10 all live here. Hold OK on a card to favourite it, or to remove it from Continue Watching." (Fire TV: "Press ☰ (or hold OK)")
  3. centred, "Make it yours": "In Settings you can choose which rows Home shows, hide countries and categories you never watch, change subtitle style and switch accounts. You can watch this tour again from Settings too."
  - Coach keys: OK / Enter / ▶ → next tip. Back → skip. The last tip's hint reads "OK  Done". Each screen's tour is shown once, only while the tutorial is on.
- Crash/VLC notice dialog on launch (lines 105-135). Strings: "Sorry about that" / "YM Player closed unexpectedly last time. Here's the error report — a photo of it helps fix the problem." with "OK" and "Show error report" (monospace 12 in a scroll view). VLC variant: "Switched to the Android player".
- Update check (GitHub) 3 s after launch if no tour is showing (lines 81-85).

### 2.4 Browse: shared structure (BrowseActivity.java), Movies and Series
**Tree:** top bar, then a horizontal row with padding L/R 48 [67], T16 [22], B24 [34]:
- **Category column**, 300 [420] wide (line 156):
  - The category list with a gliding highlight (Glider), padding 4/8. Rows are plain RowCells (no number, no logo). Trailing text shows `♥` for pinned favourite categories.
  - Under the list, a centred hint, alpha 0, shown only while the list has focus (lines 149-154):
    - Fire TV: **"Hold OK  ♥ Favourite      ☰  Hide"**
    - Others: **"Hold OK  Favourite or hide"**
- **Content column**, padding-left 36 [50] (lines 159-222):
  - A header (category name, Bold 34, plus "N items" count) exists but is **hidden** (`GONE`, line 172).
  - Search box, only visible while the Search category is chosen.
  - Content frame: the poster grid (Movies/Series) or channel list (Live), with an empty-text overlay (19 [26.6], TEXT2, centred) and a 48 [67] spinner.

**Category list content and order** (lines 459-477):
1. **"Search"**
2. **"Favourite Channels" / "Favourite Movies" / "Favourite Series"**
3. Live: **"Recent Channels"**. Movies/Series: **"Continue Watching"**
4. Live: **"All Channels"**. Movies/Series: **"All"**
5. Your favourite categories, pinned in the order you favourited them, each with trailing **"♥"**
6. The provider's remaining categories, in provider order, **with hidden categories and countries removed** (Filters.categories)

**Initial state** (lines 424-451):
- The list is selected at row 0 (Search). **Nothing is marked active** until you pick a category yourself (`hideActive`).
- The category shown on the right on arrival is:
  - Favourites, if you have any
  - else Recent/Continue, if not empty
  - else the first provider category (index 4)
  - else All (index 3)
- Focus goes into the category list unless you arrived by hovering the tab, in which case the tab keeps focus.
- 600 ms later the section tour runs, if due.

**Category behaviour:**
- Moving through the list: **350 ms after the selection stops**, that category opens on the right. Landing on Search does nothing until OK/▶ (lines 379-385, 622-633). From then on, the current category is marked (SURFACE_HI) whenever the bar isn't focused.
- OK → open the category and move focus to its first item. On Search: show the box and open the keyboard (lines 396-402, 535-549, 648-652).
- ▶ → same as OK. If the category is already open it just jumps to item 0 (lines 853-868).
- Long OK:
  - Fire TV: toggle favourite category, with toast "Added to favourite categories — <name>" / "Removed from favourite categories — <name>".
  - Other remotes: dialog titled with the category name, items **"♡  Favourite"** (or **"♥  Remove from favourites"**) and **"Hide"** (lines 387-395, 506-521, 603-620).
  - Pseudo categories (ids `__…`) ignore both.
- ☰ (Menu) → hide immediately. Toast **"Hidden: <name>  (Settings → Hidden Categories to bring it back)"**. Unfavourites it too. If it was open, "All" opens (lines 568-601, 810-813).
- While the top bar is focused, no category is marked, and the list scrolls back to the top (lines 125-134).

**Content behaviour:**
- Fetching shows the spinner. "All" = whole section, filtered. A provider category is filtered from the full cached list (Repo.streams).
- Special lists:
  - Favourites: `prefs.favs(type)`
  - Recent: `history(true)`
  - Continue (Movies): `continueMovies()`
  - Continue (Series): `continueSeries()`, one entry per series, built from episode history (Prefs.java:419-435)
- Empty text (lines 700-704):
  - Search, query under 2 characters: **"Type the name of a channel"** / **"…film"** / **"…series"**
  - Search, no hits: **"No results for "<q>""**
  - Favourites: **"No favourites yet\nHold OK on anything to add it."** (Fire TV: "No favourites yet\nPress ☰ or hold OK on anything to add it.")
  - Otherwise: **"Nothing here yet"**
  - Load error: **"Couldn't load this list\n<message>"**
  - Category error: **"Couldn't load categories\n<message>"**
  - Error messages come from `Async.message` (Async.java:44-51): "Can't find that server — check the URL", "The server took too long to answer", "Couldn't connect to the server", "Not enough memory for this list".
- OK on an item → `Open.item(item, wholeList)` (live zaps through the visible list) (lines 714-718).
- Long OK / ☰ → toggle favourite with toast. In the Favourites category the list is rebuilt in place and the selection kept (lines 720-733, 814-817).
- ◀ from the first grid column (or any channel row) → back to the categories, landing on the current category at its on-screen position (lines 885-908).
- Focusing an item re-tints the background (line 415).
- **Search category** (lines 175-183, 327-375):
  - Input placeholder **"Search all channels" / "Search all movies" / "Search all series"**, IME action "Search".
  - 300 ms debounce. Searches the **whole section** (not just one category). Self-hidden categories still appear in search; country/language-filtered ones don't (Filters.searchItems).
  - Ranked by `Match.rank`, max 300 results. The IME Search action moves focus to the first result.
- Back order (lines 821-842):
  1. coach skip
  2. guide → exit guide
  3. (Live, focus mode) → list mode
  4. search box → hide keyboard, go to categories
  5. content → categories
  6. otherwise → Home
- Resume: if hidden/country filters changed in Settings, categories reload (`Filters.version`). Special lists refresh (lines 910-922).
- Section tour (Movies/Series, `"vod"`, lines 495-502):
  1. "Categories": "Search this section at the top, then your favourites, Continue Watching and everything else. " + catTip
  2. "Pick something": "OK opens the details page, with Play, Resume, the trailer and Favourite. Hold OK here adds it to your favourites."
  - catTip, non-Fire: "Hold OK on a category to make it a favourite (it moves near the top with a ♥) or to hide it." (lines 524-528)

### 2.5 Browse: Live TV specifics
**Three layouts** (MODE_LIST=0, MODE_FOCUS=1, MODE_GUIDE=2) positioned absolutely in a stage (lines 994-1072). Values below assume stage width W=1920:
- **LIST (default):**
  - categories at x=48 [67], width 300 [420]
  - channel list at x=pad+cat+gap, width W−2·48−300−400−2·36 [≈705px]
  - info panel at the right, width 400 [560], full height
- **GUIDE** (▶ from the channel list, `enterGuide`):
  - categories fold off the left edge
  - the info panel becomes a full-width horizontal strip, height **38% of stage H**, with the preview at **16:9** on the left and the text column on the right (left margin 32)
  - the EPG grid fills the area below, lined up row for row with the channel list (same selected row and scroll)
  - a hint line along the bottom: **"OK  Watch        Hold OK  Full programme details        ▲▼  Channels        ◀ ▶  Programmes        Back  Channel list"** (Fire TV uses ☰ for "Hold OK")
- **FOCUS** (reachable in code; ▶ now jumps straight to GUIDE):
  - full-width info strip
  - label `"<category>      ◀  Categories      ▶  TV Guide"`
  - channel list below
- Focusing the category list always returns to LIST (line 118).
- Channel row (Adapters.Channels, lines 260-278):
  - number = provider `num`, else position+1
  - logo box 72x44, name
  - trailing **"♥"** if a favourite, **"▶"** for the playing channel (shown active)
- Info panel per selection (lines 744-806):
  - name and logo immediately
  - EPG fetched 400 ms after selection settles. NOW title, "HH:mm – HH:mm", progress bar, description (4 lines), UP NEXT `"HH:mm   <title>"`
  - no listings → "No guide information" in TEXT2
- Panel hint (lines 947-953):
  - list mode: **"▶  TV guide      Hold OK  Favourite"** (☰ on Fire TV)
  - guide mode: **"OK  Watch      Hold OK  Full programme details      ◀  Back to channels"**
- **Live preview** (lines 1186-1256):
  - starts **450 ms after you pause on a channel** in the list or guide, playing inside the logo box
  - volume: `previewMode` 0 = off, 1 = muted, **2 = with sound (default)** (Prefs.java:277-278)
  - when the player reports ready, the logo fades out (250 ms delay, 250 ms)
  - stops when the list loses focus (except when going into the guide); released on pause so the full-screen player gets the connection
  - an error stops the preview silently
- **TV guide (EpgGrid):**
  - header 44 [62], showing "EEE d MMM   HH:mm" and half-hour time marks
  - channel column 330 [462] (number, logo 64x40, name); row height matches the channel list
  - 2-hour window; cells gap 3, radius 10; highlighted cell FOCUS_BG, on-now cell SURFACE_HI, others SURFACE; a blue (#0A84FF) "now" line that repaints every 30 s
  - keys:
    - ▲/▼ and CH+/CH− move channels. ▲ on the first row goes to the top bar.
    - ▶ moves to the next programme (up to +24 h); the window scrolls in half-hour steps.
    - ◀ moves to the previous programme. ◀ on what's on now exits the guide.
    - OK (released) watches.
    - **Hold OK ≥450 ms**, ☰ or Info → programme details dialog. Title is the programme. Message: channel, time range, "On now, N min left" / "Starts in N min" / "Starts in H hr M min", description (or "No guide information for this time."). Buttons **"Watch <channel>"** / **"Close"** (lines 956-982).
  - highlight in the guide updates the info strip; "· later" is appended for future programmes; listings load lazily (`Guide.load`, 24 programmes per channel, cached 30 min).
- Live tour (`"live"`, lines 485-494), 4 steps:
  1. "Categories"
  2. "Channels": "Pause on a channel to see a live preview. OK watches it full screen. Hold OK on a channel to add it to your favourites."
  3. "What's on": "The preview, what's on now and what's on next."
  4. "The TV guide": "Press ▶ from the channel list to open the TV guide. ▲▼ moves through channels, ◀▶ through programmes, OK watches. ◀ on what's on now, or Back, takes you out again."

### 2.6 Remote key summary (scope A)
| Key | Top bar | Home card | Category list | Content | Guide |
|---|---|---|---|---|---|
| ◀▶ | move tab; dwell 450 ms opens | move | ▶ = open + focus first item | ◀ first col → categories; Live ▶ → guide | programmes / ◀-now exits |
| ▲▼ | ▼ → content / top category | move; ▲ → current tab | move (350 ms auto-open) | move; ▲ top → current tab | channels |
| OK | open / reselect | open | open + focus content | open/play | watch (on release) |
| Hold OK | – | fav / remove-CW dialog | Fire TV: fav category; others: Favourite/Hide dialog | toggle fav | details dialog |
| ☰ Menu | – | same as hold OK | hide category | toggle fav | details dialog |
| Back | → Home (or exit on Home) | exit app | → Home | → categories | exit guide |
| CH+/− | – | – | – | – | channel up/down |
| Play/Pause, numbers | not handled in these screens | | | | |

---

## 3. FEATURES IN ANDROID MISSING FROM TIZEN

1. **Persistent top tab bar on every section** (TopBar.java:59-212). Tizen has a button row only on Home and none on Live/Movies/Series (views/home.js:25-31, live.js:101-103, movies.js:83).
2. **"Home" tab and section model** (TopBar.java:30-33, 354-378). Tizen has no Home tab. Sections are pushed on a generic stack.
3. **Hover-to-open tabs after 450 ms** (TopBar.java:116-129).
4. **Gliding tab highlight with track and current-tab pill** (TopBar.java:70-81, 242-284).
5. **"YM" brand at the left of the bar** (TopBar.java:65-67).
6. **Clock "HH:mm" at the right of the bar, updated every 15 s** (TopBar.java:198-210).
7. **Up always lands on the current tab** (TopBar.java:218-239).
8. **OK on the current tab = reselect** (jump to the Search category) (TopBar.java:106-114, BrowseActivity.java:558-566).
9. **Section slide/fade transition, 64u / 420 ms** (TopBar.java:334-346).
10. **Ambient background gradient per section, plus re-tint from focused artwork** (Ambient.java:21-124; Cards.java:85; BrowseActivity.java:415). Tizen uses a flat `#0B0B0F`.
11. **Light theme**. Tizen saves `dark` (store.js:142-143) but nothing applies it (Ui.java:39-55).
12. **Card shapes per row: LANDSCAPE 300x169 for Continue Watching, CHANNEL 220x124 for live rows** (Cards.java:35-37, HomeActivity.java:276-283). Tizen uses a 200px 2:3 tile for everything.
13. **Continue Watching progress bar** (Cards.java:63-68, 93-105).
14. **Continue Watching subtitle "<series> · N left" / "N left"** (Cards.java:191-201).
15. **Initials placeholder for missing channel/landscape art** (Cards.java:57-62, 280-288).
16. **Continue Watching title hint "Hold OK to remove from list"** (Cards.java:236-261; HomeActivity.java:277).
17. **Remove-from-Continue-Watching dialog** ("Remove from Continue Watching?", Remove/Cancel, Cancel focused) (HomeActivity.java:215-235).
18. **Hold OK / ☰ on a Home card toggles favourite, with toast and focus kept in place** (HomeActivity.java:206-212, 238-270).
19. **Toasts** ("Added to Favourites — X", "Hidden: X  (Settings → …)", favourite-category toasts) (Open.java:47-50; BrowseActivity.java:578, 608). Tizen has no toast component at all.
20. **Top 10 Movies/Series on Netflix UK rows** (HomeActivity.java:289-290, 343-368; Top10.java). Tizen gates these on a TMDB key and has no data path even when a key exists (home-rows.js:18-19, 49).
21. **Hourly Top 10 re-check while Home is open, with signature compare** (HomeActivity.java:24-30, 356-387).
22. **Recently Added respects hidden categories/countries and keeps 24** (HomeActivity.java:312-315).
23. **First-run loading message** "Getting your channels, movies and series ready…" (HomeActivity.java:146-162).
24. **Welcome empty state** "Welcome to YM Player / Pick Live TV, Movies or Series above to get started." (HomeActivity.java:301-305).
25. **Focus starts on the first card, not the menu** (HomeActivity.java:389-400).
26. **Home rows refresh when the library refreshes in the background** (`Repo.onUpdated`) (HomeActivity.java:139-141).
27. **Tutorial/coach system**: offer dialog, per-screen tours, dim + hole overlay (Coach.java; HomeActivity.java:75-80, 91-102; BrowseActivity.java:447, 482-503).
28. **Crash-report notice on the next launch** (HomeActivity.java:105-135; App.java:62-106). This is possible on Tizen via `window.onerror` + localStorage. The VLC variant does not apply.
29. **Branded splash**: logo.png 190u, "YM Player" 40u, "Developed by Yousuf Miah", staged animations, 1.4 s min / 6 s max, library warm-up (SplashActivity.java:39-104). The Tizen splash is a bare `<h1>` for 600 ms (app.js:20, 24-36). `assets/logo.png` already exists in Tizen.
30. **Pseudo categories "Search", "Favourite …", "Recent Channels"/"Continue Watching", "All Channels"/"All"** at the top of every category list (BrowseActivity.java:459-465).
31. **Search inside each section** (search box in the content column, 300 ms debounce, whole-section ranked search, max 300) (BrowseActivity.java:175-183, 327-375).
32. **Auto-open a category 350 ms after the selection settles** (BrowseActivity.java:379-385, 622-633). Tizen needs OK.
33. **A category is shown on arrival** (Favourites → Recent/Continue → first category → All) (BrowseActivity.java:438-448). Tizen shows an empty right pane until OK (live.js:147-152, movies.js:121-126).
34. **▶ from a category opens it and jumps to item 0** (BrowseActivity.java:853-868).
35. **◀ from the first grid column / channel list returns to the active category at its on-screen position** (BrowseActivity.java:885-908). Tizen relies on spatial nav.
36. **Hide category (☰) and the Favourite/Hide dialog (hold OK on non-Fire remotes)** (BrowseActivity.java:387-395, 506-521, 568-601).
37. **Country/language and hidden-category filtering** across categories, All, Search, Recently Added and the TV guide (Filters.java whole file; FilterSettings.java).
38. **Category-list hint under the list** ("Hold OK  Favourite or hide") (BrowseActivity.java:149-154).
39. **Pinned favourite categories with trailing ♥, placed after the pseudo categories** (BrowseActivity.java:466-475).
40. **Gliding row highlight (Glider) for category and channel lists** (Glider.java; BrowseActivity.java:140, 213).
41. **Content slide-in on category change** (BrowseActivity.java:679-696).
42. **Spinner while loading, plus specific empty and error strings** (BrowseActivity.java:215-220, 437, 671, 700-704; Async.java:44-51).
43. **Live info panel** (logo/preview, name, NOW/time/progress/desc, UP NEXT, hint) (BrowseActivity.java:260-325, 744-806).
44. **Live video preview in the info panel after 450 ms, muted or with sound per setting** (BrowseActivity.java:1186-1256; Prefs.java:277-278). On Tizen it needs AVPlay `setDisplayRect` and a transparent hole (see 5.7).
45. **TV guide (EPG grid) on ▶ from the channel list, with the info strip and the 38% layout morph** (BrowseActivity.java:984-1182; EpgGrid.java; Guide.java).
46. **Programme details dialog** (hold OK / ☰ / Info in the guide) (BrowseActivity.java:956-982).
47. **"▶" marker for the playing channel and the active row state** (Adapters.java:271-274).
48. **Channel number fallback to position+1** (Adapters.java:273).
49. **"♥ " prefix on favourite posters, and ♥ in channel rows** (Adapters.java:271, 296). Tizen uses a gold ★.
50. **Two-line centred poster titles** (Adapters.java:184-187).
51. **Live zap queue from Home taken from the Recent/Favourite list the channel belongs to** (HomeActivity.java:193-204). Tizen passes the row's items, which is the same; Search/Browse pass the visible list. Same on both.
52. **Continue Watching special lists in Browse (`continueMovies`, `continueSeries` with one entry per series)** (Prefs.java:419-435). Missing from Tizen store.js.
53. **Reload categories when filters change in Settings** (`Filters.version`) (BrowseActivity.java:914).
54. **Update checker** (HomeActivity.java:81-85). Not applicable on Tizen (store/sideload updates). It can be dropped.
55. **Library cache / scheduled refresh / preload** (Repo.java; see 5.1).
56. **Search ranking (Match)**: exact > prefix > phrase > word-starts > contains, provider tags ignored, shorter names win ties (Match.java). Tizen uses substring `includes` (search.js:47).

## 4. THINGS TIZEN DOES DIFFERENTLY

1. **Home menu labels and order.** Android: Home, Live TV, Movies, Series, Search, Settings (TopBar.java:30-33). Tizen: Live, Movies, Series, Search, Settings, **Ambient, Phone** (views/home.js:7). Fix: use the Android labels and order. Move Ambient and Phone into Settings, where Android keeps them.
2. **Menu styling.** Android: a pill track (SURFACE_LO, r28u), a white gliding pill, 17u medium text, current tab semibold. Tizen: separate 26px buttons, 8% white background, 3px blue border on focus, blue tint (home.css:2-4). Fix: match 1.4 Top bar.
3. **Account status chip on Home.** Tizen shows `params.status` at the right of the menu (home.js:32-36, home.css:5). Android shows the clock there and no account chip. Fix: show the clock instead and remove the chip.
4. **Home page padding.** Android: shelf title at L64u [90px], row padding 22u top/bottom. Tizen: `.home {padding:32px 48px}` (home.css:1). Fix: no outer padding. Use 90px side insets per row, 39px top for the bar.
5. **Shelf title.** Android: SemiBold 22u [30.8px], TEXT2 (60% white). Tizen: 28px bold-default white h2 (home.css:6). Fix.
6. **Card spacing.** Android: gap 32u [45px], vertical padding 31px. Tizen: gap 20px, padding 8/28 (home.css:7). Fix.
7. **Card size.** Tizen tile is 200px wide, 2:3 for every row (home.css:8-9). Android POSTER 224x336, CHANNEL 308x174 (logo contained, padded), LANDSCAPE 420x237. Fix per row.
8. **Card focus.** Android: scale 1.08, 180 ms ease, shadow, 5.6px white inner ring at r19.6. Tizen: a 3px blue border around the whole tile including the title, plus a blue glow, no scale (home.css:12; browse.css:16, 37). Fix: white ring on the art only, plus a scale transition.
9. **Card title.** Android: medium 16u [22.4px], TEXT2 → TEXT on focus. Tizen: 20px white (home.css:11). Fix.
10. **Art radius.** Android: 14u [19.6px] on home cards, 12u [16.8px] on grid posters. Tizen: 10px (home.css:9, browse.css:33). Fix.
11. **Initial focus on Home.** Tizen focuses the first menu button (home.js:54). Android focuses the first card. Fix.
12. **Recent Channels limit.** Android: 20 (HomeActivity.java:280). Tizen: all 40 (home-rows.js:53). Fix.
13. **Recently Added count.** Android: 24 after filtering, from the newest 300. Tizen: 20, no filtering (home-rows.js:9, 29-31). Fix.
14. **Top 10 titles and source.** Android row titles "Top 10 Movies on Netflix UK" / "Top 10 Series on Netflix UK", from the Netflix TSV with no key (HomeActivity.java:289-290; Top10.java:34). Tizen: "Top 10 Movies in the UK", gated on TMDB (home-rows.js:18-19; keys.js:1-9). Settings toggle labels in Android are "Top 10 Movies in the UK" (Prefs.java:367). Tizen HOME_NAMES say "Top 10 Movies" (store.js:9-13). Fix: no key needed. Use the Netflix source and the Android strings.
15. **Continue Watching pick for movies.** Android opens Movie details (Open.java:13-14). Tizen jumps straight into the player at the saved position (home.js:14). Fix: movie → movie-detail; episode → player.
16. **Home rows built in sequence with await.** Recently Added blocks on a full network `streams()` call each session (home-rows.js:36-42, 45-60). Android builds the local rows instantly, then fills the remote rows async from the disk cache. Fix: render local rows first, then add the remote rows.
17. **Browse layout widths.** Android: outer padding 67px; category column 420px, transparent over the ambient background, with glider rows; content padding-left 50px. Tizen: rail 440px with a solid `#101016` panel and 48px/24px padding (browse.css:2). Fix.
18. **Category row style.** Android: RowCell, medium 19u [26.6px], padding 25/19.6px, focus = white pill with dark text, active = SURFACE_HI pill. Tizen: 28px, opacity .75, selected = `#1b1b22`, focus = blue border (browse.css:3-4, 16). Fix.
19. **Favourite category marker.** Android: trailing "♥", in TEXT2 / ON_FOCUS colour, pinned after the pseudo categories. Tizen: leading "★ " in gold `#ffd60a`, pinned at the very top (favourites.js:4-8, 17; browse.css:5). Fix.
20. **Item favourite marker.** Android: "♥ " prefix on posters, "♥" trailing on channel rows. Tizen: " ★" gold suffix (browse.css:15, 36). Fix.
21. **Long OK on a category.** Android on a remote without ☰ (which covers Samsung remotes): dialog "♡ Favourite" / "Hide". Tizen: toggles favourite immediately (live.js:154-169; movies.js:128-140). Fix: show the dialog. Samsung remotes have no ☰ key, so use the non-Fire strings everywhere ("Hold OK …").
22. **Menu key on a category.** Android: hide the category (BrowseActivity.java:810-813). Tizen: toggle favourite (live.js:155-158). Fix.
23. **Hold threshold.** Android uses the system long-press timeout (≈400-500 ms) for lists and 450 ms in the guide (EpgGrid.java:150-153). Tizen uses 600 ms (live.js:12, movies.js:12). Fix: about 450 ms.
24. **Live channel row.** Android: a compact 26.6px row (number 62px min, logo 101x62, name, trailing ♥/▶). Now/Next is shown in the side panel, not in the row. Tizen: a heavy row with `#1b1b22` background, 30px bold name fixed at 420px, Now/Next inline, 96x64 logo, number after the logo (browse.css:7-14; live.js:36-56). Fix: number → logo → name → trailing mark; drop the inline EPG and move it to the panel.
25. **Column order in the channel row.** Android: number, logo, name (Adapters.java:85-110). Tizen: logo, number, name (live.js:54). Fix.
26. **EPG fetch strategy.** Android loads only the selected channel, 400 ms after the selection settles (BrowseActivity.java:769-806). Tizen fetches the first 8 eagerly plus every focused row (live.js:13, 69-70, 115-119). Fix: follow Android.
27. **Poster grid geometry.** Android: column width 178u [249px] auto-fit with uniform spacing, image 210x315, vertical gap 14px, two-line centred title 21px. Tizen: 220px columns, gap 28, one-line left 22px title, 3px border (browse.css:31-37). Fix.
28. **Grid focus.** Android: scale 1.09, white ring on the image only, title turns semibold white. Tizen: a blue border around the whole button (browse.css:37). Fix.
29. **Empty strings.** Tizen: "No channels in this category." / "Nothing in this category." / "No categories." (live.js:68, 146; movies.js:51, 120). Android: "Nothing here yet", "No favourites yet\nHold OK on anything to add it.", "Couldn't load this list\n…", "Couldn't load categories\n…". Fix.
30. **Errors swallowed.** Tizen treats any fetch error as an empty list (live.js:64, 142; movies.js:47, 116). Android shows an error message. Fix.
31. **Back on the content area.** Both go to the rail. Android lands on the active category at its on-screen offset; Tizen focuses the selected category's button (similar). Android also handles ◀ from the first column; Tizen ◀ uses generic spatial nav, which may jump to an arbitrary category level with the poster (nav.js:56-92). Fix: an explicit ◀ handler.
32. **Back on the rail.** Android → Home via TopBar.back with a slide. Tizen → `router.back()`, which pops to whatever was below. That is Home, but only because Tizen pushes every section (router.js:52-77). Fix: section switches should replace, not push.
33. **Back on Home.** Android exits the app. Tizen pops to the `splash` view, which re-routes to Home after 600 ms. **The app can never be exited with Back from Home, and the splash flashes each time** (app.js:24-36, 67; router.js:67-77). Fix: the splash must replace itself (not stay in the stack), and Back at the root must call `tizen.application.getCurrentApplication().exit()`.
34. **Splash timing.** Tizen: 600 ms, no minimum/maximum logic (app.js:20). Android: 1400 ms minimum, 6000 ms cap, waits for the library warm-up. Fix.
35. **Splash destination.** Tizen goes to `login` when there is no account, else `home` (app.js:32). Android goes to Login, which goes to Home, or to **Setup (library download)** when there's no saved library. Fix: add the first-run download step (see 5.1).
36. **Background colour.** Tizen `--bg:#0B0B0F` (theme.css:7). Android BG `#0A0B12` under a gradient. Fix: use the gradient.
37. **Focus accent.** Tizen uses blue `#0A84FF` everywhere for focus. Android never uses blue for focus: white fill / white ring (dark theme). Blue is only for the EPG now-line. Fix globally.
38. **Spatial navigation.** Tizen's generic nearest-element algorithm (nav.js:56-92) does not reproduce Android's rules:
   - ▲ always goes to the current tab
   - ▼ from the bar goes to the top category
   - ▶ from a category goes to item 0
   - ◀ from the first column goes to the active category
   Fix: add explicit handlers per view.
39. **Live/Movies screens.** Tizen keeps focus on a category until OK and doesn't mark the selection until clicked. Android marks the current category only after you've picked one, and hides the mark while the bar is focused (BrowseActivity.java:59-60, 125-134, 551-555). Fix.
40. **Home rebuilds** by full remount on every return (router remount). Android rebuilds and keeps focus near the previous card (HomeActivity.java:175-186). Fix: restore focus to the previously focused card/row on remount.
41. **Image loading.** Tizen uses `<img src>` straight from the provider with `loading=lazy` (home.js:69; movies.js:31-35). Android sends a custom User-Agent (`ImageLoader.setUserAgent(prefs.userAgent())`, HomeActivity.java:38) and downsamples. Some providers block images without that UA. Fix: optional XHR→blob for UA, or accept the gap (the `<img>` UA can't be set on Tizen).
42. **Search (global screen).** Tizen debounce 120 ms, max 200, substring match, "Type to search" / "No results" (search.js:11-13, 44-51). Android: 300 ms, max 300, Match ranking, filtered, "Type the name of a …" / "No results for "q"". Fix. Search screen detail is scope B, but the ranking is shared with Browse.

## 5. DATA/LOGIC DEPENDENCIES

### 5.1 Repo library cache (Repo.java)
- Three tiers: memory → disk file `lib_<hash(base|user)>_<type>_{cats|all}.json` → provider (Repo.java:73-123, 337-340).
- Per-category lists are **filtered locally from the full list** once it exists (Repo.java:91-107). Tizen calls the provider for every category click (api.js:175-202; live.js:64; movies.js:47).
- `hasLibrary` (all three "all" files present) drives first-run behaviour (Repo.java:230-233).
- `isDue` uses `refreshHours`: default 12; 0 = every launch; −1 = manual (Repo.java:236-243; Prefs.java:281-282). `refreshAll` re-downloads Live, Movies and Series at low priority. `refreshIfDue` runs on Home open (HomeActivity.java:166-170).
- `preload` warms memory one type at a time (Repo.java:308-325).
- `onUpdated` callback refreshes Home rows (Repo.java:151, 278-283).
- `startSetup` runs Live first, then Movies and Series in parallel, with started/finished/allDone callbacks for the Setup screen's progress (Repo.java:162-227).
- **Tizen has none of this.** store.js has `refreshHours`/`lastRefresh` (store.js:148-152) but nothing uses them.
- **Storage:** full libraries are often tens of MB of JSON, far over localStorage quotas (~5-10 MB). Tizen needs **IndexedDB** (or `tizen.filesystem`) for the disk tier.

### 5.2 Filters (Filters.java, FilterSettings.java)
- Tag detection regex `^[^\p{L}\p{N}]*(EX-YU|[A-Za-z]{2,3}|4K|8K)\s*(?:[|:~\-–—»▎│\]⎮/]+|\s{2,})` (Filters.java:28-29). USA→US, GB→UK.
- Script detection: ≥40% of letters in a non-Latin block → `#ARABIC`, `#CYRILLIC`, … (Filters.java:53-102).
- Tag names map (Filters.java:104-131).
- Per-account sets `hide_tags`, `hide_cat_<type>`, `show_cat_<type>` (Filters.java:140-180).
- `items()` vs `searchItems()`: search ignores self-hidden categories but keeps country filters (Filters.java:204-238).
- A version counter tells screens to reload.
- None of this exists in Tizen. The Settings dialogs (FilterSettings: "Countries & languages to show" with Save / Unselect all / Cancel; "Hidden categories — untick to show") are scope C, but Browse/Home depend on the data.
- In JS, `\p{L}` requires the `u` regex flag (supported on Tizen 4+ Chromium).

### 5.3 Prefs dependencies missing in Tizen store.js
- `continueMovies()`, `continueSeries()` (Prefs.java:419-435)
- Home-row Continue Watching duplicates exist only in home-rows.js:25-27
- Coach prefs (`asked`, `on`, `seen_<screen>`) (Coach.java:157-191)
- Filter sets (5.2)
- `isFav` in Tizen re-parses JSON on every call (store.js:156-160). Android caches with FAV_KEYS. This is a performance concern for large grids.

### 5.4 Top 10 (Top10.java)
- Source: `https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv`. Public, **no API key** (Top10.java:34). The Tizen comment that it needs TMDB (keys.js:1-3) is wrong.
- Parse: columns `country_name`/`country_iso2`, `week`, `category`, `weekly_rank`, `show_title`. Keep GB rows only, latest week only. Rows whose category starts with "film" are films; everything else is TV (Top10.java:152-203). The file covers ~90 countries and every week since 2021, so it is **large**. Android streams it line by line and skips non-GB lines without splitting.
  - Tizen needs a streaming `fetch().body.getReader()` with TextDecoder line splitting. Buffering the whole text may be too heavy on low-end TVs.
  - Cross-origin: allowed only if config.xml has `<access origin="https://www.netflix.com" subdomains="true"/>` (or `*`) and the app has the `http://tizen.org/privilege/internet` privilege. Verify on a device. If Netflix's CDN blocks it, a tiny proxy is the fallback.
- Conditional GET with `If-None-Match`/`If-Modified-Since` and a custom browser UA. Cache in `netflix_top10_uk.json` (week, checked, etag, lastModified, films[], tv[]) (Top10.java:47-80, 130-149). A browser cannot set `User-Agent` in fetch, which is acceptable.
- `due()`: at most hourly, and only once `weekEnd + 9 days` has passed. On failure, retry in about 10 min (Top10.java:83-111).
- Matching to the library (Top10.java:211-243):
  - key = strip a leading `XX - `/`UK: `/`4K | ` tag, drop `(…)`/`[…]`, drop a `: Season…`/`- Series…` suffix, then `Item.squash` (NFKD, lowercase, letters and digits only)
  - the newest copy (`added`) wins; Netflix order is kept; unmatched titles are dropped
  - needs the **full** movie and series lists in memory (HomeActivity.java:349-351), so it depends on 5.1
- Runs on its own background worker so it never blocks the UI (Top10.java:114-126). On Tizen, use idle-time chunking (or a Web Worker) so a 10k+ library match does not freeze focus.

### 5.5 Match / Item text helpers
- `Item.squash`: NFKD, then keep letters and digits, lowercase (Item.java:74-87). `Item.fold`: lowercase and strip combining marks (Item.java:90-98). `words()` and `compact()` are cached per item (Item.java:33-55).
- JS equivalents: `s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')`. Cache on the object for speed.
- Match scoring 1000/900/800−pos/600/400/200; ignores up to 2 leading tags from the list in Match.java:332-341; ties broken by shorter compact name (Match.java:283-323). Query is usable only if the squashed query has ≥2 characters (Match.java:279).

### 5.6 Guide/EPG
- `Guide.load`: per-channel short EPG, **24** programmes, cached **30 min**, 3 parallel fetches (Guide.java:14-29). Tizen `api.epg` uses limit 6 with no shared cache (api.js:244-254).
- `XtreamApi.Programme.timeRange()`/`progress()` exist in Tizen api.js:226-240 with the same "HH:mm – HH:mm" format. That is good.

### 5.7 Live preview on Tizen
- Android creates a second player (VLC/Exo) inside the panel (BrowseActivity.java:1204-1237).
- Tizen has a **single AVPlay** instance on a plane behind the HTML. The preview must:
  - use `webapis.avplay.setDisplayRect(x,y,w,h)` for the logo box (in 1920x1080 coordinates)
  - make that box (and the page background) transparent while it plays (`body.video-on` exists in browse.css:20)
  - set volume via `webapis.avplay` / `tvaudiocontrol` for the muted mode
  - **close it before opening the full-screen player**
- The ambient gradient behind the page must not cover the video hole.
- This is possible, but only one stream can play at a time; Android also uses only one.

### 5.8 Ambient colour extraction
- Android reads pixels after downloading the image itself (ImageLoader.java:56-86, 409-424).
- In a Tizen web app, drawing a provider `<img>` to a canvas **taints** it (no CORS headers), so `getImageData` throws. Workaround: fetch the image by XHR/`fetch` as a Blob (cross-origin is allowed in packaged Tizen apps with `<access origin="*">`), create an object URL, draw it at 12x12 and average. Cache the colours (LRU about 600).

### 5.9 Platform items that do not map
- `Ui.hasMenuKey()` (Fire TV ☰ detection, Ui.java:64-70): Samsung remotes generally have no Menu key. Tizen should behave as "no menu key" and use the "Hold OK …" strings. A registered `Menu` key (keyCode 10133) can still act as ☰ when present (nav.js:9-10).
- VLC crash handover notice (App.java:62-75; HomeActivity.java:106-113): not applicable.
- GitHub Updater (HomeActivity.java:81-85): not applicable.
- System `AlertDialog`s and `Toast`s: Tizen has no native equivalent in a web app. They must be built as HTML overlays styled like Android Material dark dialogs (SHEET colour), with D-pad focus on the buttons and Cancel focused where Android does that.
- `translationZ`/elevation shadows: use CSS `box-shadow`, roughly `0 20px 40px rgba(0,0,0,.45)` for z=14u.
