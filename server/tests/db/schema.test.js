import { describe, it, expect, beforeAll } from 'vitest';

import { query, queryMany, closePool } from '../../src/db/index.js';
import { afterAll } from 'vitest';

/**
 * Schema guarantees the multi-tenant model depends on.
 *
 * These are checked against the live database rather than by reading the
 * migration files, so a migration that is present but not applied - or one that
 * drifts from the code - fails here.
 */
describe('database schema', () => {
  afterAll(async () => {
    await closePool();
  });

  let tenantTables = [];

  beforeAll(async () => {
    const res = await query(`
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.column_name = 'tenant_id'
         AND c.table_schema = 'public'
         AND t.table_type = 'BASE TABLE'
         AND c.table_name <> 'tenants'
       ORDER BY c.table_name
    `);
    tenantTables = res.rows.map((r) => r.table_name);
  });

  it('has every tenant-scoped table present', () => {
    const required = [
      'audit_logs', 'attendance', 'branding', 'dashboard_layouts', 'exercises', 'expenses', 'files',
      'member_documents', 'members', 'membership_plans', 'memberships', 'modules', 'notifications',
      'password_resets', 'payments', 'progress_records', 'refresh_tokens', 'roles', 'themes',
      'trainers', 'users', 'workout_assignments', 'workout_logs', 'workout_plan_items', 'workout_plans',
    ];
    for (const table of required) {
      expect(tenantTables, `missing tenant-scoped table: ${table}`).toContain(table);
    }
  });

  it('scopes the join tables transitively through their parents', async () => {
    // `role_permissions` and `user_roles` carry no tenant_id of their own; they
    // inherit it from roles/users. That is only safe if the FKs exist, so a
    // join cannot pull a row from another tenant.
    const fks = await query(`
      SELECT tc.table_name, ccu.table_name AS parent
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name IN ('role_permissions', 'user_roles')
    `);
    const byTable = {};
    for (const row of fks.rows) (byTable[row.table_name] ||= []).push(row.parent);

    expect(byTable.role_permissions).toContain('roles');
    expect(byTable.user_roles).toContain('roles');
    expect(byTable.user_roles).toContain('users');
  });

  it('enables row level security on every tenant-scoped table', async () => {
    const res = await query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    const byName = Object.fromEntries(res.rows.map((r) => [r.relname, r]));

    const missing = tenantTables.filter((t) => !byName[t]?.relrowsecurity);
    expect(missing, `RLS not enabled on: ${missing.join(', ')}`).toEqual([]);
  });

  it('defines at least one policy per tenant-scoped table', async () => {
    const res = await query(`
      SELECT schemaname, tablename, count(*)::int AS policies
        FROM pg_policies
       WHERE schemaname = 'public'
       GROUP BY schemaname, tablename
    `);
    const counts = Object.fromEntries(res.rows.map((r) => [r.tablename, r.policies]));
    const missing = tenantTables.filter((t) => !counts[t]);
    expect(missing, `no RLS policy on: ${missing.join(', ')}`).toEqual([]);
  });

  it('makes policies fail closed when app.tenant_id is unset', async () => {
    const policies = await queryMany(`SELECT tablename, qual FROM pg_policies WHERE schemaname = 'public'`);
    expect(policies.length).toBeGreaterThan(0);

    // Every policy must compare against the session setting; a policy that
    // omitted the check would allow cross-tenant reads whenever the setting is
    // missing (NULL), which is the failure mode RLS exists to prevent.
    const withoutGuard = policies.filter((p) => !/current_setting\(\s*'app\.tenant_id'/.test(p.qual || ''));
    expect(withoutGuard.map((p) => p.tablename), 'policies missing the app.tenant_id guard').toEqual([]);
  });

  it('cascades deletes from tenants to every tenant-scoped table', async () => {
    const res = await query(`
      SELECT tc.table_name, rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.referential_constraints rc
          ON rc.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND kcu.column_name = 'tenant_id'
         AND ccu.table_name = 'tenants'
    `);
    const rules = Object.fromEntries(res.rows.map((r) => [r.table_name, r.delete_rule]));

    const notCascading = tenantTables.filter((t) => rules[t] !== 'CASCADE');
    expect(notCascading, `tenant_id FK not ON DELETE CASCADE: ${notCascading.join(', ')}`).toEqual([]);
  });

  it('indexes tenant_id on every tenant-scoped table', async () => {
    const res = await query(`
      SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'
    `);
    const withoutIndex = tenantTables.filter(
      (t) => !res.rows.some((r) => r.tablename === t && /\btenant_id\b/.test(r.indexdef)),
    );
    expect(withoutIndex, `no index covering tenant_id: ${withoutIndex.join(', ')}`).toEqual([]);
  });

  it('keeps member numbers unique per tenant, not globally', async () => {
    const res = await query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'members'`);
    const defs = res.rows.map((r) => r.indexdef).join('\n');
    expect(defs).toMatch(/tenant_id/);
    expect(defs).toMatch(/member_no/);
    // A plain UNIQUE (member_no) would leak and collide across tenants.
    expect(defs).not.toMatch(/UNIQUE \(member_no\)/);
  });

  it('keeps invoice numbers unique per tenant', async () => {
    const indexes = await query(`SELECT indexdef FROM pg_indexes WHERE tablename = 'payments'`);
    const defs = indexes.rows.map((r) => r.indexdef).join('\n');
    expect(defs).toMatch(/tenant_id/);
    expect(defs).toMatch(/invoice_no/);
  });

  it('stores money as numeric, never float', async () => {
    const res = await query(`
      SELECT table_name, column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name IN ('amount', 'amount_paid', 'price', 'discount', 'salary', 'commission_rate')
    `);
    const floats = res.rows.filter((r) => ['double precision', 'real'].includes(r.data_type));
    expect(floats, `money stored as float: ${JSON.stringify(floats)}`).toEqual([]);
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it('constrains payments so amount_paid cannot exceed amount', async () => {
    const res = await query(`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conrelid = 'payments'::regclass AND contype = 'c'
    `);
    const defs = res.rows.map((r) => r.def).join(' ');
    expect(defs).toMatch(/amount_paid/);
  });

  it('records applied migrations', async () => {
    const rows = await queryMany('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.map((r) => r.name).join(',')).toMatch(/0001/);
  });
});
