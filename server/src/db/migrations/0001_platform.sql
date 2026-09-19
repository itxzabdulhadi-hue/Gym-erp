-- ===========================================================================
-- 0001 · Platform core
-- Tenant / identity / configuration tables. Vertical agnostic: nothing in this
-- file knows anything about gyms.
-- ===========================================================================

-- ------------------------------------------------------------------ tenants
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  short_name      text,
  vertical        text NOT NULL DEFAULT 'gym',
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'trial', 'suspended')),
  plan            text NOT NULL DEFAULT 'starter',
  -- Namespaced, versioned settings (attendance, payments, memberships, security...)
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarded_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenants_vertical_idx ON tenants (vertical);

-- -------------------------------------------------------------------- users
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email                text NOT NULL,
  full_name            text NOT NULL,
  phone                text,
  avatar_url           text,
  password_hash        text NOT NULL,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'invited', 'disabled')),
  -- Platform super admins may cross tenants; tenant users never can.
  is_platform_admin    boolean NOT NULL DEFAULT false,
  last_login_at        timestamptz,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One account per email address per business (case insensitive).
CREATE UNIQUE INDEX users_email_unique_idx ON users (tenant_id, lower(email));
CREATE INDEX users_tenant_idx ON users (tenant_id);
CREATE INDEX users_status_idx ON users (tenant_id, status);

-- -------------------------------------------------------------------- roles
CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key          text NOT NULL,
  name         text NOT NULL,
  description  text,
  -- System roles are seeded for every tenant; they can still be renamed /
  -- re-permissioned by the owner, but not deleted.
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_key_unique UNIQUE (tenant_id, key)
);

CREATE INDEX roles_tenant_idx ON roles (tenant_id);

-- -------------------------------------------------------------- permissions
-- Global catalogue. Not tenant scoped: every tenant sees the same menu of
-- capabilities, and picks which ones each role gets.
CREATE TABLE permissions (
  key         text PRIMARY KEY,
  module      text NOT NULL,
  action      text NOT NULL,
  label       text NOT NULL,
  description text,
  grp         text NOT NULL DEFAULT 'core'
);

CREATE INDEX permissions_module_idx ON permissions (module);

CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- ------------------------------------------------------------ auth sessions
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  user_agent   text,
  ip           text,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_resets_user_idx ON password_resets (user_id);

-- ------------------------------------------------------------------ modules
-- Which features a given business has switched on. The API refuses module
-- routes when the row is disabled, so hiding nav items is never the only guard.
CREATE TABLE modules (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ----------------------------------------------------------------- branding
CREATE TABLE branding (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  business_name   text NOT NULL,
  short_name      text,
  app_name        text,
  browser_title   text,
  description     text,
  tagline         text,
  email           text,
  phone           text,
  address         text,
  city            text,
  country         text,
  website         text,
  social_links    jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency        text NOT NULL DEFAULT 'USD',
  currency_symbol text NOT NULL DEFAULT '$',
  timezone        text NOT NULL DEFAULT 'UTC',
  locale          text NOT NULL DEFAULT 'en',
  logo_url        text,
  logo_light_url  text,
  logo_dark_url   text,
  favicon_url     text,
  login_logo_url  text,
  login_background_url text,
  app_icon_url    text,
  splash_url      text,
  theme_color     text NOT NULL DEFAULT '#4f46e5',
  background_color text NOT NULL DEFAULT '#ffffff',
  -- Terminology overrides (e.g. call a member a "client").
  terminology     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------- themes
CREATE TABLE themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  config      jsonb NOT NULL,
  custom_css  text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT false,
  is_preset   boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT themes_name_unique UNIQUE (tenant_id, name)
);

-- Exactly one active theme per tenant.
CREATE UNIQUE INDEX themes_one_active_idx ON themes (tenant_id) WHERE is_active;
CREATE INDEX themes_tenant_idx ON themes (tenant_id);

-- -------------------------------------------------------------------- files
CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  bucket       text NOT NULL DEFAULT 'local',
  storage_key  text NOT NULL,
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  byte_size    integer NOT NULL DEFAULT 0,
  purpose      text NOT NULL DEFAULT 'other',
  url          text NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX files_tenant_idx ON files (tenant_id, purpose);

-- ------------------------------------------------------------ notifications
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL DEFAULT 'system',
  channel      text NOT NULL DEFAULT 'in_app',
  title        text NOT NULL,
  body         text,
  level        text NOT NULL DEFAULT 'info'
                 CHECK (level IN ('info', 'success', 'warning', 'error')),
  entity       text,
  entity_id    uuid,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at      timestamptz,
  -- Delivery status per channel, so providers can be added without a migration.
  delivery     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_tenant_user_idx ON notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (tenant_id, user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_type_idx ON notifications (tenant_id, type);

-- --------------------------------------------------------------- audit logs
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  user_label  text,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  -- { before, after, note } - kept as jsonb so any module can log anything.
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (tenant_id, entity, entity_id);
CREATE INDEX audit_logs_user_idx ON audit_logs (tenant_id, user_id);

-- --------------------------------------------------------- dashboard layouts
CREATE TABLE dashboard_layouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL user_id = the tenant wide default layout.
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'Default',
  layout     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dashboard_layouts_unique_idx
  ON dashboard_layouts (tenant_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- ---------------------------------------------------------------- utilities
-- Keeps updated_at honest without triggers per table.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_touch BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER roles_touch BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER modules_touch BEFORE UPDATE ON modules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER branding_touch BEFORE UPDATE ON branding FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER themes_touch BEFORE UPDATE ON themes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
