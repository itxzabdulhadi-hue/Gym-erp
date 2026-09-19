import pg from 'pg';
import config from '../config/env.js';

const { Pool, types } = pg;

// Postgres returns int8 (COUNT) and numeric (money) as strings. Normalise them
// once, here, so the rest of the codebase can do arithmetic without surprises.
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric

/**
 * A single pool per process. On serverless (Vercel) this pool is reused across
 * warm invocations; for cold-start heavy deployments point DATABASE_URL at the
 * Neon pooled host (…-pooler.…).
 */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.databaseSsl,
  max: config.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  application_name: 'erp-api',
});

pool.on('error', (err) => {
  // An idle client blew up - log it, do not crash the process.
  // eslint-disable-next-line no-console
  console.error('[db] idle client error', err.message);
});

export async function closePool() {
  await pool.end();
}
