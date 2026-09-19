import { describe, it, expect, beforeAll } from 'vitest';

import { withTenant, tx, query, queryOne, queryMany, currentTenantId } from '../../src/db/index.js';
import { createTenant, closeDbAfterSuite } from '../helpers/context.js';
import * as fx from '../helpers/fixtures.js';

/**
 * The data-access contract.
 *
 * The specific regression guarded here: `query()` and `queryOne()` used to go
 * straight to the pool, so a statement issued inside `withTenant()` escaped the
 * open transaction *and* the `app.tenant_id` session setting that the RLS
 * policies from migration 0003 match against. Locally PGlite runs as a
 * superuser so RLS is bypassed and the bug is invisible; on Neon, with a
 * non-superuser role, every such statement would return zero rows.
 */
describe('database layer', () => {
  closeDbAfterSuite();

  let tenant;
  let other;

  beforeAll(async () => {
    tenant = await createTenant({ name: 'DB Context Gym', slugPrefix: 'dbctx' });
    other = await createTenant({ name: 'DB Context Other', slugPrefix: 'dbctxo' });
    await fx.member(tenant.id, { firstName: 'Context', lastName: 'Member' });
    await fx.member(other.id, { firstName: 'Foreign', lastName: 'Member' });
  });

  const tenantSetting = "SELECT current_setting('app.tenant_id', true) AS tid";

  it('applies the tenant context to every query inside withTenant()', async () => {
    await withTenant(tenant.id, async (client) => {
      const direct = await client.query(tenantSetting);
      expect(direct.rows[0].tid).toBe(tenant.id);

      // The regression: a bare query()/queryOne() must see the same setting.
      const viaQuery = await query(tenantSetting);
      expect(viaQuery.rows[0].tid).toBe(tenant.id);

      const viaQueryOne = await queryOne(tenantSetting);
      expect(viaQueryOne.tid).toBe(tenant.id);

      const viaQueryMany = await queryMany(tenantSetting);
      expect(viaQueryMany[0].tid).toBe(tenant.id);
    });
  });

  it('exposes the ambient tenant through currentTenantId()', async () => {
    expect(currentTenantId()).toBeNull();
    await withTenant(tenant.id, async () => {
      expect(currentTenantId()).toBe(tenant.id);
    });
    expect(currentTenantId()).toBeNull();
  });

  it('keeps the context through nested service calls', async () => {
    await withTenant(tenant.id, async () => {
      // Simulates a service calling another service.
      await withTenant(tenant.id, async () => {
        await withTenant(tenant.id, async () => {
          expect((await queryOne(tenantSetting)).tid).toBe(tenant.id);
        });
      });
    });
  });

  it('refuses to nest a different tenant inside an open transaction', async () => {
    await expect(
      withTenant(tenant.id, () => withTenant(other.id, async () => 'should not run')),
    ).rejects.toThrow(/Refusing to nest tenant/);
  });

  /**
   * Row level security is the second line of defence; explicit `tenant_id`
   * filters are the first (see tests/integration/tenant-isolation.test.js).
   *
   * Whether RLS can actually be observed depends on the role: a superuser or a
   * role with BYPASSRLS skips every policy. The local PGlite development server
   * authenticates all clients as its superuser, so there the policies are
   * present but inert; against Neon, where the app connects as a non-superuser,
   * the same test asserts real filtering.
   */
  it('applies row level security when the database role is not privileged', async () => {
    const role = await queryOne(
      `SELECT r.rolsuper, r.rolbypassrls
         FROM pg_roles r
        WHERE r.rolname = current_user`,
    );
    const bypasses = Boolean(role?.rolsuper || role?.rolbypassrls);

    const rows = await withTenant(tenant.id, () => queryMany('SELECT first_name, tenant_id FROM members'));
    const foreign = rows.filter((r) => r.tenant_id !== tenant.id);

    if (bypasses) {
      // Documented dev-only limitation - asserted, not ignored.
      expect(rows.map((r) => r.first_name)).toContain('Context');
      expect(foreign.length).toBeGreaterThan(0);
      return;
    }

    expect(rows.map((r) => r.first_name)).toContain('Context');
    expect(foreign).toEqual([]);
  });

  it('is atomic: a failing statement rolls the whole transaction back', async () => {
    const before = await queryOne('SELECT count(*)::int AS n FROM members WHERE tenant_id = $1', [tenant.id]);

    await expect(
      withTenant(tenant.id, async () => {
        await fx.member(tenant.id, { firstName: 'Should', lastName: 'Vanish' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const after = await queryOne('SELECT count(*)::int AS n FROM members WHERE tenant_id = $1', [tenant.id]);
    expect(after.n).toBe(before.n);
    const leaked = await queryOne(`SELECT id FROM members WHERE tenant_id = $1 AND first_name = 'Should'`, [tenant.id]);
    expect(leaked).toBeNull();
  });

  it('commits when the callback succeeds', async () => {
    await withTenant(tenant.id, async () => {
      await fx.member(tenant.id, { firstName: 'Committed', lastName: 'Member' });
    });
    const row = await queryOne(`SELECT id FROM members WHERE tenant_id = $1 AND first_name = 'Committed'`, [tenant.id]);
    expect(row).not.toBeNull();
  });

  it('runs concurrent statements on one connection without corrupting it', async () => {
    // Services fan out with Promise.all([rows, count]); a single Postgres
    // connection cannot multiplex, so the driver serialises them. If this
    // regresses, the connection dies with "unexpected commandComplete".
    const [a, b, c, d] = await withTenant(tenant.id, () =>
      Promise.all([
        queryOne('SELECT 1 AS n'),
        queryOne('SELECT 2 AS n'),
        queryOne('SELECT 3 AS n'),
        queryOne('SELECT 4 AS n'),
      ]),
    );
    expect([a.n, b.n, c.n, d.n]).toEqual([1, 2, 3, 4]);
  });

  it('releases connections: 40 sequential transactions still work', async () => {
    for (let i = 0; i < 40; i += 1) {
      const n = await tx(async (client) => (await client.query('SELECT $1::int AS n', [i])).rows[0].n);
      expect(n).toBe(i);
    }
  });

  it('reports SQL errors as structured pg errors, never as raw text to callers', async () => {
    await expect(query('SELECT * FROM table_that_does_not_exist')).rejects.toMatchObject({ code: '42P01' });
  });

  it('parameterises queries (no string interpolation of values)', async () => {
    // A value that would terminate the statement if it were interpolated.
    const injected = `x'; DROP TABLE members; --`;
    const row = await queryOne('SELECT $1::text AS v', [injected]);
    expect(row.v).toBe(injected);
    const stillThere = await queryOne('SELECT count(*)::int AS n FROM members');
    expect(stillThere.n).toBeGreaterThan(0);
  });
});
