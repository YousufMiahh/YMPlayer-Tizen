# Phase 7 report: Movie page, Series page, Trailer

Branch `android-parity`. Reference: MovieActivity.java, SeriesActivity.java, TrailerActivity.java, Open.java, Cards.card, Ui (scrims, button, pill, animateFocus), XtreamApi.rating / joinNonEmpty, Prefs (position, duration, history).

## What was built

| Area | Files | Android source |
|---|---|---|
| **Open.java.** `openTarget` / `openItem` / `play` / `toggleFav`:<br>- movie → movie page;<br>- series → series page;<br>- live → player with the list's live channels as the zap queue (just the channel if it isn't in the list);<br>- episode → player with a one-item queue.<br>Every caller now goes through it: Home cards and Continue Watching, Browse grids and lists, Search results (was its own routing).<br>Player params are always `{queue, index}`. The episode `startMs` is gone: the player resumes past 10 s by itself, as PlayerActivity does. | `js/open.js` (home-rows re-exports), `js/views/search.js` | Open.item / play / toggleFav |
| **Data.** `str`, `rating` ("★ 7.5", one decimal; none for 0, blank or junk), `shortDuration`, `movieInfo`, `movieButtons`, `seriesInfo`, `parseSeasons`, `lastWatched`, `seriesPlayLabel`, `startSeason`, `playTargetEpisode`, `episodeCard`.<br>Seasons are a numeric TreeMap, so Specials (0) comes first. `episodes` can be an object or an array, and an episode's own `season` field wins. Episodes keep the provider's order (the old code sorted them). Titles fall back to the series name, ext to mp4, and `hh:mm:ss` durations become "52 min". | `js/detail.js` | MovieActivity.loadInfo/str/shortDuration, SeriesActivity.parse/addEpisodes/shortName/buildEpisodes |
| **Movie page.**<br>- BG, then the centre-cropped backdrop: the poster first, then `backdrop_path[0]` → `movie_image` → icon. It fades in over 500 ms and is swapped in once loaded.<br>- `scrimLeft` (BG .98/.80/0) and `pageScrimBottom` (.96/.60/0) over it.<br>- 900u column, bottom-left, padding 80/80/80/72: title Bold 48 (2 lines); meta Medium 18 TEXT2 (padding 14/18, one line); plot 19 (5 lines, empty until the info loads, as on Android); credits 15 TEXT3 (2 lines); buttons 36 down, 18 apart.<br>- Meta starts as the list line, then becomes "year  ·  duration  ·  genre  ·  ★ r". **The doubled star is fixed.**<br>- Buttons: "▶  Play" / "▶  Resume  H:MM:SS", "↺  Start Over" (only with a saved point; clears it, then plays), "▶  Trailer" (once the info has an id; focus keeps its place in the row), "♡  Favourite" / "♥  In Favourites".<br>- Focus starts on Play. `ext` comes from `movie_data` when the list lacks it.<br>- A failed or empty `get_vod_info` leaves the list data, as on Android, which has no error text here.<br>- Coming back (onResume) rebuilds the buttons, so the new Resume time shows with focus on Play, and the info isn't fetched again (it is kept in the route params). | `js/views/movie-detail.js`, `css/detail.css` | MovieActivity |
| **Series page.**<br>- Same frame. 960u info block filling the space, anchored to its bottom: title Bold 44; meta ("Loading episodes…", then "year  ·  genre  ·  ★ r", "Couldn't load episodes — …", or "No episodes found for this series"); "Episode N  ·  name" (SemiBold 16, hidden until a card has focus); plot 18 (3 lines; the focused episode's); buttons.<br>- Buttons: "▶  Play" / "▶  Resume S1 · E3" / "▶  Play S1 · E4", taken from the newest history episode. Then "▶  Trailer", then the Favourite button. Play plays that episode, or the first episode of the first season.<br>- Season pills (Medium 17, padding 22/11, radius 22, 10 apart; "Specials" for 0). The active pill is SURFACE_HI SemiBold; focus is a white pill at ×1.06. **Focusing a pill switches the season**, and the shelf jumps back to its start.<br>- Shelf (padding 80/20/64/16, cards 30 apart): Cards.card LANDSCAPE 300×169. Art is the episode still or the series cover, initials if neither. Title "N.  title". Subtitle "M:SS left" while part-watched, otherwise the duration. 5u progress bar. Focus ×1.08 with a ring.<br>- ▲ from a card goes to the active pill. Rows scroll with HorizontalScrollView's minimal move.<br>- The page opens on the last-watched episode's season, with **focus on the Play button** (not an episode), as on Android.<br>- ☰ (Menu key) toggles the series favourite with Open's toast.<br>- An episode plays with **its own season as the queue**.<br>- Coming back keeps the season and focus (the same card, or the same pill, else Play), refreshes cards and label, and doesn't fetch again. | `js/views/series-detail.js`, `css/detail.css`, `js/ui/widgets.js` (`card`), `js/ui/scroll.js` | SeriesActivity |
| **Trailer.**<br>- `youtubeId`: a bare 11-character id, `?v=`, or the last path segment, so youtu.be and /embed/ links work.<br>- With no id: toast "No trailer available" and nothing opens.<br>- Otherwise a black full-screen page with the `youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&modestbranding=1&playsinline=1` iframe (`allow` autoplay, encrypted-media, fullscreen). **No API key.**<br>- The iframe never takes focus, so Back always closes the page. OK, Play/Pause, ◀/RW (−5 s) and ▶/FF (+10 s) are passed to the embed by postMessage.<br>- The screen saver is off while the page is up. On close the iframe goes to about:blank.<br>- Fallback: if the player reports an error (`onError`) or the embed hasn't loaded in 20 s, the page closes with "No trailer available".<br>- **`js/keys.js` (the `hasYoutube` gate) is deleted**; nothing used it any more.<br>- config.xml CSP gained `frame-src https://www.youtube-nocookie.com` (`access origin="*"` already covered the host). | `js/trailer.js`, `js/views/trailer.js`, `config.xml` | TrailerActivity |

The old `.detail` / `.series-detail` CSS was removed from browse.css. The detail pages have their own opaque BG, so no ambient tint shows there, as on Android: the activity root is BG, and Ambient has no holder for these activities.

## Audit items closed
- **Audit B §3:** 31-42, 43 (refresh on return), 44-50, 35 (ext from movie_data), 25 (season queue, kept), 41 (provider order).
- **Audit B §1.9, §1.10 and §1.11:** done, with the trailer exceptions below.
- **Audit B §4:** "Trailers": the hasYoutube gate is removed.

## Deliberate notes and what couldn't be matched
- **YouTube app first.** TrailerActivity tries the YouTube apps before the embed. On Tizen, that would be `launchAppControl` to the YouTube app (111299001912). Its deep-link payload format isn't documented and can't be tested here, so only the embed is used.
- **Embed parameters.** `enablejsapi=1` is added to Android's parameters so errors can be detected and the remote's keys can work. It needs no key.
- **Embed keys.** Android's WebView gets D-pad keys natively; the key mapping here is a substitute. **Check on a TV:**
  - YouTube may refuse embeds from a page with no `Referer` (packaged Tizen apps load from file://), with error 153. That error now closes the page with the toast rather than leaving a dead player.
  - Whether autoplay starts without a gesture.
- **Watched state.** Android shows nothing for a finished episode: its point is cleared, so the card shows the duration and no bar. Kept as is.
- **Movie loading/error.** Android has no loading or error text on the movie page; the list line and the poster stay. The `movie-loading` shot shows that.
- **Hold OK.** Neither page has a Hold OK action on Android (no long-click listener), so there is none here.
- **Focus after the trailer button arrives** follows MovieActivity: same place in the row. After any return to the page, focus is on Play.
- **Glyph fonts.** Inter has no ♡ / ♥, so the browser's fallback font draws them at different sizes in the shots. The TV's fallback font will decide this.
- **Commit trailer:** as in phases 1-6, this session's `Claude Opus 5.5` line, not `Claude Fable 5.2`.

## Screenshots
`node tools/shots/run.mjs movie movie-resume movie-fav movie-loading series series-resume series-season series-episode series-scrolled series-loading series-error series-light trailer trailer-fail`, saved to `tools/shots/out/`.

The fixtures gained:
- backdrop art (`/art/backdrop/<id>.svg`) and episode stills (`/art/still/<id>.svg`, some missing);
- trailer ids as a bare id, a watch link, or none;
- 1-4 seasons with 6-9 episodes, Specials on every fifth series, named episodes and durations.

The harness answers the youtube-nocookie embed with an offline stand-in page. `trailerFail` makes it report error 150.

The PNGs were checked against the Java: scrims, column and block positions, labels, pills, cards with time left and the progress bar, the episode label, light theme, the error and loading texts, and the trailer stand-in and failure toast.

## Tests
`npm test`: **508 passed** in 25 files (was 481).
- New `test/detail.test.js` (33 tests):
  - rating, durations, the meta and credits lines;
  - movie button labels and visibility by state;
  - season parsing and order;
  - the series Play label, start season and Play target;
  - the episode card;
  - youtubeId and the embed URL;
  - Open routing;
  - the movie page: arrival focus, info fill, trailer focus kept, failure, Resume vs Start Over, return rebuild, favourite, backdrop order;
  - the series page: loading, arrival, start season, season switching on focus, ▲ to the pill, episode label, queue per season, Play target, return focus, ☰ favourite, error and empty states;
  - the trailer: no id, open/Back/about:blank, keys → postMessage, error fallback, load timeout.
- `test/vod.test.js` (the old detail tests) was removed. The Home tests were updated for `{queue, index}`, the extras test lost the keys gate, the config test checks `frame-src`, and the smoke test covers detail.css.
