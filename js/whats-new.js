// WhatsNew.java: after an update, a summary of what's new. Shown once per new set of notes;
// never on a fresh install (new users get the tutorial instead). Settings → What's New shows it
// again. The notes below are also the GitHub release notes (.github/workflows/build.yml).
import { showDialog } from './ui/dialog.js';
import { appVersion } from './version.js';
import { NOTES } from './whats-new-notes.js';

export { NOTES };
const SEEN = 'whatsnew_seen';
const ls = () => globalThis.localStorage;

/** String.hashCode, so the key only changes when the notes do. */
export function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

/** "- line" → "•  line", blank lines between. */
export function format(notes) {
  return String(notes).split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => (l.startsWith('- ') ? `•  ${l.slice(2)}` : l)).join('\n\n');
}

/**
 * Called once as the app starts, before anyone has signed in: with no account and nothing seen
 * yet this is a fresh install, so these notes count as seen.
 */
export function init() {
  const notes = NOTES.trim();
  if (!notes || ls().getItem(SEEN) !== null) return;
  const fresh = ls().getItem('accounts') === null && ls().getItem('server') === null;
  if (fresh) ls().setItem(SEEN, hash(notes));
}

export function show() {
  return showDialog({ title: `What's New in YM Player ${appVersion()}`, message: format(NOTES), positive: 'Got it' });
}

/** Shows the summary if the app has just been updated to new notes. True if it showed. */
export function maybeShow() {
  const notes = NOTES.trim();
  if (!notes) return false;
  const k = hash(notes);
  if (ls().getItem(SEEN) === k) return false;
  ls().setItem(SEEN, k);
  show();
  return true;
}
