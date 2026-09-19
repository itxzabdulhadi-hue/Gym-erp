import { defineConfig } from 'vitest/config';

/**
 * Test runner configuration.
 *
 * `fileParallelism: false` matters for the local development database: the
 * PGlite wire server is a single embedded instance, so concurrent test files
 * contend for it. Against a real PostgreSQL server (CI, staging, Neon) this can
 * be turned back on - nothing in the suites assumes a single connection.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: false,
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ['basic'] : ['basic'],
  },
});
