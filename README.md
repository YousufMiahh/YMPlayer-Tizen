# YM Player for Samsung Tizen TV

YM Player is an Xtream-codes IPTV player for Samsung Tizen TVs (built for a Samsung S90D, Tizen 7.0).
It is the Tizen sibling of the Fire TV YM Player: live TV, movies and series, favourites, resume
positions, search, multiple accounts, and an add-account-from-phone QR code. It is a plain
HTML/CSS/JS web app packaged as a `.wgt`; playback uses Samsung AVPlay.

## Download

The latest build is always at:

    https://github.com/YousufMiahh/YMPlayer-Tizen/releases/latest/download/YMPlayer.wgt

Every push to `main` runs the GitHub Action in `.github/workflows/build.yml`, which tests the app,
builds and packages it with the Tizen CLI, and publishes `YMPlayer.wgt` as a new release (`v<run number>`).
The package is signed with a throwaway self-signed certificate generated during the build, so no
secrets are needed. The TV must be rooted (Vetro / APL-Launcher), which is what lets it accept
that self-signed package without a Samsung partner certificate.

## Install on a rooted S90D (network only, no USB)

Put the TV and your computer on the same network and find the TV's IP (Settings > Connection > Network status).

### Option A: Vetro

1. Download `YMPlayer.wgt` from the link above.
2. In Vetro, install the `.wgt` over the network. Because the TV is rooted, the self-signed
   package from the Action can be installed as-is. If you would rather re-sign it with your own
   Samsung certificate, do that through Vetro before installing.
3. Open the APL-Launcher home screen: YM Player appears there as a tile.

### Option B: `sdb` + `tizen` CLI (Tizen Studio command-line tools)

    sdb connect <TV_IP>
    sdb devices
    tizen install -n YMPlayer.wgt -t <TV_NAME_FROM_sdb_devices>

The TV needs Developer Mode on with your computer's IP allowed (Apps > press 12345 > Developer mode),
or a rooted setup that already exposes `sdb` on port 26101. If the install is rejected for signing
reasons, use Option A, or re-sign with your own certificate (`tizen package -t wgt -s <your profile>`).

## Remote control

| Where | Keys |
| --- | --- |
| Everywhere | D-pad moves focus (stops at edges); OK selects; Back (return) goes back |
| Live TV | Up/Down or CH+/CH- change channel; OK / Left / Right shows or hides the channel info (with now/next if the provider supplies EPG) |
| Movies / episodes | Left/Right seek back/forward; OK shows controls, then toggles play/pause; Resume prompt appears if you stopped part-way |
| Media keys | Play/Pause/Stop/FF/Rewind are registered with the TV (`tizen.tvinputdevice`) |

## Features not enabled in this build

Top 10 (TMDB) and Trailers (YouTube) need third-party API keys. v1 ships with **no external keys**,
so those rows and buttons stay off. The code is in place; a build can define
`globalThis.YM_KEYS = { tmdb: '...', youtube: '...' }` to turn them on.

## Development

    npm ci
    npm test        # vitest + jsdom

The app lives at the repo root: `config.xml`, `index.html`, `js/`, `css/`, `assets/`. Tests, docs
and `node_modules` are not packaged (the workflow stages only the runtime files).
AVPlay is replaced by a shim in tests (`js/avplay-shim.js`); real playback can only be verified on the TV.
