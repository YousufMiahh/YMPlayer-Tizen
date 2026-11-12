# Phase 6 report: the Player (live, films, episodes)

Branch `android-parity`. Reference: PlayerActivity.java, SeekBarView.java, NextUpCard.java, Engine.java, ExoEngine.java, VlcEngine.java / VlcHolder.java (subtitle look), Open.java, Prefs.java, SettingsActivity.SUB_SIZES, SeriesActivity (queue, `fmt`), Coach.java.

## What was built

| Area | Files | Android source |
|---|---|---|
| **Engine.** One AVPlay engine, playing the part of Engine.java:<br>- `open(item, {startMs, format})`: open → listener → full-screen rect → `setDisplayMethod(LETTER_BOX)` → `USER_AGENT` → prepareAsync → seek → preferred tracks → play.<br>- `retry()` reopens the same stream; films and episodes reopen where they were.<br>- play / pause / `isPlaying` / `isReady`. `position()` reads `getCurrentTime()`, not just the last tick.<br>- `duration()`; `seek()` runs one seek at a time and the latest request wins.<br>- Buffering events.<br>- `tracks(type)`: labels follow ExoEngine.trackName, e.g. "English  ·  Dolby Digital+  ·  5.1", or "Audio 3" when the language is `und`.<br>- `select` / `subtitlesOff` / `subtitlesAreOff`.<br>- The saved `sub_lang` / `audio_lang` are applied at start. "off" starts silent.<br>- `onsubtitlechange` is passed on as a `subtitle` event. Nothing is passed while subtitles are off.<br>- The retry ladder moved out of the engine into the screen, as in PlayerActivity. | `js/player.js` | Engine, ExoEngine, VlcEngine |
| **Live banner.**<br>- Full-width bottom scrim (0xF0 → 0x99 → 0), padding 80/150/80/52.<br>- 220×124 logo box.<br>- Number (Medium 22 W2), then name (Bold 32) with "  ♥" for a favourite.<br>- Now (SemiBold 21), or "No guide information".<br>- "HH:mm – HH:mm" with a 360×5 white bar, shown only when start > 0.<br>- "Next   HH:mm   Title".<br>- Hint line.<br>- `get_short_epg` limit 6. Hides after 6 s. Fades in 200 ms, out 250 ms. | `js/views/player.js`, `css/player.css` | buildLiveBanner, showBanner, fade |
| **Live keys.**<br>- OK tap (on release) opens Channels. Hold OK (450 ms, or held without key repeats until release) opens the menu.<br>- ▲ / CH+ go to the previous channel, ▼ / CH− to the next. They wrap, and need at least 2 channels. Each press resets the retry state. The banner updates at once; the stream opens 350 ms after the last press.<br>- ◀ ▶ INFO show the banner. Menu opens the menu. Play / Pause / PlayPause toggle.<br>- **No number-key entry and no last-channel recall: Android has neither.** | same | dispatchKeyEvent, zap |
| **Channels sheet.**<br>- Left, 560u wide. "Channels" title with the hint "Hold OK  Add or remove favourite".<br>- Windowed rows (`vlist`) with the gliding highlight.<br>- Opens on the playing channel at the top of the list (ListView.setSelection). That row shows "▶" and the active SURFACE_HI fill; favourites show "♥".<br>- OK on another channel zaps at once and closes the sheet.<br>- Hold OK or Menu toggles the favourite, with the toast "Added to / Removed from Favourites — X".<br>- Back closes it. | same | buildChannelPanel, openChannels, Adapters.Channels |
| **Subtitles & Audio panel.**<br>- Right sheet, 520u wide, scrolling. The padding scrolls with the rows.<br>- Rows: FAVOURITES ("♡  Add to Favourites" / "♥  In Favourites — remove"; for episodes the series: "Add series to Favourites" / "remove series"). SUBTITLES: Off, then each track with ✓, or the note "This stream has no subtitles". AUDIO: each track, or "No audio tracks found". SUBTITLE SIZE: Small / Medium / Large / Extra Large.<br>- Picking a row runs it and rebuilds the list after 250 ms, keeping focus.<br>- Focus opens on the subtitle row in use, otherwise the audio row in use.<br>- Picking saves `sub_lang` / `audio_lang`.<br>- Opening the panel hides the sheet and banner.<br>- The OK that opened it never activates a row. | same | openTracks, buildTrackRows, header/note/option |
| **Subtitle rendering.**<br>- HTML overlay fed by `onsubtitlechange`. Each cue goes after its duration.<br>- Tags and SSA codes are stripped and line breaks kept, because Android ignores embedded styles.<br>- Size is 4.5 / 5.6 / 6.8 / 8.5 % of 1080. Six colours with Android's hexes. SemiBold.<br>- Drop shadow (0xE6000000), or a black background at 25/50/75/100 %.<br>- 7 % bottom padding.<br>- A size change from the panel applies at once. | `js/ui/subtitles.js` | ExoEngine.applySubtitleStyle, PlayerActivity.SUB_* |
| **VOD sheet.**<br>- Same scrim, padding 80/160/80/52.<br>- "Series  ·  Episode N" (episodes only), then the title (Bold 34).<br>- Seek bubble (INVISIBLE keeps its space).<br>- Scrub row.<br>- SeekBarView: 28u view, 7u bar, −14u margins, knob radius h/2.6, 1.5× thicker while scrubbing, lighter "ahead" stretch.<br>- Elapsed on the left, "−remaining" on the right. The right side is blank when the length is unknown.<br>- VOD_HINT / SCRUB_HINT.<br>- Centre icon: 120u circle with Android's drawn triangle or bars. Shown only while paused, when the sheet stays pinned. Otherwise the sheet hides after 4 s. | `js/views/player.js`, `js/ui/seekbar.js`, `css/player.css` | buildVodOverlay, SeekBarView, PlayPauseIcon, onPlayingChanged |
| **VOD keys.**<br>- OK tap (on release) pauses or plays at once. Hold OK opens the menu.<br>- ◀ / RW go back 5 s and ▶ / FF forward 10 s. Presses add up from the pending target and are clamped to [0, d−1 s]. The bubble reads "+30 sec" / "−20 sec" / "+1:30" and resets 1.2 s after the last press.<br>- ▲ shows the sheet. ▼ (first press) scrubs.<br>- PlayPause toggles and ignores repeats. Play plays and shows the sheet. Pause pauses.<br>- Back is layered: coach → scrub → Next card → panel → hide the sheet while playing → leave. | same | dispatchKeyEvent, seekBy, onBackPressed |
| **Scrub mode.**<br>- The knob starts where playback is. Steps are max(10 s, d/120) × 1 / 2 / 4 / 8 by repeat count (0-2 / 3-7 / 8-15 / 16+). Repeat counts are tracked per held key, because Tizen doesn't always set `e.repeat`.<br>- The time over the knob reads "H:MM:SS   +M:SS" and is clamped to the row.<br>- It commits 1 s after the last move, or on OK / PlayPause. It seeks only for ≥ 1 s and resumes if paused.<br>- ▲ or Back cancel. ▼ does nothing. Menu cancels and opens the menu.<br>- With no known length, ▼ only shows the sheet. | same | enterScrub, moveScrub, updateScrub, placeScrubCard, commitScrub |
| **Next Episode card.**<br>- "Watch credits" (SemiBold 20, 60u, .35 white, white with black text when focused) plus the 250×60 Next button. A white fill sweeps across it over 10 s (linear), with black text over the fill and white elsewhere. Focused, it scales to 1.05 with a 3u ring.<br>- Shown for episodes with a next one, length ≥ 5 min, 2 s < remaining ≤ 30 s, not dismissed, not scrubbing, playing. Hidden again above 35 s remaining; offered again above 45 s.<br>- The countdown pauses while the video is paused.<br>- ◀ / ▶ move between the buttons. OK (on release) presses. Back = Watch credits.<br>- At full, the next episode plays and the current one's resume point is cleared. | `js/ui/nextup.js`, `js/views/player.js` | NextUpCard, checkNextCard, playNextEpisode |
| **Queue and endings.**<br>- An episode ending plays the next one in the queue; otherwise the player closes.<br>- The series screen now passes **the episode's own season** as the queue (SeriesActivity:381), so there is no crossing into the next season.<br>- A live stream ending reconnects. | `js/views/series-detail.js`, `js/views/player.js` | onEnded |
| **Resume.**<br>- **No prompt in the player.** On the first start, a saved point > 10 s is resumed with the toast "Resuming from H:MM:SS". The old Resume/Start-over prompt is gone.<br>- Callers now pass Open.play's `{queue, index}`. The movie page's "Play from start" clears the saved point first, like Start Over. The full movie-page rebuild is a later phase. | `js/views/player.js`, `js/views/movie-detail.js` | play(resume) |
| **Errors.**<br>- 2 retries 1.5 s apart, each with "Reconnecting…".<br>- Then, for live, the other format (.ts ⇄ .m3u8), once. This happens regardless of `auto_recover`, as on Android.<br>- Then the card: "Can't play this channel\|video\n<AVPlay error name>\n\nOK  Try again      Back  Exit[      ▲▼  Other channel]". SHEET, radius 22, padding 36.<br>- OK resets the state (back to the Settings format) and plays again. ▲▼ still zap.<br>- The status pill is top-right, Medium 16, and hides after 2.5 s. | same | onError, status |
| **Freeze watchdog** (it stands in for "Fix Frozen Video").<br>- Every 1 s, while `auto_recover` is on, AVPlay is PLAYING and not buffering: if `getCurrentTime()` hasn't moved for 3 ticks, it shows "Re-syncing video…".<br>- Live reloads; films and episodes re-seek to the same point.<br>- At most 4 recoveries per channel or item, then it gives up quietly. | same | checkStall |
| **History and resume points.**<br>- History is added on every play.<br>- On stop: the duration from AVPlay is stored. Within the last 60 s the point is cleared; past 10 s it is saved. Live is never saved.<br>- **Fixed:** a stream that completed before any time tick stored its start point (or 0) as its duration. Completion now stores only AVPlay's own duration, and stop doesn't overwrite a finished item. | `js/player.js` | savePosition, onEnded |
| **Coach.** "Watching Live TV" / "Watching films & series" first-run cards with the Hold OK wording, centred, 900 ms after opening. While a card is up it takes the keys. | `js/views/player.js` | onStart → Coach.show |
| **Lifecycle.**<br>- Going to the background (`visibilitychange`) saves and releases AVPlay. Coming back resumes from the saved point, like onStop / onStart.<br>- The screen saver is turned off while the player is up (`webapis.appcommon`).<br>- `html.video-on` makes the whole page see-through. Before this, only `body` was, so the page's own background could cover the video plane on a TV. | same | FLAG_KEEP_SCREEN_ON, onStop/onStart |
| **Settings (minimal fix).** Subtitle colours and sizes now come from `js/ui/subtitles.js`: White, Yellow, Cyan, Green, Pink, Orange, and four sizes. Before this, Settings listed different colours in a different order, so a stored index wouldn't have meant the same colour as on Android. The rest of Settings is a later phase. | `js/views/settings.js` | SettingsActivity:22, PlayerActivity:41-44 |

Media keys are already registered in `js/nav.js`, and Info was added in phase 5. **Stop (413)** is left alone because PlayerActivity doesn't handle KEYCODE_MEDIA_STOP. **RW / FF** do nothing on live, as on Android.

## Audit items closed
- **Audit B §2:** 4, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33 (player), 34, 35, 36, 37.
  - 10: rendered by the overlay.
  - 18: remaining time only. AVPlay has no buffered position.
  - 24: only "Reconnecting…" and "Re-syncing video…" apply.
  - 26: the engine-switch rung doesn't exist.
- **Audit B §3:** 6-30, the player rows.
  - 25: the season-only queue.
  - 23, 24, 30: resume and save rules.
- **Audit B §4:**
  - Track list, labels and selection; subtitles Off; preferred languages; rendering and style.
  - Freeze heuristic; recovery; retry ×2 at 1.5 s; .ts⇄.m3u8; buffering spinner; duration / position / seek; start-time resume; letter-box; user agent; keep the screen on.
- **Audit B §1.1-1.7** are implemented as specified, with the exceptions below.

## AVPlay limitations and what was done
| Android | AVPlay | Done |
|---|---|---|
| Audio Sync (±100 ms, per channel/film/series) | No API to shift audio against video | **Omitted.** The AUDIO SYNC rows aren't shown and none of the sync status messages exist. |
| Player choice (Android / VLC), per-item memory, "Trying VLC player…", engine fallback in the retry ladder, "Picture froze — switching to VLC" | One engine | **Omitted.** No PLAYER rows and no engine rung in the ladder. The VLC subtitle-size note isn't shown, because sizes apply at once here. |
| Frame counter + fps for freeze detection | No frame counter | Heuristic: `getCurrentTime()` not advancing for 3 s while PLAYING and not buffering. Still-picture or radio channels whose clock keeps moving are never flagged, which is consistent with Android's < 5 fps skip. |
| Buffered segment on the seek bar | No buffered-position API | Not drawn, as with VLC on Android. |
| Subtitles drawn by the player | Only `onsubtitlechange` text | Drawn in an HTML overlay with Android's style. Bitmap subtitles (DVB/PGS) arrive without text on most models and can't be drawn. Whether embedded tracks are listed at all depends on the container and the TV model. |
| Unsupported audio (DTS/TrueHD) → switch to VLC | No second decoder; support can't be queried | Not detected. The track list shows the codec ("DTS"), so the user can pick another track. |
| Behind-live-window reset | No such error | Covered by the normal retry. |
| Playback speed, aspect modes | — | Android has neither, so neither is exposed. The display method is fixed to letter-box, which matches Android's fit. |
| `getTotalTrackInfo` field names | `extra_info` JSON differs slightly across firmware | `language` / `track_lang` / `fourCC` / `channels` are read defensively. **Check on a device.** |

## Deliberate notes
- **Stop key** does nothing, as on Android.
- **Number keys and last-channel recall** don't exist on Android and weren't added (audit B §1.6).
- **Error retries keep the current channel's banner.** As on Android, the banner isn't re-shown on each retry.
- **Episodes moving on:** `player.open` saves the previous item before opening the next, so that item's duration is stored too. Android only stores the last item's duration. The end result for resume points is the same.
- **Commit trailer:** the commits use this session's `Claude Opus 5.5` co-author line, as in phases 1-5, not the `Claude Fable 5.2` line in the brief.

## Screenshots
`node tools/shots/run.mjs player-live player-channels player-menu player-tracks player-subs player-subs-styled player-vod player-episode player-seek player-scrub player-nextup player-error player-status` saves to `tools/shots/out/`.

These screens use the shim's new **demo mode** (`createAvplayShim({ demo: true })`), which provides:
- a stand-in video plane at the display rect, black until a picture plays, as on a TV;
- a real-time clock;
- fake EAC3/AAC audio tracks and English/Spanish subtitle tracks;
- a subtitle line every 4 s from the selected track;
- `freeze()`.

Fixes made after checking the PNGs against the Java:
- The demo duration made the shot's saved position finish the film at once.
- The Channels hint lost its double space; sheet hints now keep it.
- The track panel's padding didn't scroll with the rows. Android pads inside the ScrollView.
- The page background hid the video plane (`html.video-on`).
- The favourite heart was missing from the banner shot because of a fixture toggle.

## Tests
`npm test`: **481 passed** in 25 files (was 429).
- **New `test/player-view.test.js` (57 tests), on the real engine and the shim:**
  - Helpers.
  - Live: the banner and its fields; no-guide; 6 s hide; zap debounce with stop/close before open; ▲ / CH+ / ▼ / CH− order and wrap; a single channel; ◀ ▶ INFO.
  - Channels: opening, marks, OK zap, Hold OK / Menu favourite, Back.
  - The live menu with the Favourites row; live pause keys.
  - Errors: the ladder (2 retries, format flip, card, OK retry); the flip with auto-recover off; ▲▼ from the card; reconnect on end.
  - Freeze watchdog: trigger and 4-try limit; no false triggers (moving clock, pause, buffering, pref off).
  - Coach card.
  - VOD: resume and toast; under 10 s; the episode line; 4 s hide; OK pause/play with pinning.
  - Seek accumulation, bubble and reset; clamping.
  - Scrub: timing; acceleration; OK, ▲ and Back; unknown length.
  - Layered Back and the saved point; media keys incl. Stop.
  - Endings: film; episode advance; end of season.
  - The VOD error card; the VOD watchdog re-seek; background/foreground.
  - Next card: the 30 s window, focus and countdown; pausing; Watch credits and re-arming; Back; when it isn't offered; NextUpCard timing.
  - Tracks panel: rows with no Sync or Player rows; focus; switching against the shim with memory; Off; the hold not activating; notes; episode → series favourite.
  - The subtitle overlay in two styles; Off; text clean-up.
- **`test/player.test.js` (28)** was rewritten for the engine:
  - error events with no built-in fallback; format; retry; letter-box; buffering;
  - real duration on completion, and the **no-tick completion fix**;
  - live position on stop;
  - track labels; select / Off / silence; remembered languages; language matching.
- **Removed:** the obsolete `test/live.test.js` and the player-vod block of `vod.test.js`. Those tests were rewritten for the season queue and the `{queue, index}` params.
