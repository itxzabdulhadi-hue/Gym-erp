#!/usr/bin/env node
/** Drop every application table, re-run migrations and re-seed demo data. */
import { dropAll, migrate, closePool } from '../src/db/index.js';
import config from '../src/config/env.js';

if (config.isProduction) {
  console.error('[db:reset] refused: NODE_ENV=production. This command destroys data.');
  process.exit(1);
}

try {
  await dropAll();
  const { applied } = await migrate();
  console.log(`[db:reset] migrations applied: ${applied.length}`);
  await import('./seed.js');
} catch (err) {
  console.error(`[db:reset] failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
