-- ===========================================================================
-- 0005 · Tenant index coverage
--
-- Every tenant-scoped table is filtered by `tenant_id` on every read, both by
-- the repositories and by the row level security policies from 0003. Five
-- tables were only reachable through their parent row, so a tenant-wide query
-- (documents, sessions, reset tokens, workout logs and plan items) had to fall
-- back to a scan plus filter. These indexes make the tenant predicate usable.
--
-- Idempotent, so it is safe to re-run and safe to apply to a database that
-- already has them.
-- ===========================================================================

CREATE INDEX IF NOT EXISTS member_documents_tenant_idx   ON member_documents   (tenant_id);
CREATE INDEX IF NOT EXISTS password_resets_tenant_idx    ON password_resets    (tenant_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_tenant_idx     ON refresh_tokens     (tenant_id);
CREATE INDEX IF NOT EXISTS workout_logs_tenant_idx       ON workout_logs       (tenant_id);
CREATE INDEX IF NOT EXISTS workout_plan_items_tenant_idx ON workout_plan_items (tenant_id);

-- Hot paths that filter by tenant *and* a time/status column. Without these,
-- the dashboard and report queries walk the whole tenant partition.
CREATE INDEX IF NOT EXISTS attendance_tenant_visit_date_idx ON attendance (tenant_id, visit_date);
CREATE INDEX IF NOT EXISTS payments_tenant_paid_at_idx      ON payments   (tenant_id, paid_at);
CREATE INDEX IF NOT EXISTS members_tenant_status_idx        ON members    (tenant_id, status);
CREATE INDEX IF NOT EXISTS memberships_tenant_end_date_idx  ON memberships (tenant_id, end_date);
