// The app's version, as config.xml declares it (test/config.test.js keeps the two in step).
// Settings → About shows "YM Player {version}"; on a TV the installed package's own version wins.
export const VERSION = '0.1.0';

/** The installed version: tizen.application's appInfo, else VERSION. */
export function appVersion() {
  try {
    const t = globalThis.tizen;
    const v = t && t.application && t.application.getAppInfo && t.application.getAppInfo().version;
    if (v) return String(v);
  } catch { /* not on a TV */ }
  return VERSION;
}
