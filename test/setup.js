// Runs before every test file: each test starts with an empty library store (js/repo.js keeps
// lists in module memory). Imported lazily so test files' vi.mock('../js/api.js') still applies.
import { beforeEach } from 'vitest';

beforeEach(async () => {
  const repo = await import('../js/repo.js');
  repo._reset();
  // Never reach Netflix from a test: Top 10 is offline unless a test supplies its own fetch.
  const top10 = await import('../js/top10.js');
  top10.setFetch(() => Promise.reject(new Error('offline in tests')));
  // Nor The Movie Database or TheIntroDB (Because You Watched, Skip Intro).
  const tmdb = await import('../js/tmdb.js');
  tmdb.setFetch(() => Promise.reject(new Error('offline in tests')));
  tmdb.state.failed = false;
  // Nor the sync server (sync.test.js points at a fake one).
  (await import('../js/sync.js'))._configure('', '');
  (await import('../js/recs.js'))._reset();
  (await import('../js/intros.js'))._reset();
  const home = await import('../js/views/home.js');
  home._reset();
  const coach = await import('../js/ui/coach.js');
  coach._reset();
  // Tests press OK without releasing it; a real remote always sends the key-up.
  const dialog = await import('../js/ui/dialog.js');
  dialog._resetKeys();
});
