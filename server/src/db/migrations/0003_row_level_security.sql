-- ===========================================================================
-- 0003 · Row level security (defence in depth)
--
-- Every tenant scoped table gets a policy that only matches rows belonging to
-- the tenant stored in the `app.tenant_id` session setting. The API sets that
-- setting for every tenant scoped transaction (see src/db/index.js).
--
-- NOTE ON ENFORCEMENT
-- PostgreSQL skips RLS for superusers and for the owner of the table. The
-- application therefore ALSO scopes every query by tenant_id in the repository
-- layer - that is the primary guard, and it is what the test suite asserts.
--
-- To make these policies hard-enforcing in production (recommended for Neon),
-- connect as a role that is neither superuser nor owner:
--
--   CREATE ROLE app_runtime LOGIN PASSWORD '...';
--   GRANT USAGE ON SCHEMA public TO app_runtime;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
--
-- ===========================================================================

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'roles', 'role_permissions', 'user_roles', 'refresh_tokens', 'password_resets',
    'modules', 'themes', 'files', 'notifications', 'audit_logs', 'dashboard_layouts',
    'members', 'membership_plans', 'memberships', 'attendance', 'trainers', 'exercises',
    'workout_plans', 'workout_plan_items', 'workout_assignments', 'workout_logs',
    'progress_records', 'payments', 'expenses', 'member_documents'
  ]
  LOOP
    -- role_permissions / user_roles / workout_plan_items have no tenant_id of
    -- their own; they inherit isolation through their parent row.
    IF table_name IN ('role_permissions', 'user_roles', 'workout_plan_items') THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id::text = current_setting(''app.tenant_id'', true))
         WITH CHECK (tenant_id::text = current_setting(''app.tenant_id'', true))',
      table_name
    );
  END LOOP;
END $$;

-- Child tables are isolated through their parent (role -> tenant, plan -> tenant).
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role_permissions
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.tenant_id::text = current_setting('app.tenant_id', true)));

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_roles
  USING (EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.tenant_id::text = current_setting('app.tenant_id', true)));

ALTER TABLE workout_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workout_plan_items
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- branding is keyed by tenant_id (it is both PK and FK).
ALTER TABLE branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branding
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
