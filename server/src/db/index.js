import { AsyncLocalStorage } from 'node:async_hooks';
import { pool } from './client.js';

export { pool, closePool } from './client.js';

/**
 * Data access layer.
 *
 * Every tenant scoped operation runs through `withTenant()`, which:
 *   1. opens a transaction,
 *   2. sets the `app.tenant_id` session setting that the row level security
 *      policies from migration 0003 match against,
 *   3. exposes the transaction client to everything called underneath it.
 *
 * The client is tracked with AsyncLocalStorage, so a service can call another
 * service without opening a second connection inside an open transaction (which
 * would deadlock as soon as the pool is small, and would silently split a write
 * across two transactions otherwise).
 *
 * `query()` and `queryOne()` join the open transaction automatically. That
 * matters for correctness, not just speed: a statement that escapes the
 * transaction also escapes the `app.tenant_id` setting, so the RLS policies
 * would reject it once the app runs against Postgres with a non-superuser role.
 */
const ambient = new AsyncLocalStorage();

const SERIALISED = Symbol.for('erp.serialisedClient');

/**
 * One Postgres connection cannot multiplex: two concurrent `client.query()`
 * calls on it are pipelined into the same protocol stream, which corrupts the
 * connection (and takes the whole process down with it). Services routinely fan
 * out with `Promise.all([count, rows])`, so the queue is enforced here instead
 * of at every call site.
 */
function serialise(client) {
  if (client[SERIALISED]) return client;

  const original = client.query.bind(client);
  let tail = Promise.resolve();

  client.query = (text, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = undefined;
    }
    const task = () => (params === undefined ? original(text) : original(text, params));
    // Run after the previous statement either way: one failed statement must
    // not wedge every later statement on this connection.
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );

    if (typeof callback === 'function') {
      run.then(
        (result) => callback(null, result),
        (err) => callback(err),
      );
      return client;
    }
    return run;
  };

  client[SERIALISED] = true;
  return client;
}

/** Run a single statement, inside the open transaction when there is one. */
export async function query(text, params = []) {
  const client = ambient.getStore()?.client;
  if (client) return client.query(text, params);
  return pool.query(text, params);
}

export async function queryOne(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

/**
 * Run `fn` inside a transaction. If a transaction is already open on this async
 * context, it is reused so the caller stays atomic.
 */
export async function tx(fn) {
  const current = ambient.getStore();
  if (current?.client) return fn(current.client);

  const client = serialise(await pool.connect());
  try {
    await client.query('BEGIN');
    const result = await ambient.run({ client, tenantId: null }, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken; the pool discards it */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` scoped to one tenant. Nested calls for the same tenant reuse the
 * open transaction; nesting a *different* tenant is a programming error and is
 * rejected loudly rather than silently leaking data across tenants.
 */
export async function withTenant(tenantId, fn) {
  if (!tenantId) throw new Error('withTenant() requires a tenantId');
  const id = String(tenantId);
  const current = ambient.getStore();

  if (current?.client) {
    if (current.tenantId && current.tenantId !== id) {
      throw new Error(`Refusing to nest tenant ${id} inside a transaction scoped to ${current.tenantId}`);
    }
    if (current.tenantId === id) return fn(current.client);
  }

  return tx(async (client) => {
    // `SET LOCAL` cannot take bind parameters, so use the function form; the
    // third argument scopes the setting to this transaction only.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
    return ambient.run({ client, tenantId: id }, () => fn(client));
  });
}

/** The tenant id of the current async context, if any. */
export function currentTenantId() {
  return ambient.getStore()?.tenantId ?? null;
}

/** Simple `SELECT 1` used by /health and by the migration CLI. */
export async function ping() {
  const res = await query('select 1 as ok');
  return res.rows[0]?.ok === 1;
}

// Migration tooling is re-exported so callers have a single entry point.
export {
  migrate,
  migrationStatus,
  syncCatalog,
  dropAll,
  readMigrationFiles,
  MIGRATIONS_DIR,
} from './migrate.js';
