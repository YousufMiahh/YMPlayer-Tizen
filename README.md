# YM Player for Samsung Tizen TV

YM Player is an Xtream-codes IPTV player for Samsung Tizen TVs (Tizen 7.0 and later, 1920x1080).
It is the Tizen build of the Android / Fire TV YM Player and is made to look and behave like it,
screen for screen. It is a plain HTML/CSS/JS web app packaged as a `.wgt`; playback uses Samsung
AVPlay.

## What is in it

- **Home**: Continue Watching, Recent Channels, your favourites, **Top 10 Movies / Series on
  Netflix UK** and Recently Added.
- **Live TV, Movies, Series**: categories with search, favourites and hiding, a live preview, and
  the **TV guide**.
- **Movie and series pages** with Play / Resume, Start Over, Favourite and **trailers**.
- **Player**: channel list, subtitles and audio tracks, scrubbing, Next Episode, automatic
  recovery when a stream stalls.
- **Search** across channels, movies and series at once (All / Live TV / Movies / Series).
- **Settings**: several accounts, theme (dark / light), what Home shows, hidden countries and
  categories, subtitle style, stream format, library refresh, and the tutorial.

**No API keys are needed.** The Top 10 rows read Netflix's public weekly list and match it against
your library; trailers use the YouTube link your provider supplies, played in the keyless
youtube-nocookie embed. Everything else comes from your Xtream provider.

## Download

The latest build is always at:

    https://github.com/YousufMiahh/YMPlayer-Tizen/releases/latest/download/YMPlayer.wgt

Every push to `main` runs `.github/workflows/build.yml`, which runs the tests, builds and packages
the app with the Tizen CLI, and publishes `YMPlayer.wgt` as a new release (`v<run number>`). The
package is signed with a throwaway certificate made during the build, so the build needs no
secrets; it is re-signed for your TV when you install it (below).

## Install

1. Download `YMPlayer.wgt` from the link above.
2. Install it with **Apps2Samsung**, using its **custom .wgt** option. Apps2Samsung re-signs the
   package for your TV as it installs, so the build's own throwaway signature does not matter.
3. Open YM Player from **Vetro**, the launcher on the TV.

To update, install the newer `YMPlayer.wgt` the same way. Accounts, favourites and watch history
are kept on the TV. The app does not update itself.

## Remote control

Samsung remotes have no menu key, so anything Android does with ☰ is done by **holding OK**.

| Where | Keys |
| --- | --- |
| Everywhere | D-pad moves; OK selects; Back goes back (Back on Home closes the app). ▲ goes to the top bar; resting on a tab opens it |
| Home | Hold OK on a card: favourite it, or remove it from Continue Watching |
| Live TV / Movies / Series | ▶ from a category opens it; Hold OK on a category: favourite or hide; Hold OK on an item: favourite. In Live TV, ▶ from the channel list opens the TV guide |
| TV guide | ▲▼ channels, ◀▶ programmes, OK watches, Hold OK shows programme details, Back returns to the list |
| Watching live | ▲▼ or CH+/CH− change channel; OK channel list; ◀▶ or Info channel info; Hold OK favourite, subtitles and audio |
| Watching a film or episode | OK pause / play; ◀ back 5 s, ▶ forward 10 s (press again to go further); ▼ scrub; Hold OK subtitles, audio and favourite |
| Search | Type at least two characters; Enter / Done goes to the first result; Hold OK on a result: favourite |

## What differs from the Android app

These Android features have no equivalent on a Samsung TV and are left out: Audio Sync and the
choice of video player (AVPlay is the only player and has no audio offset), signing in from your
phone with a QR code (a TV web app cannot accept connections), and in-app updates.
`docs/parity/` has the full audits and a report for each phase of the rebuild.

## Development

    npm ci
    npm test                           # vitest + jsdom
    npm run mock                       # the app + a mock Xtream server on http://127.0.0.1:8090 (demo / demo)
    npm run shots                      # screenshots of every screen into tools/shots/out/
    node tools/shots/run.mjs home live # just these screens

The app lives at the repo root: `config.xml`, `index.html`, `js/` (with `js/ui/` and `js/views/`),
`css/` and `assets/`. Only those are packaged; tests, tools, docs and `node_modules` are not.
`npm run shots` needs Chrome (`CHROME=/path/to/chrome` if it is not at `/usr/bin/google-chrome`).
In tests and in a desktop browser AVPlay is replaced by a shim (`js/avplay-shim.js`); real playback
can only be checked on a TV.
