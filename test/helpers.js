// Shared test helpers.
import * as repo from '../js/repo.js';

/** Save a library for the current account straight into the repo's backend (synchronously). */
export function seedLibrary(lists = {}) {
  const b = repo._backend();
  for (const t of repo.TYPES) {
    b.put(repo.fileName(t, 'all'), lists[t] || []);
    b.put(repo.fileName(t, 'cats'), (lists.cats && lists.cats[t]) || []);
  }
}
