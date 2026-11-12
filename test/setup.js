// Runs before every test file: each test starts with an empty library store (js/repo.js keeps
// lists in module memory). Imported lazily so test files' vi.mock('../js/api.js') still applies.
import { beforeEach } from 'vitest';

beforeEach(async () => {
  const repo = await import('../js/repo.js');
  repo._reset();
});
