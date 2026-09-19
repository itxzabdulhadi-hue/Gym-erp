import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS } from '@erp/shared';
import { pool } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function readMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      return { name, sql, checksum: sha256(sql) };
    });
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         serial PRIMARY KEY,
      name       text NOT NULL UNIQUE,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

/** Run pending SQL migrations, then sync the permission catalogue. */
export async function migrate({ logger = console } = {}) {
  const files = readMigrationFiles();
  const client = await pool.connect();
  const applied = [];
  try {
    await ensureTable(client);
    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations ORDER BY id');
    const appliedMap = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const existing = appliedMap.get(file.name);
      if (existing) {
        if (existing !== file.checksum) {
          throw new Error(
            `Migration ${file.name} has been modified after it was applied. ` +
              'Create a new migration instead of editing an applied one.',
          );
        }
        continue;
      }
      logger.log?.(`[migrate] applying ${file.name}`);
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file.name,
          file.checksum,
        ]);
        await client.query('COMMIT');
        applied.push(file.name);
      } catch (err) {
        await client.query('ROLLBACK');
        const where = err.position ? ` (at character ${err.position})` : '';
        err.message = `Migration ${file.name} failed: ${err.message}${where}${err.detail ? `\n  detail: ${err.detail}` : ''}${err.hint ? `\n  hint: ${err.hint}` : ''}`;
        throw err;
      }
    }
  } finally {
    client.release();
  }

  await syncCatalog({ logger });
  return { applied, total: files.length };
}

/**
 * The permission catalogue lives in @erp/shared so the API guard and the web
 * client can never drift. Upserting it here keeps the database in sync without
 * duplicating the list in SQL.
 */
export async function syncCatalog({ logger = console } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const permission of ALL_PERMISSIONS) {
      await client.query(
        `INSERT INTO permissions (key, module, action, label, description, grp)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (key) DO UPDATE
           SET module = EXCLUDED.module,
               action = EXCLUDED.action,
               label = EXCLUDED.label,
               description = EXCLUDED.description,
               grp = EXCLUDED.grp`,
        [permission.key, permission.module, permission.action, permission.label, permission.description, permission.group],
      );
    }
    // Permissions removed from the catalogue should not linger.
    await client.query('DELETE FROM permissions WHERE key <> ALL($1::text[])', [
      ALL_PERMISSIONS.map((p) => p.key),
    ]);
    await client.query('COMMIT');
    logger.log?.(`[migrate] permission catalogue synced (${ALL_PERMISSIONS.length} permissions)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrationStatus() {
  const files = readMigrationFiles();
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY id');
    const applied = new Map(rows.map((r) => [r.name, r]));
    return files.map((f) => ({
      name: f.name,
      applied: applied.has(f.name),
      appliedAt: applied.get(f.name)?.applied_at || null,
      checksumMatch: applied.has(f.name) ? applied.get(f.name).checksum === f.checksum : null,
    }));
  } finally {
    client.release();
  }
}

/** Drop every application table (used by `npm run db:reset` in development). */
export async function dropAll({ logger = console } = {}) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations')
    `);
    if (!rows.length) return 0;
    const names = rows.map((r) => `"${r.tablename}"`).join(', ');
    await client.query(`DROP TABLE IF EXISTS ${names} CASCADE`);
    await client.query('DROP FUNCTION IF EXISTS set_updated_at() CASCADE');
    await client.query('DROP FUNCTION IF EXISTS current_tenant_id() CASCADE');
    logger.log?.(`[migrate] dropped ${rows.length} tables`);
    return rows.length;
  } finally {
    client.release();
  }
}
