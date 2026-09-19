#!/usr/bin/env node
/**
 * Migration CLI.
 *   npm run migrate           apply pending migrations + sync permission catalogue
 *   npm run migrate:status    show which migrations are applied
 */
import { migrate, migrationStatus, closePool } from '../src/db/index.js';

const wantStatus = process.argv.includes('--status');

try {
  if (wantStatus) {
    const rows = await migrationStatus();
    if (!rows.length) console.log('No migration files found.');
    for (const row of rows) {
      const state = !row.applied ? 'pending' : row.checksumMatch ? 'applied' : 'MODIFIED';
      console.log(`${state.padEnd(9)} ${row.name}${row.appliedAt ? `  (${new Date(row.appliedAt).toISOString()})` : ''}`);
    }
  } else {
    const { applied, total } = await migrate();
    console.log(applied.length ? `[migrate] applied ${applied.length} of ${total} migrations` : `[migrate] up to date (${total} migrations)`);
  }
} catch (err) {
  console.error(`[migrate] failed: ${err.message}`);
  if (process.env.LOG_LEVEL === 'debug') console.error(err);
  process.exitCode = 1;
} finally {
  await closePool();
}
