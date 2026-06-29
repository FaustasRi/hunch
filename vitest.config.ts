import { defineConfig } from 'vitest/config';

// Use the forks pool (child processes) instead of worker threads. Worker threads
// can fail to tear down cleanly on some CI runners (GitHub-hosted ubuntu + Node 20),
// leaving `vitest run` hanging *after* all tests pass — which stalled CI here while
// the suite ran in ~1.6s locally. Forks exit deterministically.
export default defineConfig({
  test: {
    pool: 'forks',
  },
});
