/**
 * Local development database.
 *
 * PGlite is a real PostgreSQL build compiled to WebAssembly. This script wraps
 * it in a Postgres wire-protocol server so the API can connect with the exact
 * same `pg` driver, connection string and SQL it uses against Neon - no Docker
 * and no local Postgres install required.
 *
 *   npm run db:up                 # 127.0.0.1:5432, data in ./.pgdata
 *   PORT_DB=5433 npm run db:up    # different port
 *
 * Data persists in ./.pgdata (git-ignored); delete that folder to start over.
 * Production must use a real PostgreSQL service (Neon, RDS, Supabase, ...).
 */
import fs from 'node:fs';
import path from 'node:path';
// Namespace imports on purpose: this package ships minified re-exports that
// Node does not always link when pulled in as named ESM bindings.
import * as pglite from '@electric-sql/pglite';
import * as pgliteSocket from '@electric-sql/pglite-socket';

const { PGlite } = pglite;
const { PGLiteSocketServer } = pgliteSocket;

const PORT = Number(process.env.PORT_DB || process.env.PGPORT || 5432);
const HOST = process.env.PGHOST_BIND || '127.0.0.1';
const DATA_DIR = path.resolve(process.cwd(), process.env.PGDATA_DIR || '.pgdata');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new PGlite(DATA_DIR);
await db.waitReady;

const server = new PGLiteSocketServer({
  db,
  host: HOST,
  port: PORT,
  maxConnections: 16,
});

await server.start();

console.log(`[db:up] PostgreSQL (PGlite) listening on postgresql://postgres@${HOST}:${PORT}/postgres`);
console.log(`[db:up] data directory: ${DATA_DIR}`);

const shutdown = async (signal) => {
  console.log(`\n[db:up] ${signal} - shutting down`);
  try {
    await server.stop();
    await db.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
