import { query } from '../../db/index.js';
import { shapeTheme } from '../themes/theme.shape.js';

/**
 * Everything the API needs to know about the caller, assembled once per request
 * and cached briefly: identity, tenant, effective permissions, enabled modules,
 * branding and active theme.
 *
 * Caching is per user+tenant with a short TTL and is invalidated explicitly
 * whenever roles, users, modules, branding or themes change, so permission edits
 * apply immediately instead of after a token refresh.
 */

const CACHE_TTL_MS = 20_000;
const cache = new Map();

const USER_TENANT_SQL = `
  SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.status,
         u.is_platform_admin, u.must_change_password, u.last_login_at,
         t.id AS tenant_id, t.slug, t.vertical, t.status AS tenant_status,
         t.name AS tenant_name, t.short_name AS tenant_short_name,
         t.plan AS tenant_plan, t.settings AS tenant_settings, t.onboarded_at
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.id = $1 AND u.tenant_id = $2
`;

const USER_ONLY_SQL = `
  SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.status,
         u.is_platform_admin, u.must_change_password, u.last_login_at
  FROM users u WHERE u.id = $1
`;

const TENANT_SQL = `
  SELECT id, slug, vertical, status AS tenant_status, name AS tenant_name,
         short_name AS tenant_short_name, plan AS tenant_plan,
         settings AS tenant_settings, onboarded_at
  FROM tenants WHERE id = $1
`;

const PERMISSIONS_SQL = `
  SELECT DISTINCT p.key
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.key = rp.permission_id
  WHERE ur.user_id = $1 AND r.tenant_id = $2
`;

const ROLES_SQL = `
  SELECT r.id, r.key, r.name, r.is_system
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = $1 AND r.tenant_id = $2
  ORDER BY r.name
`;

const MODULES_SQL = 'SELECT key, enabled, sort_order, settings FROM modules WHERE tenant_id = $1 ORDER BY sort_order';
const BRANDING_SQL = 'SELECT * FROM branding WHERE tenant_id = $1';
const THEME_SQL = 'SELECT id, name, config, custom_css FROM themes WHERE tenant_id = $1 AND is_active LIMIT 1';

export async function loadAuthContext({ userId, tenantId, asPlatformAdmin = false }) {
  const key = `${userId}:${tenantId}:${asPlatformAdmin ? 1 : 0}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const ctx = asPlatformAdmin
    ? await buildPlatformContext(userId, tenantId)
    : await buildTenantContext(userId, tenantId);

  if (ctx) cache.set(key, { at: Date.now(), value: ctx });
  return ctx;
}

async function buildTenantContext(userId, tenantId) {
  const [userTenant, permissions, roles, modules, branding, theme] = await Promise.all([
    query(USER_TENANT_SQL, [userId, tenantId]),
    query(PERMISSIONS_SQL, [userId, tenantId]),
    query(ROLES_SQL, [userId, tenantId]),
    query(MODULES_SQL, [tenantId]),
    query(BRANDING_SQL, [tenantId]),
    query(THEME_SQL, [tenantId]),
  ]);

  const row = userTenant.rows[0];
  if (!row) return null;

  return assemble(row, {
    permissions: permissions.rows.map((r) => r.key),
    roles: roles.rows,
    modules: modules.rows,
    branding: branding.rows[0] || null,
    theme: shapeTheme(theme.rows[0] || null),
  });
}

async function buildPlatformContext(userId, tenantId) {
  const [userRes, tenantRes, modules, branding, theme] = await Promise.all([
    query(USER_ONLY_SQL, [userId]),
    query(TENANT_SQL, [tenantId]),
    query(MODULES_SQL, [tenantId]),
    query(BRANDING_SQL, [tenantId]),
    query(THEME_SQL, [tenantId]),
  ]);

  const user = userRes.rows[0];
  const tenant = tenantRes.rows[0];
  if (!user?.is_platform_admin || !tenant) return null;

  return assemble({ ...user, ...tenant }, {
    permissions: ['*'],
    roles: [{ id: null, key: 'platform_admin', name: 'Platform administrator', is_system: true }],
    modules: modules.rows,
    branding: branding.rows[0] || null,
    theme: shapeTheme(theme.rows[0] || null),
    isPlatformContext: true,
  });
}

function assemble(row, extra) {
  const user = {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    status: row.status,
    isPlatformAdmin: Boolean(row.is_platform_admin),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at,
  };

  const tenant = {
    id: row.tenant_id,
    slug: row.slug,
    name: row.tenant_name,
    shortName: row.tenant_short_name,
    vertical: row.vertical,
    status: row.tenant_status,
    plan: row.tenant_plan,
    settings: row.tenant_settings || {},
    onboardedAt: row.onboarded_at,
  };

  const modules = {};
  for (const m of extra.modules) modules[m.key] = { enabled: m.enabled, settings: m.settings || {} };

  return {
    user,
    tenant,
    roles: extra.roles,
    permissions: extra.permissions,
    modules,
    branding: extra.branding,
    theme: extra.theme,
    isPlatformContext: Boolean(extra.isPlatformContext),
  };
}

/** Drop cached context after anything that affects authorisation changes. */
export function invalidateAuthCache({ userId, tenantId } = {}) {
  if (!userId && !tenantId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    const [cachedUser, cachedTenant] = key.split(':');
    if ((userId && cachedUser === userId) || (tenantId && cachedTenant === tenantId)) cache.delete(key);
  }
}
