import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests share one in-memory MongoDB per file, so files run in separate workers.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
