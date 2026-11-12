# Phase 2 report: saved library, Setup and Login

Branch `android-parity`. Android (Java) was the reference throughout.

## What was built

| Area | Files | Android source |
|---|---|---|
| Library store: memory → saved copy (IndexedDB) → provider, per account, with Android's refresh rules and failure behaviour | `js/repo.js`, `js/url.js` | Repo.java, Prefs refresh_hours / lib_time |
| `api.loginAt`, `api.progress` (items read so far by a whole-list download), `api.errorMessage` (Async.message) | `js/api.js` | LoginActivity.loginOnce, XtreamApi.PROGRESS, Async.message |
| Setup screen "Getting everything ready" | `js/views/setup.js`, `css/login.css` | SetupActivity.java |
| Launch order: splash (warms the library) → login (no account) / setup (no saved library) / home | `js/views/splash.js`, `js/app.js` | SplashActivity, LoginActivity:52-60 |
| Login: two cards, the 4 Android fields, visible password, paste-on-submit, candidate addresses, Android messages, add/edit modes, success → Setup | `js/views/login.js`, `css/login.css` | LoginActivity.java |
| Accounts moved to Settings → ACCOUNTS (first section): "✓  In use" / "Switch", Add Account, Edit This Account, Remove This Account (dialog, deletes that account's library) | `js/accounts-ui.js`, `js/views/settings.js` | SettingsActivity.build/switchTo/confirmRemove |
| Settings LIBRARY: "Refresh Automatically" with Android's cycle and texts, "Refresh Now" ("Not yet" / "Updated today at HH:mm" / "Updating…" / "Failed — msg") | `js/views/settings.js` | SettingsActivity.lastUpdated/refreshNow |
| Home runs `startLibrary`: first-run note, `onUpdated` reload, preload, refreshIfDue. Recently Added = newest 24 | `js/views/home.js`, `js/home-rows.js` | HomeActivity.startLibrary/recent |
| Live, Movies, Series, Search, Ambient read from the repo; nothing fetches a whole list per click | `js/views/*.js` | BrowseActivity, SearchActivity |
| Removed: outbound-QR `phonelink` view, its Settings entry, `js/vendor/qr.js`, the old login "Accounts" button and the accounts-list `setup` view | | |

## Repo module API (`js/repo.js`)

Lists are arrays of Item objects (`js/item.js`). Types are `'live' | 'movie' | 'series'`. Every call works on the current account (`store.current()`); a different account drops memory automatically.

```js
TYPES                                   // ['live', 'movie', 'series']
categories(type): Promise<Item[]>       // memory -> saved -> provider (saved after download)
streams(type, cat = null): Promise<Item[]>
    // cat null = whole list (one download per type at a time). With a cat, filtered locally
    // from the whole list when it exists in memory or saved; otherwise just that category.
cached(type, cat = null): Item[] | null // memory only; never waits or downloads
byId(type, id): Item | null             // index over the whole list in memory
recentlyAdded(type, n): Promise<Item[]> // newest first by `added`
clear(): void                           // forget memory (saved copy stays): login, switch, remove
hasLibrary(): boolean                   // synchronous; all three whole lists saved
isDue(now = Date.now()): boolean        // lib_time 0 -> true; -1 manual -> false; 0 -> true; else > N h
isRefreshing(): boolean                 // refreshAll or setup running
isSetupRunning(): boolean
progress(type): number                  // items read so far by the running whole-list download
setOnUpdated(fn | null): void           // called after a section's list is replaced
downloadType(type): Promise<number>     // categories + whole list, save, swap in; throws -> nothing replaced
refreshAll(): Promise<void>             // all three, then lib_time = now (per account)
refreshIfDue(whenDone?): Promise<boolean>
preload(): Promise<void>                // saved -> memory, one type at a time
warmUp(): Promise<boolean>              // splash: Live list + all categories when a library is saved
deleteFiles(server, user): Promise<void>
setSetupListener({ started(type), finished(type, count, error), allDone(ok) } | null): void
startSetup(types = TYPES): Promise<boolean>  // Live first, then Movies + Series together
fileName(type, kind): string            // 'lib_<hex hash(base|user)>_<type>_<cats|all>' (Android's file names)
hash(s), memoryBackend(), idbBackend(idb, name)   // storage; _setBackend/_reset/_backend for tests
```

Storage: one IndexedDB object store (`ymplayer-library` / `lib`), one record per Android file. The record names are mirrored in localStorage (`lib_saved`) so `hasLibrary()` is synchronous like `File.exists()`. A record that has gone missing is dropped from that list and fetched again. If IndexedDB is missing (jsdom) or will not open, the store falls back to memory for the session.

## Audit items closed

- Audit A §3: 29 (library warm-up part), 26 (Home reloads on `onUpdated`), 55 (library cache / scheduled refresh / preload). §4: 35 (splash → Setup). §5.1 fully ported.
- Audit B §3: 57, 58, 72 (Account name), 73, 76, 77 (by the splash, see below), 78, 79; 75 partly (see below); 74 layout only.
- Audit B §4: 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72 (outbound QR removed).

## What could not be matched, and why

- **"Use your phone".** PhoneLink needs the TV to serve a web form on the LAN, and a Tizen web app has no listening-socket API. The card has Android's layout (title, text, a 278u box where the QR would be). It says "Typing your details on your phone isn't available on this TV yet. Please use the form on the left." and the box reads "Not available on this TV yet". There is no QR. A real version needs a Tizen service app or a relay (audit B §4).
- **User-agent retries.** Android retries every address with 5 app names. Browsers drop the `User-Agent` header, so each candidate address (as typed, host only, http⇄https) is tried once. The UA setting stays in Settings, as on Android.
- **Login auto-forward.** Android's LoginActivity forwards a signed-in user to Home/Setup. Tizen's splash decides directly (`destination()`), with the same result.
- **Where Setup appears.** I followed the Java. Setup appears after a successful login (first, add or edit) and on launch when nothing is saved. Switching account restarts Home, as SettingsActivity does. Home then shows "Getting your channels, movies and series ready…" and downloads in the background. Refresh Now also refreshes in the background.
- **Small hardening beyond Android.** A setup started for another account waits for the running one instead of being ignored. A download never saves one account's list under another's name, because api.js reads the account per request. A reader that needs a list Setup is already downloading waits for it instead of downloading it twice.
- **Spinner** is a CSS arc approximating the Material indeterminate ProgressBar. The focused input's hint is TEXT3 on white, so it is nearly invisible. This matches Android (Ui.input).
- **Settings** keeps the old row styling except ACCOUNTS order/content and LIBRARY. Phase 8 restyles it.
- **Commit trailer.** As in phase 1, the commits use the session's `Claude Opus 5.5` co-author line rather than `Claude Fable 5.2`.

## Screenshots

`node tools/shots/run.mjs login login-filled login-error setup setup-error home settings`. PNGs go to `tools/shots/out/`. The mock server can now trickle, hold or fail an action (`provider:` on a screen). Seeded screens save the library through `repo.refreshAll()`, so launch lands on Home. I checked every capture against the Java. Two fixes came out of that: the login button lost focus while it was disabled (now a busy flag, as Android's disabled Button keeps focus), and the empty status line now keeps its one-line height.

## Tests

`npm test`: **302 passed** in 19 files (was 254). New: `test/repo.test.js` (30: names, tiers, local filtering, indexes, refresh rules, failure keeps the old copy, per-account isolation, deleteFiles, warm-up, setup order/progress/retry, IndexedDB backend with a fake IDB and the fallback), `test/setup.test.js` (8), `test/helpers.js` / `test/setup.js` (repo reset per test). I rewrote `test/login.test.js` (19) and extended the settings, shell, router, home, live, search and api tests. I replaced the phonelink/QR and accounts-list `setup` tests.
